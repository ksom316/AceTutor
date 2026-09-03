-- Mastery System Phase M1 — one new lecturer-scoped read function.
--
-- ADDITIVE ONLY. No table, column, type, trigger, policy or existing function is
-- changed. Mastery for STUDENTS is derived entirely client-side from the
-- quiz_attempts rows a student already reads under the `attempts_select_own`
-- policy — no schema support is needed there. This migration exists solely so a
-- LECTURER can read the same raw module-quiz attempts for the students enrolled
-- in the course they manage, through the existing SECURITY DEFINER +
-- current_lecturer_course() authorization pattern (never client-only filtering).
--
--   Module Mastery = % of a student's most recent COMPLETED official module-quiz
--   attempt (topic_id set, finished, >= 1 answered). General Course Quizzes carry
--   topic_id = null and are excluded here by the `a.topic_id = t.id` join.
--
-- get_course_student_mastery() returns the raw finished module-quiz attempts for
-- enrolled students; the shared pure model (src/lib/mastery.ts) does the
-- "latest / previous / level / trend / course average" interpretation, so the
-- lecturer view and the student view can never diverge.

create or replace function public.get_course_student_mastery()
returns table (
  user_id        uuid,
  full_name      text,
  attempt_id     uuid,
  topic_id       uuid,
  topic_title    text,
  score          integer,
  total          integer,
  answered_count integer,
  started_at     timestamptz,
  finished_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with lc as (select public.current_lecturer_course() as course_id)
  select
    a.user_id,
    p.full_name,
    a.id,
    a.topic_id,
    t.title,
    a.score,
    a.total,
    a.answered_count,
    a.started_at,
    a.finished_at
  from lc
  join public.topics t         on t.course_id = lc.course_id
  join public.quiz_attempts a  on a.topic_id = t.id
                              and a.finished_at is not null
  join public.profiles p       on p.id = a.user_id
  where exists (
    select 1 from public.enrollments e
    where e.course_id = lc.course_id
      and e.user_id = a.user_id
  );
$$;

comment on function public.get_course_student_mastery() is
  'Finished MODULE-quiz attempts for students enrolled in the caller''s managed course (current_lecturer_course()). General Course Quiz attempts are excluded. Returns zero rows for a non-lecturer or another lecturer''s course. src/lib/mastery.ts interprets these rows.';

revoke execute on function public.get_course_student_mastery() from public, anon;
grant  execute on function public.get_course_student_mastery() to authenticated;
