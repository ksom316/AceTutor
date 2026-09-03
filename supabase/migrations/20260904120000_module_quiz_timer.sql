-- Module quiz time limits + server-authoritative timer + completion status.
--
-- Reuses the existing quiz_attempts / attempt_answers / grade_quiz architecture.
-- No new attempt or result table. NOT touched: General Course Quiz retry limits
-- (enforce_course_quiz_attempt / the max_attempts triggers), module quiz retry
-- behaviour, RLS, or lecturer course isolation.
--
-- What this adds:
--   * topics.quiz_duration_minutes  — the module quiz time limit (default 30)
--   * quiz_attempts.expires_at      — authoritative deadline for a module attempt
--     (started_at + duration), stamped by a BEFORE INSERT trigger so a client
--     cannot set or fake it. NULL for General Course Quiz attempts and legacy
--     rows.
--   * quiz_attempts.answered_count  — how many questions were actually answered
--     (set by grade_quiz). NULL for legacy rows => treat as fully answered.
--   * quiz_attempts.timed_out       — the attempt was graded on / after expiry.
--   * grade_quiz(_attempt_id, _answers, _timed_out) — now:
--       - v_total is the FULL question count of the quiz (so score/total is a
--         correct percentage for an incomplete submission),
--       - only grades questions that belong to this attempt's own quiz,
--       - records answered_count and timed_out,
--       - is idempotent: a second call on a finished attempt just re-returns the
--         stored breakdown and never changes the score,
--       - row-locks the attempt so concurrent calls can't double-grade.
--   * finalize_expired_module_attempts() — grades the caller's own module
--     attempts whose timer ran out but were never submitted (closed tab). The
--     quiz runner and result page call it on load, so a late return is finalized
--     server-side without depending on the browser staying open.
--   * get_course_quiz_performance() returns answered_count / timed_out / expired
--     so the lecturer UI can show the three completion states.

-- 1. Module quiz duration -----------------------------------------------------
alter table public.topics
  add column if not exists quiz_duration_minutes int not null default 30;
alter table public.topics drop constraint if exists topics_quiz_duration_ck;
alter table public.topics
  add constraint topics_quiz_duration_ck check (quiz_duration_minutes between 5 and 240);

-- 2. Attempt timer + completeness columns -----------------------------------
alter table public.quiz_attempts add column if not exists expires_at timestamptz;
alter table public.quiz_attempts add column if not exists answered_count int;
alter table public.quiz_attempts add column if not exists timed_out boolean not null default false;

-- 3. Stamp expires_at on every new module attempt --------------------------------
--    General Course Quiz attempts (topic_id NULL) pass straight through, so the
--    max-attempts trigger and its behaviour are unaffected.
create or replace function public.stamp_module_attempt_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes int;
begin
  if new.topic_id is null then
    return new;
  end if;
  select quiz_duration_minutes into v_minutes
    from public.topics where id = new.topic_id;
  new.expires_at := coalesce(new.started_at, now())
    + make_interval(mins => coalesce(v_minutes, 30));
  return new;
end;
$$;

drop trigger if exists trg_stamp_module_attempt_expiry on public.quiz_attempts;
create trigger trg_stamp_module_attempt_expiry
  before insert on public.quiz_attempts
  for each row execute function public.stamp_module_attempt_expiry();

revoke execute on function public.stamp_module_attempt_expiry() from public, anon;

-- 4. grade_quiz — authoritative scoring, timer and completeness -----------------
drop function if exists public.grade_quiz(uuid, jsonb);

create function public.grade_quiz(
  _attempt_id uuid,
  _answers jsonb,
  _timed_out boolean default false
)
returns table (question_id uuid, is_correct boolean, correct_index int, explanation text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_topic_id uuid;
  v_cq_id uuid;
  v_finished timestamptz;
  v_expires timestamptz;
  v_lesson_id uuid;
  v_total int := 0;
  v_answered int := 0;
  v_score int := 0;
  rec record;
  v_sel int;
begin
  -- Row lock: concurrent grade_quiz calls on the same attempt serialise here,
  -- so the second one sees finished_at set and short-circuits below.
  select user_id, topic_id, course_quiz_id, finished_at, expires_at
    into v_user, v_topic_id, v_cq_id, v_finished, v_expires
    from public.quiz_attempts where id = _attempt_id
    for update;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;

  -- Already graded: re-return the stored breakdown, change nothing. Prevents a
  -- late / duplicate submission (timer + manual + finalize sweep) from
  -- producing another valid result.
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
  else
    raise exception 'This quiz attempt is not linked to a quiz.';
  end if;

  -- Grade only the answers for questions that belong to THIS attempt's quiz.
  for rec in
    select q.id, q.correct_index, q.explanation
    from public.questions q
    where q.id::text in (select jsonb_object_keys(_answers))
      and (
        (v_topic_id is not null and q.topic_id = v_topic_id)
        or (v_cq_id is not null and q.course_quiz_id = v_cq_id)
      )
  loop
    v_sel := (_answers ->> rec.id::text)::int;
    v_answered := v_answered + 1;
    insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
    values (_attempt_id, rec.id, v_sel, v_sel = rec.correct_index);
    if v_sel = rec.correct_index then
      v_score := v_score + 1;
    end if;

    question_id := rec.id;
    is_correct := (v_sel = rec.correct_index);
    correct_index := rec.correct_index;
    explanation := rec.explanation;
    return next;
  end loop;

  update public.quiz_attempts
    set score = v_score,
        total = v_total,
        answered_count = v_answered,
        finished_at = now(),
        timed_out = _timed_out or (v_expires is not null and now() >= v_expires)
    where id = _attempt_id;

  -- Module quizzes still mark the module's first lesson complete. General
  -- course quizzes never touch lesson / module progress. (Unchanged.)
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
end;
$$;

revoke execute on function public.grade_quiz(uuid, jsonb, boolean) from public, anon;
grant execute on function public.grade_quiz(uuid, jsonb, boolean) to authenticated;

-- 5. finalize_expired_module_attempts() -------------------------------------------
--    Server-authoritative finalisation of the caller's own timed-out module
--    attempts that were never submitted. No client answers required.
create or replace function public.finalize_expired_module_attempts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select a.id
    from public.quiz_attempts a
    where a.user_id = auth.uid()
      and a.topic_id is not null
      and a.finished_at is null
      and a.expires_at is not null
      and now() >= a.expires_at
  loop
    perform public.grade_quiz(v_id, '{}'::jsonb, true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.finalize_expired_module_attempts() from public, anon;
grant execute on function public.finalize_expired_module_attempts() to authenticated;

-- 6. get_course_quiz_performance — expose completion detail ---------------------
--    Same authorization (current_lecturer_course(), SECURITY DEFINER, no course
--    id argument) and the same two-branch UNION as 20260903120000. Adds
--    answered_count, timed_out and a computed `expired` flag.
drop function if exists public.get_course_quiz_performance();

create function public.get_course_quiz_performance()
returns table (
  attempt_id uuid,
  student text,
  quiz_type text,
  quiz_title text,
  topic text,
  topic_id uuid,
  course_quiz_id uuid,
  score integer,
  total integer,
  pct integer,
  answered_count integer,
  started_at timestamptz,
  finished_at timestamptz,
  completed boolean,
  timed_out boolean,
  expired boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with lc as (select public.current_lecturer_course() as course_id)
  select
    a.id,
    p.full_name,
    'module'::text,
    t.title,
    t.title,
    t.id,
    null::uuid,
    a.score,
    a.total,
    case when a.total > 0 then round(a.score::numeric / a.total * 100)::integer else 0 end,
    a.answered_count,
    a.started_at,
    a.finished_at,
    a.finished_at is not null,
    a.timed_out,
    a.finished_at is null and a.expires_at is not null and now() >= a.expires_at
  from lc
  join public.topics t on t.course_id = lc.course_id
  join public.quiz_attempts a on a.topic_id = t.id
  join public.profiles p on p.id = a.user_id

  union all

  select
    a.id,
    p.full_name,
    'general'::text,
    cq.title,
    null::text,
    null::uuid,
    cq.id,
    a.score,
    a.total,
    case when a.total > 0 then round(a.score::numeric / a.total * 100)::integer else 0 end,
    a.answered_count,
    a.started_at,
    a.finished_at,
    a.finished_at is not null,
    a.timed_out,
    false
  from lc
  join public.course_quizzes cq on cq.course_id = lc.course_id
  join public.quiz_attempts a on a.course_quiz_id = cq.id
  join public.profiles p on p.id = a.user_id

  order by started_at desc;
$$;

revoke execute on function public.get_course_quiz_performance() from public, anon;
grant execute on function public.get_course_quiz_performance() to authenticated;

-- 7. create_module_with_quiz — carry the chosen duration ----------------------
drop function if exists public.create_module_with_quiz(text, text, jsonb, jsonb);

create function public.create_module_with_quiz(
  _title text,
  _summary text,
  _lessons jsonb,
  _questions jsonb,
  _duration_minutes int default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_topic_id uuid;
  v_slug text;
  v_order int;
  v_i int := 0;
  v_duration int;
  l jsonb;
  q jsonb;
  v_modality text;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can create a module.';
  end if;
  if coalesce(trim(_title), '') = '' then
    raise exception 'A module title is required.';
  end if;
  if char_length(trim(_title)) > 200 then
    raise exception 'The module title is too long.';
  end if;

  if _lessons is null or jsonb_typeof(_lessons) <> 'array'
     or jsonb_array_length(_lessons) < 1 then
    raise exception 'A module needs at least one course content before it can be created.';
  end if;
  if _questions is null or jsonb_typeof(_questions) <> 'array'
     or jsonb_array_length(_questions) < 1 then
    raise exception 'A quiz with at least one question is required before this module can be created.';
  end if;
  if jsonb_array_length(_questions) > 50 then
    raise exception 'A quiz can have at most 50 questions.';
  end if;

  v_duration := least(greatest(coalesce(_duration_minutes, 30), 5), 240);

  v_slug := trim(both '-' from regexp_replace(lower(trim(_title)), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    v_slug := 'module';
  end if;
  if exists (select 1 from public.topics where course_id = v_course and slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);
  end if;

  v_order := coalesce((select max(order_index) + 1 from public.topics where course_id = v_course), 0);

  insert into public.topics (course_id, slug, title, summary, order_index, quiz_duration_minutes)
  values (
    v_course,
    v_slug,
    trim(_title),
    nullif(trim(coalesce(_summary, '')), ''),
    v_order,
    v_duration
  )
  returning id into v_topic_id;

  v_i := 0;
  for l in select value from jsonb_array_elements(_lessons)
  loop
    v_modality := coalesce(nullif(l->>'modality', ''), 'text');
    if coalesce(trim(l->>'title'), '') = '' then
      raise exception 'Each course content needs a title.';
    end if;
    if v_modality = 'text' then
      if coalesce(trim(l->>'body_md'), '') = '' then
        raise exception 'A text lesson needs content.';
      end if;
    else
      if coalesce(trim(l->>'media_url'), '') = '' then
        raise exception 'A % lesson needs a file or link.', v_modality;
      end if;
    end if;

    insert into public.lessons (topic_id, modality, title, body_md, media_url, order_index)
    values (
      v_topic_id,
      v_modality::public.modality,
      trim(l->>'title'),
      nullif(trim(coalesce(l->>'body_md', '')), ''),
      nullif(trim(coalesce(l->>'media_url', '')), ''),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  v_i := 0;
  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (topic_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      v_topic_id,
      q->>'prompt',
      q->'choices',
      (q->>'correct_index')::int,
      nullif(q->>'explanation', ''),
      coalesce((q->>'difficulty')::int, 3),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  return v_topic_id;
end;
$$;

revoke execute on function public.create_module_with_quiz(text, text, jsonb, jsonb, int)
  from public, anon;
grant execute on function public.create_module_with_quiz(text, text, jsonb, jsonb, int)
  to authenticated;
