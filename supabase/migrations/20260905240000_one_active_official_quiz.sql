-- FIX 2 — at most ONE active official quiz per student, globally.
--
-- Root cause: the only guards were the per-quiz partial unique indexes
-- (`quiz_attempts_one_active_module` / `_one_active_general`). A student could
-- therefore hold an unfinished module-A attempt AND an unfinished module-B
-- attempt AND an unfinished General Course Quiz attempt at the same time
-- (navigating from different courses, opening multiple tabs, or hitting direct
-- URLs).
--
-- This adds a BEFORE INSERT trigger on `quiz_attempts` that:
--   * takes a per-student advisory lock, so two near-simultaneous Starts are
--     serialised and cannot both succeed,
--   * rejects the insert when the student already has ANOTHER unfinished,
--     non-expired official attempt (module or general; a General Course Quiz
--     whose lecturer deadline has passed does not count as active),
--   * allows the SAME quiz through (the per-quiz unique index then turns a
--     double-start into a resume — unchanged Quiz Recovery behaviour).
--
-- Expired / finished attempts never block a new one: `finished_at is null` +
-- `now() < expires_at` exclude them, and the runner routes still call
-- `finalize_expired_quiz_attempts()` first.
--
-- Practice "Quiz Me" never inserts into `quiz_attempts`, so it is unaffected.
-- Grading, Mastery, completion, questions and timers are untouched.
--
-- MANUAL: apply in the Supabase SQL Editor. One function + one trigger; no
-- data change, no backfill.

create or replace function public.enforce_one_active_official_quiz()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_existing uuid;
begin
  if new.topic_id is null and new.course_quiz_id is null then
    return new; -- not an official attempt (defensive; the CHECK already forbids)
  end if;

  -- Serialise concurrent Starts for this student across every official quiz.
  perform pg_advisory_xact_lock(
    hashtext('acetutor:official-quiz-start'),
    hashtext(new.user_id::text)
  );

  select a.id
    into v_existing
  from public.quiz_attempts a
  where a.user_id = new.user_id
    and a.finished_at is null
    and a.expires_at is not null
    and now() < a.expires_at
    -- a different quiz from the one being started
    and not (
      (a.topic_id is not null and a.topic_id = new.topic_id)
      or (a.course_quiz_id is not null and a.course_quiz_id = new.course_quiz_id)
    )
    -- a General Course Quiz past its lecturer deadline is not "active"
    and not exists (
      select 1 from public.course_quizzes cq
      where cq.id = a.course_quiz_id
        and cq.deadline is not null
        and now() >= cq.deadline
    )
  limit 1;

  if v_existing is not null then
    raise exception
      'ONE_ACTIVE_OFFICIAL_QUIZ: You already have a quiz in progress. Finish it (or let its timer run out) before starting a new one.'
      using errcode = 'P0001', detail = v_existing::text;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_one_active_official_quiz() from public, anon;

-- Fires after trg_enforce_course_quiz_attempt (name order) and before
-- trg_stamp_quiz_attempt_expiry — the guard runs before the row is stamped.
drop trigger if exists trg_enforce_one_active_official_quiz on public.quiz_attempts;
create trigger trg_enforce_one_active_official_quiz
  before insert on public.quiz_attempts
  for each row execute function public.enforce_one_active_official_quiz();
