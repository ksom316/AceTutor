-- Include General Course Quiz attempts in the lecturer performance report.
--
-- get_course_quiz_performance() (added in 20260830120100, unchanged since) only
-- returned module/topic quiz attempts because it joined quiz_attempts.topic_id
-- to the lecturer's topics. General Course Quiz attempts use
-- quiz_attempts.course_quiz_id and were invisible on /lecturer/performance.
--
-- This migration redefines the function to UNION ALL the two attempt kinds:
--   * module  — quiz_attempts.topic_id -> topics (course_id = <lecturer course>)
--   * general — quiz_attempts.course_quiz_id -> course_quizzes (course_id = ...)
-- Both branches derive the course from current_lecturer_course() exactly as
-- before — no course id is accepted from the client, and a non-lecturer / other
-- lecturer still gets zero rows. Student email / VARK are never selected.
--
-- Return shape gains: quiz_type ('module' | 'general'), quiz_title, and
-- course_quiz_id. topic / topic_id keep their exact previous meaning for module
-- rows (and are NULL for general rows), so existing module-quiz reporting is
-- unchanged. A general row has topic / topic_id NULL and course_quiz_id set.
--
-- Signature (return columns) changes, so the old function is dropped first.
-- Nothing else is touched: grading, attempt-limit trigger, RLS, module quizzes,
-- student flows, AI / difficulty / OpenRouter are all untouched.

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
  started_at timestamptz,
  finished_at timestamptz,
  completed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with lc as (select public.current_lecturer_course() as course_id)
  -- Module / topic quizzes — identical join and semantics to the original.
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
    a.started_at,
    a.finished_at,
    a.finished_at is not null
  from lc
  join public.topics t on t.course_id = lc.course_id
  join public.quiz_attempts a on a.topic_id = t.id
  join public.profiles p on p.id = a.user_id

  union all

  -- General Course Quizzes — belong to the lecturer's course via course_quizzes.
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
    a.started_at,
    a.finished_at,
    a.finished_at is not null
  from lc
  join public.course_quizzes cq on cq.course_id = lc.course_id
  join public.quiz_attempts a on a.course_quiz_id = cq.id
  join public.profiles p on p.id = a.user_id

  order by started_at desc;
$$;

revoke execute on function public.get_course_quiz_performance() from public, anon;
grant execute on function public.get_course_quiz_performance() to authenticated;
