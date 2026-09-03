-- Make the General Course Quiz attempt-limit check atomic under concurrency.
--
-- 20260902120000_course_quiz_max_attempts.sql added a count-then-insert check to
-- enforce_course_quiz_attempt(). Two simultaneous "start attempt" requests from
-- the same student for the same quiz could both read the same count and both be
-- allowed, creating one attempt over the configured maximum.
--
-- Fix: take a transaction-scoped advisory lock keyed on (course_quiz_id,
-- user_id) right before the count. Only capped quizzes (max_attempts IS NOT
-- NULL) take the lock, so unlimited quizzes keep their current concurrency.
-- The lock is released automatically on commit/rollback and only ever blocks
-- another insert for the exact same (quiz, student) pair — enrolment, deadline,
-- RLS, module-quiz (course_quiz_id IS NULL early-return), and grading behaviour
-- are all unchanged.
--
-- Function signature is unchanged, so this is a plain create-or-replace; no
-- other object is touched and no application code changes.

create or replace function public.enforce_course_quiz_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deadline timestamptz;
  v_course uuid;
  v_max int;
  v_used int;
begin
  if new.course_quiz_id is null then
    return new;
  end if;

  select deadline, course_id, max_attempts
    into v_deadline, v_course, v_max
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

  if v_deadline is not null and now() >= v_deadline then
    raise exception 'This assessment is no longer available because the deadline has passed.';
  end if;

  if v_max is not null then
    -- Serialise concurrent "start attempt" requests for this exact
    -- (quiz, student) pair so the count + insert is atomic. Transaction-scoped:
    -- released on commit/rollback. A second concurrent insert blocks here until
    -- the first commits, then re-counts (now seeing the first row) and is
    -- rejected if it would exceed the cap.
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
