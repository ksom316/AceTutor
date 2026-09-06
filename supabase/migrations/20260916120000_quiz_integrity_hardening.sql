-- P2.2A — Official Quiz Integrity Hardening.
--
-- Closes three confirmed P2.1 findings. NOTHING here rewrites historical data
-- (no deletes, no score rewrites, no Mastery edits) — it only hardens future
-- access and writes.
--
--   SEC-01  public.questions had `for select to authenticated using (true)` —
--           any student could read correct_index / explanation directly and
--           skip every quiz. Now: students get questions ONLY through the
--           sanitized RPCs (get_quiz_questions / get_course_quiz_questions,
--           unchanged); lecturers keep direct read of their OWN course's
--           questions; finished-attempt review moves to a new SECURITY DEFINER
--           RPC (get_attempt_review) that a student can call only for their
--           own, finished attempt.
--
--   SEC-02  quiz_attempts INSERT only checked `user_id`, and a blanket
--           `attempts_update_own` let a client set score / total / finished_at
--           directly — forging Mastery, module completion and lecturer
--           analytics. Now: INSERT is constrained to a genuinely fresh,
--           un-graded row (the exact schema defaults); the client UPDATE
--           policy is removed entirely (grading stays inside the SECURITY
--           DEFINER functions grade_quiz / save_quiz_answer /
--           finalize_expired_quiz_attempts, which run as owner and bypass
--           RLS); attempt_answers loses all client write access (is_correct
--           was client-suppliable).
--
--   SEC-03  a MODULE quiz attempt skipped every check in
--           enforce_course_quiz_attempt() — course content is world-readable,
--           so any authenticated user could start a module quiz for a course
--           they never joined. Now: a module attempt requires enrollment in
--           that module's course (or being that course's lecturer), mirroring
--           the existing General Course Quiz rule. get_course_quiz_performance()
--           is additionally filtered to enrolled students on the module side so
--           legacy stray attempts don't pollute lecturer analytics.
--
--   SEC-02a a student could still `.from('quiz_attempts').delete().eq('id', …)`
--           one owned attempt from the console — selectively dropping a poor
--           latest official attempt changes which attempt is "latest completed"
--           and so manipulates Mastery / analytics / remedial evidence. Now:
--           no client DELETE on quiz_attempts at all; the Settings "Reset
--           account data" feature moves to an atomic SECURITY DEFINER RPC
--           (reset_my_learning_data) that only ever touches auth.uid()'s rows
--           and takes no id/user argument.
--
-- MANUAL: apply in the Supabase SQL Editor. Policy swaps + three new SECURITY
-- DEFINER read RPCs + one reset RPC + two trigger/analytics-function recreations.

-- ============================================================================
-- SEC-01 — questions: no direct student read
-- ============================================================================

drop policy if exists "Authenticated can read questions" on public.questions;

-- Lecturers keep DIRECT read of their own course's questions (the quiz editor
-- needs correct_index / explanation). Same course-scoping as
-- questions_lecturer_write. A non-lecturer's current_lecturer_course() is NULL,
-- so the IN (...) lists are empty and they see zero rows.
drop policy if exists "questions_lecturer_read" on public.questions;
create policy "questions_lecturer_read" on public.questions
  for select to authenticated
  using (
    (topic_id in (select t.id from public.topics t where t.course_id = public.current_lecturer_course()))
    or
    (course_quiz_id in (select cq.id from public.course_quizzes cq where cq.course_id = public.current_lecturer_course()))
  );

-- Finished-attempt review. The caller may see the answer key ONLY for their
-- own, FINISHED attempt. topic_id / course_quiz_id are derived from the
-- attempt row — never from a client argument. One row per question in the
-- quiz, LEFT JOINed to the caller's own attempt_answers (unanswered questions
-- come back with selected_index / is_correct NULL).
create or replace function public.get_attempt_review(_attempt_id uuid)
returns table (
  question_id    uuid,
  prompt         text,
  choices        jsonb,
  correct_index  int,
  explanation    text,
  order_index    int,
  selected_index int,
  is_correct     boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user     uuid;
  v_topic    uuid;
  v_cq       uuid;
  v_finished timestamptz;
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;

  select user_id, topic_id, course_quiz_id, finished_at
    into v_user, v_topic, v_cq, v_finished
  from public.quiz_attempts
  where id = _attempt_id;

  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;
  if v_finished is null then
    raise exception 'ATTEMPT_NOT_FINISHED';
  end if;

  return query
    select
      q.id, q.prompt, q.choices, q.correct_index, q.explanation, q.order_index,
      aa.selected_index, aa.is_correct
    from public.questions q
    left join public.attempt_answers aa
      on aa.question_id = q.id and aa.attempt_id = _attempt_id
    where (v_topic is not null and q.topic_id = v_topic)
       or (v_cq   is not null and q.course_quiz_id = v_cq)
    order by q.order_index, q.id;
end;
$$;

revoke execute on function public.get_attempt_review(uuid) from public, anon;
grant  execute on function public.get_attempt_review(uuid) to authenticated;

-- "Which of these modules have a quiz published?" — an existence check the
-- student-facing Take-a-Quiz list and the module page need. Returns ONLY the
-- topic ids, never any question content.
create or replace function public.topics_with_questions(_topic_ids uuid[])
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select distinct q.topic_id
  from public.questions q
  where q.topic_id = any(_topic_ids)
    and q.topic_id is not null;
$$;

revoke execute on function public.topics_with_questions(uuid[]) from public, anon;
grant  execute on function public.topics_with_questions(uuid[]) to authenticated;

-- Question PROMPTS only (no choices / correct_index / explanation) — same
-- sensitivity as get_quiz_questions(). Used for AI grounding of remedial
-- content over a Study Path's own weak_question_ids.
create or replace function public.get_question_prompts(_question_ids uuid[])
returns table (id uuid, prompt text)
language sql stable security definer set search_path = public
as $$
  select q.id, q.prompt
  from public.questions q
  where q.id = any(_question_ids);
$$;

revoke execute on function public.get_question_prompts(uuid[]) from public, anon;
grant  execute on function public.get_question_prompts(uuid[]) to authenticated;

-- ============================================================================
-- SEC-02 — quiz_attempts / attempt_answers: writes are RPC-only
-- ============================================================================

-- INSERT: only a genuinely fresh, un-graded attempt. score / total default 0,
-- answered_count has no default (NULL), finished_at NULL, timed_out default
-- false — a client cannot fabricate a completed/graded row on insert. The
-- BEFORE INSERT triggers (enrollment, one-active, expiry stamp) still run.
drop policy if exists "attempts_insert_own" on public.quiz_attempts;
create policy "attempts_insert_own" on public.quiz_attempts
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and finished_at is null
    and score = 0
    and total = 0
    and answered_count is null
    and timed_out = false
  );

-- UPDATE: removed. No browser code updates quiz_attempts directly — grading,
-- answer saves and timeout finalisation all go through grade_quiz() /
-- save_quiz_answer() / finalize_expired_quiz_attempts(), which are SECURITY
-- DEFINER (run as owner, not subject to RLS).
drop policy if exists "attempts_update_own" on public.quiz_attempts;

-- DELETE (SEC-02a): removed. A per-row `delete().eq('id', …)` let a student
-- drop a single poor/latest official attempt from the console and so change
-- which attempt is "latest completed" (Mastery / analytics / remedial
-- evidence). The ONLY legitimate client deletion — the Settings "Reset
-- account data" feature — now goes through reset_my_learning_data() (below).
-- The UPDATE/DELETE table privileges are pulled back too (DiD — RLS already
-- denies both now that neither policy exists).
drop policy if exists "attempts_delete_own" on public.quiz_attempts;
revoke update, delete on public.quiz_attempts from anon, authenticated;

-- attempt_answers: browser gets SELECT only (still gated to a FINISHED
-- attempt). is_correct was client-suppliable; the only legitimate writers are
-- save_quiz_answer() and grade_quiz() (SECURITY DEFINER). Cascade delete from
-- quiz_attempts still cleans these up on account reset.
drop policy if exists "answers_insert_own" on public.attempt_answers;
drop policy if exists "answers_delete_own" on public.attempt_answers;
revoke insert, update, delete on public.attempt_answers from anon, authenticated;

-- The Settings "Reset account data" feature — atomic, own-data-only. Mirrors
-- the EXACT set of tables the old client flow cleared (enrollments, lesson
-- progress, study time, quiz history, learning preferences, VARK, interaction
-- log). Deleting the caller's quiz_attempts cascades to attempt_answers,
-- study_paths (attempt_id FK) and the learning_interactions that reference
-- either; the final learning_interactions delete mops up the rest (lesson
-- opens, modality selections, practice-quiz events). Profile name / password /
-- AI conversations are NOT touched — same as before. Takes NO id / user_id
-- argument: a client cannot target another user or a single attempt.
create or replace function public.reset_my_learning_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  delete from public.quiz_attempts        where user_id = v_uid;
  delete from public.progress             where user_id = v_uid;
  delete from public.study_sessions       where user_id = v_uid;
  delete from public.enrollments          where user_id = v_uid;
  delete from public.learning_preferences where user_id = v_uid;
  delete from public.vark_profiles        where user_id = v_uid;
  delete from public.learning_interactions where user_id = v_uid;
end;
$$;

revoke execute on function public.reset_my_learning_data() from public, anon;
grant  execute on function public.reset_my_learning_data() to authenticated;

-- ============================================================================
-- SEC-03 — a MODULE quiz attempt requires enrollment
-- ============================================================================

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
  -- MODULE attempt (SEC-03): historically this function returned early for
  -- topic_id attempts, so no enrollment/availability check applied. Course
  -- content is world-readable, so any authenticated user could discover a
  -- topic id and start/submit its quiz. Now: enrollment in that module's
  -- course is required (or being that course's own lecturer — preview).
  if new.topic_id is not null then
    select t.course_id into v_course from public.topics t where t.id = new.topic_id;
    if v_course is null then
      raise exception 'This module no longer exists.';
    end if;
    if public.current_lecturer_course() is distinct from v_course
       and not exists (
         select 1 from public.enrollments e
         where e.course_id = v_course and e.user_id = auth.uid()
       ) then
      raise exception 'You must be enrolled in this course to take this quiz.';
    end if;
    return new;
  end if;

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

-- ============================================================================
-- SEC-03 / analytics — module performance is scoped to enrolled students
-- ============================================================================

create or replace function public.get_course_quiz_performance()
returns table (
  attempt_id uuid, student text, quiz_type text, quiz_title text,
  topic text, topic_id uuid, course_quiz_id uuid,
  score integer, total integer, pct integer, answered_count integer,
  started_at timestamptz, finished_at timestamptz,
  completed boolean, timed_out boolean, expired boolean
)
language sql stable security definer set search_path = public
as $$
  with lc as (select public.current_lecturer_course() as course_id)
  select
    a.id, p.full_name, 'module'::text, t.title, t.title, t.id, null::uuid,
    a.score, a.total,
    case when a.total > 0 then round(a.score::numeric / a.total * 100)::integer else 0 end,
    a.answered_count, a.started_at, a.finished_at,
    a.finished_at is not null, a.timed_out,
    a.finished_at is null and a.expires_at is not null and now() >= a.expires_at
  from lc
  join public.topics t on t.course_id = lc.course_id
  join public.quiz_attempts a on a.topic_id = t.id
  join public.profiles p on p.id = a.user_id
  -- SEC-03: only attempts by students actually enrolled in the course. A
  -- non-enrolled attempt (only possible from legacy data now that
  -- enforce_course_quiz_attempt blocks it) never feeds module analytics.
  where exists (
    select 1 from public.enrollments e
    where e.course_id = lc.course_id and e.user_id = a.user_id
  )

  union all

  select
    a.id, p.full_name, 'general'::text, cq.title, null::text, null::uuid, cq.id,
    a.score, a.total,
    case when a.total > 0 then round(a.score::numeric / a.total * 100)::integer else 0 end,
    a.answered_count, a.started_at, a.finished_at,
    a.finished_at is not null, a.timed_out,
    a.finished_at is null and a.expires_at is not null and now() >= a.expires_at
  from lc
  join public.course_quizzes cq on cq.course_id = lc.course_id
  join public.quiz_attempts a on a.course_quiz_id = cq.id
  join public.profiles p on p.id = a.user_id

  order by started_at desc;
$$;

revoke execute on function public.get_course_quiz_performance() from public, anon;
grant  execute on function public.get_course_quiz_performance() to authenticated;
