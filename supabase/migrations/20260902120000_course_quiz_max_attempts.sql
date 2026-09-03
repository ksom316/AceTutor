-- Lecturer-configurable maximum retry attempts for General Course Quizzes.
--
-- Builds on 20260901120000_course_general_quizzes_multi.sql. Each general course
-- quiz can now cap how many times a student may attempt it. NULL = unlimited,
-- which is the existing behaviour, so every current row and every new quiz keeps
-- working exactly as before with no data migration.
--
-- Enforcement is added to the SAME BEFORE INSERT trigger that already gates
-- general-quiz attempts (enrolment + deadline). The trigger counts EVERY
-- quiz_attempts row for that student + quiz (finished or abandoned) so the limit
-- cannot be gamed by quitting before submitting. Existing attempts are only
-- counted — never modified or deleted — and grade_quiz is untouched, so an
-- attempt already started continues through the normal grading flow.
--
-- NOT touched: module quizzes (the trigger still early-returns when
-- course_quiz_id IS NULL), quiz_attempts structure, RLS, grade_quiz, the
-- difficulty / AI generation code, OpenRouter config.

-- 1. course_quizzes.max_attempts -------------------------------------------
alter table public.course_quizzes add column if not exists max_attempts int;

alter table public.course_quizzes drop constraint if exists course_quizzes_max_attempts_ck;
alter table public.course_quizzes
  add constraint course_quizzes_max_attempts_ck
  check (max_attempts is null or max_attempts >= 1);

-- 2. Enforce enrolment + deadline + attempt cap on every general-quiz attempt ---
--    Module attempts (course_quiz_id NULL) still pass straight through. The
--    enrolment and deadline checks are unchanged; only the attempt-cap block is
--    new. Counting all rows for (course_quiz_id, user_id) means an abandoned
--    attempt still consumes an allowance.
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

drop trigger if exists trg_enforce_course_quiz_attempt on public.quiz_attempts;
create trigger trg_enforce_course_quiz_attempt
  before insert on public.quiz_attempts
  for each row execute function public.enforce_course_quiz_attempt();

-- 3. Re-key the create / update / list RPCs to carry max_attempts -------------
--    Signature changes (new trailing argument), so drop the old signatures
--    first to avoid leaving a stale overload.
drop function if exists public.create_course_quiz(text, text, timestamptz);
drop function if exists public.update_course_quiz(uuid, text, text, timestamptz);
drop function if exists public.list_course_quizzes(uuid);

-- create_course_quiz(): explicitly create a new general quiz for the caller's
-- course. Course is derived from current_lecturer_course() only.
create or replace function public.create_course_quiz(
  _title text,
  _description text default null,
  _deadline timestamptz default null,
  _max_attempts int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
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

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then
    v_title := 'General Course Quiz';
  end if;

  insert into public.course_quizzes (course_id, title, description, deadline, max_attempts)
  values (
    v_course,
    v_title,
    nullif(btrim(coalesce(_description, '')), ''),
    _deadline,
    _max_attempts
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- update_course_quiz(): edit a general quiz's basic info. Ownership is verified
-- against current_lecturer_course(); a client-supplied id for another course is
-- rejected.
create or replace function public.update_course_quiz(
  _quiz_id uuid,
  _title text,
  _description text default null,
  _deadline timestamptz default null,
  _max_attempts int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_title text;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can edit a general course quiz.';
  end if;
  if not exists (
    select 1 from public.course_quizzes where id = _quiz_id and course_id = v_course
  ) then
    raise exception 'This general course quiz is not part of your course.';
  end if;
  if _max_attempts is not null and _max_attempts < 1 then
    raise exception 'Maximum attempts must be at least 1, or unlimited.';
  end if;

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then
    v_title := 'General Course Quiz';
  end if;

  update public.course_quizzes
     set title = v_title,
         description = nullif(btrim(coalesce(_description, '')), ''),
         deadline = _deadline,
         max_attempts = _max_attempts
   where id = _quiz_id and course_id = v_course;
end;
$$;

-- list_course_quizzes(): every general quiz for a course plus its question count
-- and attempt cap. SECURITY DEFINER because students have no direct SELECT on
-- questions; returns nothing sensitive (no answer key).
create or replace function public.list_course_quizzes(_course_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  deadline timestamptz,
  created_at timestamptz,
  question_count bigint,
  max_attempts int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cq.id,
    cq.title,
    cq.description,
    cq.deadline,
    cq.created_at,
    (select count(*) from public.questions q where q.course_quiz_id = cq.id),
    cq.max_attempts
  from public.course_quizzes cq
  where cq.course_id = _course_id
  order by cq.created_at;
$$;

-- 4. Grants ------------------------------------------------------------------
revoke execute on function public.create_course_quiz(text, text, timestamptz, int) from public, anon;
revoke execute on function public.update_course_quiz(uuid, text, text, timestamptz, int) from public, anon;
revoke execute on function public.list_course_quizzes(uuid) from public, anon;

grant execute on function public.create_course_quiz(text, text, timestamptz, int) to authenticated;
grant execute on function public.update_course_quiz(uuid, text, text, timestamptz, int) to authenticated;
grant execute on function public.list_course_quizzes(uuid) to authenticated;
