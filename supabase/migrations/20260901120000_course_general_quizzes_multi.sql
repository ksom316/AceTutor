-- Multiple lecturer-created "General Course Quizzes", each with an optional deadline.
--
-- Builds on 20260831160000_course_general_quiz.sql. That migration introduced a
-- single general quiz per course (UNIQUE(course_id) + ensure_course_quiz upsert).
-- A lecturer now needs to run several separate course-wide assessments
-- (mid-semester, final revision, practice, ...), each with its own questions,
-- attempts, status and deadline.
--
-- What changes:
--   * course_quizzes: drop UNIQUE(course_id); add description + nullable deadline
--   * every general-quiz RPC is re-keyed on an explicit course_quizzes.id
--   * creation is explicit (create_course_quiz) — no upsert-by-course
--   * a BEFORE INSERT trigger enforces the deadline + enrolment for every
--     course-quiz attempt, whatever client path inserts it
--
-- What is deliberately NOT touched:
--   * questions / quiz_attempts XOR constraints (questions_owner_ck,
--     quiz_attempts_owner_ck) — still "exactly one of topic_id / course_quiz_id"
--   * grade_quiz — its general-quiz branch already keys on the row's own
--     course_quiz_id, so multiple quizzes need no change; the module branch
--     (incl. the first-lesson progress write) is untouched
--   * create_module_with_quiz, replace_topic_quiz, get_quiz_questions,
--     get_course_quiz_performance — module quizzes behave exactly as before
--   * RLS: course_quizzes_public_read / course_quizzes_lecturer_write and the
--     questions_lecturer_write course-quiz clause are all already written as
--     "course_id = current_lecturer_course()" / "course_quiz_id in (... that
--     course ...)", which is correct for N quizzes per course
--
-- Backward compatibility: the existing course_quizzes row (and any questions /
-- attempts pointing at it) is preserved. description / deadline default to NULL;
-- the default title 'General Course Quiz' stays valid. No data migration.

-- 1. course_quizzes: many-per-course + new fields --------------------------
alter table public.course_quizzes drop constraint if exists course_quizzes_course_id_key;
drop index if exists public.course_quizzes_course_id_key;
create index if not exists course_quizzes_course_id_idx on public.course_quizzes(course_id);

alter table public.course_quizzes add column if not exists description text;
alter table public.course_quizzes add column if not exists deadline timestamptz;

-- 2. Server-side deadline + enrolment enforcement -------------------------------
--    Runs for every INSERT into quiz_attempts. Module attempts (course_quiz_id
--    NULL) are passed straight through untouched. For a general-quiz attempt it
--    requires the caller to be enrolled in the quiz's course (or that course's
--    lecturer) and rejects the insert once the deadline has passed — so a new
--    attempt cannot be started late even by a direct PostgREST insert. An
--    attempt started before the deadline is already a row and is unaffected;
--    grade_quiz still grades it normally.
create or replace function public.enforce_course_quiz_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deadline timestamptz;
  v_course uuid;
begin
  if new.course_quiz_id is null then
    return new;
  end if;

  select deadline, course_id
    into v_deadline, v_course
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

  return new;
end;
$$;

drop trigger if exists trg_enforce_course_quiz_attempt on public.quiz_attempts;
create trigger trg_enforce_course_quiz_attempt
  before insert on public.quiz_attempts
  for each row execute function public.enforce_course_quiz_attempt();

-- 3. Re-key the general-quiz RPCs on an explicit course_quizzes.id -------------
--    Old signatures assumed one quiz per course; drop them so the new argument
--    lists take effect cleanly.
drop function if exists public.ensure_course_quiz();
drop function if exists public.get_course_quiz_questions(uuid, int);
drop function if exists public.replace_course_quiz(jsonb);
drop function if exists public.course_quiz_has_attempts();

-- create_course_quiz(): explicitly create a new general quiz for the caller's
-- course. Course is derived from current_lecturer_course() only.
create or replace function public.create_course_quiz(
  _title text,
  _description text default null,
  _deadline timestamptz default null
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

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then
    v_title := 'General Course Quiz';
  end if;

  insert into public.course_quizzes (course_id, title, description, deadline)
  values (v_course, v_title, nullif(btrim(coalesce(_description, '')), ''), _deadline)
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
  _deadline timestamptz default null
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

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then
    v_title := 'General Course Quiz';
  end if;

  update public.course_quizzes
     set title = v_title,
         description = nullif(btrim(coalesce(_description, '')), ''),
         deadline = _deadline
   where id = _quiz_id and course_id = v_course;
end;
$$;

-- delete_course_quiz(): remove a general quiz. Its questions and attempts (and
-- their answers) go via the existing ON DELETE CASCADE on
-- questions.course_quiz_id / quiz_attempts.course_quiz_id.
create or replace function public.delete_course_quiz(_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can delete a general course quiz.';
  end if;
  delete from public.course_quizzes where id = _quiz_id and course_id = v_course;
  if not found then
    raise exception 'This general course quiz is not part of your course.';
  end if;
end;
$$;

-- get_course_quiz_questions(): sanitized questions (no answer key) for ONE
-- general quiz, mirroring get_quiz_questions. Keyed on the quiz id so it can
-- never return another quiz's questions.
create or replace function public.get_course_quiz_questions(_quiz_id uuid, _limit int default 30)
returns table (id uuid, prompt text, choices jsonb, difficulty int)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.prompt, q.choices, q.difficulty
  from public.questions q
  where q.course_quiz_id = _quiz_id
  order by random()
  limit greatest(coalesce(_limit, 30), 1);
$$;

-- replace_course_quiz(): atomic delete + insert of ONE general quiz's questions,
-- mirroring replace_topic_quiz. Ownership verified via current_lecturer_course().
create or replace function public.replace_course_quiz(_quiz_id uuid, _questions jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_n int;
  v_i int := 0;
  q jsonb;
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
  if _questions is null or jsonb_typeof(_questions) <> 'array' then
    raise exception 'A quiz is required.';
  end if;
  v_n := jsonb_array_length(_questions);
  if v_n < 1 then
    raise exception 'A quiz must have at least one question.';
  end if;
  if v_n > 50 then
    raise exception 'A quiz can have at most 50 questions.';
  end if;

  delete from public.questions where course_quiz_id = _quiz_id;

  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      _quiz_id,
      q->>'prompt',
      q->'choices',
      (q->>'correct_index')::int,
      nullif(q->>'explanation', ''),
      coalesce((q->>'difficulty')::int, 3),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  return _quiz_id;
end;
$$;

-- course_quiz_has_attempts(): whether any student has attempted ONE general
-- quiz (drives the delete/replace warning; quiz_attempts RLS otherwise hides
-- other users' rows from the lecturer). Still lecturer-scoped.
create or replace function public.course_quiz_has_attempts(_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.quiz_attempts a
    join public.course_quizzes cq on cq.id = a.course_quiz_id
    where a.course_quiz_id = _quiz_id
      and cq.course_id = public.current_lecturer_course()
  );
$$;

-- list_course_quizzes(): every general quiz for a course plus its question
-- count. SECURITY DEFINER because students have no direct SELECT on questions;
-- returns nothing sensitive (no answer key). Used by the student course page and
-- the lecturer overview.
create or replace function public.list_course_quizzes(_course_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  deadline timestamptz,
  created_at timestamptz,
  question_count bigint
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
    (select count(*) from public.questions q where q.course_quiz_id = cq.id)
  from public.course_quizzes cq
  where cq.course_id = _course_id
  order by cq.created_at;
$$;

-- 4. Grants ------------------------------------------------------------------
revoke execute on function public.enforce_course_quiz_attempt() from public, anon;
revoke execute on function public.create_course_quiz(text, text, timestamptz) from public, anon;
revoke execute on function public.update_course_quiz(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.delete_course_quiz(uuid) from public, anon;
revoke execute on function public.get_course_quiz_questions(uuid, int) from public, anon;
revoke execute on function public.replace_course_quiz(uuid, jsonb) from public, anon;
revoke execute on function public.course_quiz_has_attempts(uuid) from public, anon;
revoke execute on function public.list_course_quizzes(uuid) from public, anon;

grant execute on function public.create_course_quiz(text, text, timestamptz) to authenticated;
grant execute on function public.update_course_quiz(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.delete_course_quiz(uuid) to authenticated;
grant execute on function public.get_course_quiz_questions(uuid, int) to authenticated;
grant execute on function public.replace_course_quiz(uuid, jsonb) to authenticated;
grant execute on function public.course_quiz_has_attempts(uuid) to authenticated;
grant execute on function public.list_course_quizzes(uuid) to authenticated;
