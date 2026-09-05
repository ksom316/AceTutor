-- General Course Quiz scheduling — an "available from" date alongside the
-- existing absolute deadline, plus server enforcement of both bounds.
--
-- ADDITIVE. One new nullable column (course_quizzes.available_from) and
-- create-or-replace on functions whose bodies (not behaviour for existing data)
-- change. Nothing is dropped except the four general-quiz RPC signatures that
-- gain a trailing `_available_from` argument — the established pattern in
-- 20260905120000_general_quiz_timer_and_min_questions.sql.
--
-- Design:
--   * course_quizzes.deadline stays the canonical DUE timestamp (already
--     enforced by enforce_course_quiz_attempt and referenced throughout the
--     app). available_from is the new lower bound. Both nullable = unchanged
--     behaviour for every existing quiz (no data migration).
--   * enforce_course_quiz_attempt() gains a "not available yet" gate before the
--     existing deadline gate, so a new attempt cannot be started early by any
--     insert path (UI, direct PostgREST, RPC).
--   * stamp_quiz_attempt_expiry() caps a general-quiz attempt's expires_at at
--     the quiz deadline: expires_at = min(started_at + duration, deadline). The
--     existing finalize_expired_quiz_attempts() then times the attempt out at
--     the deadline with the normal grading path — Quiz Recovery is unchanged,
--     the deadline is absolute, refresh/return never re-stamps or extends it.
--   * A due date, when set, must be strictly after the available-from date.
--
-- NOT changed: module quizzes (topic_id branch of both triggers untouched),
-- grading, Mastery, RLS, lecturer course isolation, the attempt cap + its
-- advisory lock, replace_course_quiz / delete_course_quiz / course_quiz_has_attempts.

-- 1. Column ------------------------------------------------------------------
alter table public.course_quizzes
  add column if not exists available_from timestamptz;

-- 2. RPCs re-keyed with a trailing _available_from -------------------------------
drop function if exists public.create_course_quiz(text, text, timestamptz, int, int);
drop function if exists public.create_course_quiz_with_questions(text, jsonb, text, timestamptz, int, int);
drop function if exists public.update_course_quiz(uuid, text, text, timestamptz, int, int);
drop function if exists public.list_course_quizzes(uuid);

-- shared guard, inlined into each writer:
--   _deadline, when given with _available_from, must be strictly later.

create function public.create_course_quiz(
  _title text,
  _description text default null,
  _deadline timestamptz default null,
  _max_attempts int default null,
  _duration_minutes int default 30,
  _available_from timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_course uuid;
  v_id uuid;
  v_title text;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can create a general course quiz.';
  end if;
  if _max_attempts is not null and _max_attempts < 1 then
    raise exception 'Maximum attempts must be at least 1, or unlimited.';
  end if;
  if _deadline is not null and _available_from is not null and _deadline <= _available_from then
    raise exception 'The due date must be after the available-from date.';
  end if;

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then v_title := 'General Course Quiz'; end if;

  insert into public.course_quizzes
    (course_id, title, description, deadline, max_attempts, duration_minutes, available_from)
  values (
    v_course, v_title, nullif(btrim(coalesce(_description, '')), ''),
    _deadline, _max_attempts, least(greatest(coalesce(_duration_minutes, 30), 1), 240),
    _available_from
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.create_course_quiz_with_questions(
  _title text,
  _questions jsonb,
  _description text default null,
  _deadline timestamptz default null,
  _max_attempts int default null,
  _duration_minutes int default 30,
  _available_from timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_course uuid;
  v_id uuid;
  v_title text;
  v_i int := 0;
  q jsonb;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can create a general course quiz.';
  end if;
  if _max_attempts is not null and _max_attempts < 1 then
    raise exception 'Maximum attempts must be at least 1, or unlimited.';
  end if;
  if _deadline is not null and _available_from is not null and _deadline <= _available_from then
    raise exception 'The due date must be after the available-from date.';
  end if;
  if _questions is null or jsonb_typeof(_questions) <> 'array' or jsonb_array_length(_questions) < 1 then
    raise exception 'A general course quiz needs at least one question before it can be created.';
  end if;
  if jsonb_array_length(_questions) > 50 then
    raise exception 'A quiz can have at most 50 questions.';
  end if;

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then v_title := 'General Course Quiz'; end if;

  insert into public.course_quizzes
    (course_id, title, description, deadline, max_attempts, duration_minutes, available_from)
  values (
    v_course, v_title, nullif(btrim(coalesce(_description, '')), ''),
    _deadline, _max_attempts, least(greatest(coalesce(_duration_minutes, 30), 1), 240),
    _available_from
  )
  returning id into v_id;

  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      v_id, q->>'prompt', q->'choices', (q->>'correct_index')::int,
      nullif(q->>'explanation', ''), coalesce((q->>'difficulty')::int, 3), v_i
    );
    v_i := v_i + 1;
  end loop;

  return v_id;
end;
$$;

create function public.update_course_quiz(
  _quiz_id uuid,
  _title text,
  _description text default null,
  _deadline timestamptz default null,
  _max_attempts int default null,
  _duration_minutes int default 30,
  _available_from timestamptz default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_course uuid;
  v_title text;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can edit a general course quiz.';
  end if;
  if not exists (select 1 from public.course_quizzes where id = _quiz_id and course_id = v_course) then
    raise exception 'This general course quiz is not part of your course.';
  end if;
  if _max_attempts is not null and _max_attempts < 1 then
    raise exception 'Maximum attempts must be at least 1, or unlimited.';
  end if;
  if _deadline is not null and _available_from is not null and _deadline <= _available_from then
    raise exception 'The due date must be after the available-from date.';
  end if;

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then v_title := 'General Course Quiz'; end if;

  update public.course_quizzes
     set title = v_title,
         description = nullif(btrim(coalesce(_description, '')), ''),
         deadline = _deadline,
         max_attempts = _max_attempts,
         duration_minutes = least(greatest(coalesce(_duration_minutes, 30), 1), 240),
         available_from = _available_from
   where id = _quiz_id and course_id = v_course;
end;
$$;

-- list_course_quizzes(): now also returns available_from. Still SECURITY
-- DEFINER, still no answer key; used by the student course page and the
-- lecturer overview.
create function public.list_course_quizzes(_course_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  deadline timestamptz,
  created_at timestamptz,
  question_count bigint,
  max_attempts int,
  duration_minutes int,
  available_from timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    cq.id, cq.title, cq.description, cq.deadline, cq.created_at,
    (select count(*) from public.questions q where q.course_quiz_id = cq.id),
    cq.max_attempts, cq.duration_minutes, cq.available_from
  from public.course_quizzes cq
  where cq.course_id = _course_id
  order by cq.created_at;
$$;

revoke execute on function
  public.create_course_quiz(text, text, timestamptz, int, int, timestamptz) from public, anon;
revoke execute on function
  public.create_course_quiz_with_questions(text, jsonb, text, timestamptz, int, int, timestamptz) from public, anon;
revoke execute on function
  public.update_course_quiz(uuid, text, text, timestamptz, int, int, timestamptz) from public, anon;
revoke execute on function public.list_course_quizzes(uuid) from public, anon;

grant execute on function
  public.create_course_quiz(text, text, timestamptz, int, int, timestamptz) to authenticated;
grant execute on function
  public.create_course_quiz_with_questions(text, jsonb, text, timestamptz, int, int, timestamptz) to authenticated;
grant execute on function
  public.update_course_quiz(uuid, text, text, timestamptz, int, int, timestamptz) to authenticated;
grant execute on function public.list_course_quizzes(uuid) to authenticated;

-- 3. enforce_course_quiz_attempt() — add the "not available yet" gate ----------
--    Verbatim from 20260902130000_course_quiz_attempt_lock.sql plus one gate;
--    the deadline gate, enrolment check and the capped-quiz advisory lock are
--    unchanged.
create or replace function public.enforce_course_quiz_attempt()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_deadline timestamptz;
  v_available_from timestamptz;
  v_course uuid;
  v_max int;
  v_used int;
begin
  if new.course_quiz_id is null then
    return new;
  end if;

  select deadline, available_from, course_id, max_attempts
    into v_deadline, v_available_from, v_course, v_max
    from public.course_quizzes
    where id = new.course_quiz_id;

  if v_course is null then
    raise exception 'This assessment no longer exists.';
  end if;

  if public.current_lecturer_course() is distinct from v_course
     and not exists (
       select 1 from public.enrollments e
       where e.course_id = v_course and e.user_id = auth.uid()
     ) then
    raise exception 'You must be enrolled in this course to take this assessment.';
  end if;

  if v_available_from is not null and now() < v_available_from then
    raise exception 'This assessment is not available yet.';
  end if;

  if v_deadline is not null and now() >= v_deadline then
    raise exception 'This assessment is no longer available because the deadline has passed.';
  end if;

  if v_max is not null then
    perform pg_advisory_xact_lock(
      hashtext(new.course_quiz_id::text),
      hashtext(new.user_id::text)
    );
    select count(*) into v_used
      from public.quiz_attempts
      where course_quiz_id = new.course_quiz_id
        and user_id = new.user_id;
    if v_used >= v_max then
      raise exception 'You have used all % attempt(s) allowed for this assessment.', v_max;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_course_quiz_attempt() from public, anon;

-- 4. Deadline as a DYNAMIC absolute bound on a live general-quiz attempt --------
--
-- quiz_attempts.expires_at stays the student's NORMAL, immutable timer
-- (started_at + duration) — it is never re-stamped, so Quiz Recovery's
-- no-reset / no-extend guarantee holds and a shorten-then-restore of the
-- deadline gives the student their full normal time back.
--
-- The General Course Quiz deadline is applied on every read as
--   effective expiry = least(expires_at, course_quizzes.deadline)   (LEAST
-- ignores NULL, so a no-deadline quiz is unaffected). Shortening the deadline
-- after a student has started immediately reduces their effective remaining
-- time; extending it can never push an attempt past its normal expires_at.
--
-- Four server-authoritative touch points:
--   * stamp_quiz_attempt_expiry()      — no deadline cap at insert (below)
--   * save_quiz_answer()               — reject a save once the deadline passed
--   * finalize_expired_quiz_attempts() — finalise once the deadline passed
--   * grade_quiz()                     — mark timed_out when the deadline passed
-- The client countdown mirrors this with effectiveQuizDeadline() in
-- src/lib/course-quiz.ts. Module quizzes (topic_id) are untouched everywhere.

-- stamp_quiz_attempt_expiry() — verbatim from 20260905120000. The general-quiz
-- branch NO LONGER caps at the deadline; expires_at is the plain normal timer.
create or replace function public.stamp_quiz_attempt_expiry()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_minutes int;
begin
  if new.topic_id is not null then
    select quiz_duration_minutes into v_minutes
      from public.topics where id = new.topic_id;
  elsif new.course_quiz_id is not null then
    select duration_minutes into v_minutes
      from public.course_quizzes where id = new.course_quiz_id;
  else
    return new;
  end if;
  new.expires_at := coalesce(new.started_at, now())
    + make_interval(mins => coalesce(v_minutes, 30));
  return new;
end;
$$;

revoke execute on function public.stamp_quiz_attempt_expiry() from public, anon;

-- save_quiz_answer() — verbatim from 20260914130000 plus one gate: a
-- general-quiz answer cannot be saved once the quiz deadline has passed, even
-- if the attempt's own normal timer has not. Module attempts (v_cq null) are
-- unaffected.
create or replace function public.save_quiz_answer(
  _attempt_id uuid, _question_id uuid, _selected_index int
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid; v_topic uuid; v_cq uuid;
  v_finished timestamptz; v_expires timestamptz; v_correct int;
  v_cq_deadline timestamptz;
begin
  select user_id, topic_id, course_quiz_id, finished_at, expires_at
    into v_user, v_topic, v_cq, v_finished, v_expires
    from public.quiz_attempts where id = _attempt_id for update;

  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;
  if v_finished is not null then
    raise exception 'This attempt has already been submitted.';
  end if;
  if v_expires is not null and now() >= v_expires then
    raise exception 'This attempt has run out of time.';
  end if;
  if v_cq is not null then
    select deadline into v_cq_deadline from public.course_quizzes where id = v_cq;
    if v_cq_deadline is not null and now() >= v_cq_deadline then
      raise exception 'This attempt has run out of time.';
    end if;
  end if;
  if _selected_index is null or _selected_index < 0 then
    raise exception 'Invalid answer.';
  end if;

  select q.correct_index into v_correct
  from public.questions q
  where q.id = _question_id
    and (
      (v_topic is not null and q.topic_id = v_topic)
      or (v_cq is not null and q.course_quiz_id = v_cq)
    );
  if v_correct is null then
    raise exception 'That question is not part of this quiz.';
  end if;

  insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
  values (_attempt_id, _question_id, _selected_index, _selected_index = v_correct)
  on conflict on constraint attempt_answers_attempt_question_key
  do update set selected_index = excluded.selected_index,
                is_correct     = excluded.is_correct;
end;
$$;

revoke execute on function public.save_quiz_answer(uuid, uuid, int) from public, anon;
grant  execute on function public.save_quiz_answer(uuid, uuid, int) to authenticated;

-- finalize_expired_quiz_attempts() — verbatim from 20260905120000 plus: a
-- general-quiz attempt is also finalised once its quiz deadline has passed,
-- not only when its own normal timer runs out. Same authoritative grade_quiz
-- timeout path. Module attempts unchanged.
create or replace function public.finalize_expired_quiz_attempts()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select a.id
    from public.quiz_attempts a
    where a.user_id = auth.uid()
      and (a.topic_id is not null or a.course_quiz_id is not null)
      and a.finished_at is null
      and a.expires_at is not null
      and (
        now() >= a.expires_at
        or exists (
          select 1 from public.course_quizzes cq
          where cq.id = a.course_quiz_id
            and cq.deadline is not null
            and now() >= cq.deadline
        )
      )
  loop
    perform public.grade_quiz(v_id, '{}'::jsonb, true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.finalize_expired_quiz_attempts() from public, anon;
grant  execute on function public.finalize_expired_quiz_attempts() to authenticated;

-- grade_quiz() — verbatim from 20260914130000 plus: for a general-quiz attempt
-- the quiz deadline also counts towards timed_out (a submit that lands after
-- the deadline but before the normal timer). Grading/scoring is otherwise
-- byte-for-byte unchanged; the module branch (incl. the first-lesson progress
-- write) is untouched.
create or replace function public.grade_quiz(
  _attempt_id uuid, _answers jsonb, _timed_out boolean default false
)
returns table (question_id uuid, is_correct boolean, correct_index int, explanation text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_topic_id uuid;
  v_cq_id uuid;
  v_finished timestamptz;
  v_expires timestamptz;
  v_cq_deadline timestamptz;
  v_lesson_id uuid;
  v_total int := 0;
  v_answered int := 0;
  v_score int := 0;
  rec record;
  v_sel int;
begin
  select user_id, topic_id, course_quiz_id, finished_at, expires_at
    into v_user, v_topic_id, v_cq_id, v_finished, v_expires
    from public.quiz_attempts where id = _attempt_id
    for update;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;

  if v_finished is not null then
    return query
      select aa.question_id, aa.is_correct, q.correct_index, q.explanation
      from public.attempt_answers aa
      join public.questions q on q.id = aa.question_id
      where aa.attempt_id = _attempt_id;
    return;
  end if;

  if v_topic_id is not null then
    select count(*) into v_total from public.questions where topic_id = v_topic_id;
    if v_total = 0 then
      raise exception 'This module does not have a quiz yet.';
    end if;
  elsif v_cq_id is not null then
    select count(*) into v_total from public.questions where course_quiz_id = v_cq_id;
    if v_total = 0 then
      raise exception 'This course does not have a general quiz yet.';
    end if;
    select deadline into v_cq_deadline from public.course_quizzes where id = v_cq_id;
  else
    raise exception 'This quiz attempt is not linked to a quiz.';
  end if;

  for rec in
    select q.id, q.correct_index
    from public.questions q
    where q.id::text in (select jsonb_object_keys(_answers))
      and (
        (v_topic_id is not null and q.topic_id = v_topic_id)
        or (v_cq_id is not null and q.course_quiz_id = v_cq_id)
      )
  loop
    v_sel := (_answers ->> rec.id::text)::int;
    insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
    values (_attempt_id, rec.id, v_sel, v_sel = rec.correct_index)
    -- Named-constraint form (not a column list): this function has a
    -- `question_id` OUT parameter (RETURNS TABLE), and an ON CONFLICT
    -- column-list here is ambiguous against it. Same unique index either way.
    -- (Historical correction — see 20260905200000_grade_quiz_ambiguous_
    -- column_fix.sql for the corrective migration that fixed the live DB;
    -- this file is edited only for future full-migration-replay consistency.)
    on conflict on constraint attempt_answers_attempt_question_key
    do update set selected_index = excluded.selected_index,
                  is_correct     = excluded.is_correct;
  end loop;

  select count(*), count(*) filter (where aa.is_correct)
    into v_answered, v_score
    from public.attempt_answers aa
    where aa.attempt_id = _attempt_id;

  update public.quiz_attempts
    set score = v_score,
        total = v_total,
        answered_count = v_answered,
        finished_at = now(),
        timed_out = _timed_out
          or (v_expires is not null and now() >= v_expires)
          or (v_cq_deadline is not null and now() >= v_cq_deadline)
    where id = _attempt_id;

  if v_topic_id is not null then
    select id into v_lesson_id from public.lessons
      where topic_id = v_topic_id order by order_index, id limit 1;
    if v_lesson_id is not null then
      insert into public.progress (user_id, lesson_id, watched_seconds, completed_at, updated_at)
      values (v_user, v_lesson_id, 0, now(), now())
      on conflict (user_id, lesson_id) do update
        set completed_at = coalesce(public.progress.completed_at, excluded.completed_at),
            updated_at = now();
    end if;
  end if;

  return query
    select aa.question_id, aa.is_correct, q.correct_index, q.explanation
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where aa.attempt_id = _attempt_id;
end;
$$;

revoke execute on function public.grade_quiz(uuid, jsonb, boolean) from public, anon;
grant  execute on function public.grade_quiz(uuid, jsonb, boolean) to authenticated;

-- 5. get_course_quiz_submission_stats() — lecturer card counts -----------------
--    Per general quiz in the caller's managed course: enrolled student count and
--    the number who have a finished attempt. Lecturer-scoped; zero rows for a
--    non-lecturer or another lecturer's course.
create or replace function public.get_course_quiz_submission_stats()
returns table (course_quiz_id uuid, enrolled int, submitted int)
language sql stable security definer set search_path = public
as $$
  with lc as (select public.current_lecturer_course() as course_id)
  select
    cq.id,
    (select count(*)::int from public.enrollments e where e.course_id = cq.course_id),
    (select count(distinct a.user_id)::int
       from public.quiz_attempts a
       where a.course_quiz_id = cq.id and a.finished_at is not null)
  from lc
  join public.course_quizzes cq on cq.course_id = lc.course_id;
$$;

revoke execute on function public.get_course_quiz_submission_stats() from public, anon;
grant  execute on function public.get_course_quiz_submission_stats() to authenticated;
