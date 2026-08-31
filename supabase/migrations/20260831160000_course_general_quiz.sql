-- Course-level "General Course Quiz".
--
-- A course-wide assessment that does NOT belong to any topic/module. It reuses
-- the existing questions / quiz_attempts / attempt_answers tables and grade_quiz
-- rather than parallel tables — only the "which quiz does this row belong to"
-- pointer differs.
--
-- Design (approved):
--   * new first-class entity   public.course_quizzes  (one per course)
--   * questions.topic_id       -> nullable
--   * questions.course_quiz_id -> new, nullable, FK course_quizzes
--   * CHECK num_nonnulls(topic_id, course_quiz_id) = 1   -- exactly one owner
--   * same two columns + CHECK on quiz_attempts
--
-- Backward compatibility: every existing questions / quiz_attempts row keeps
-- topic_id set and course_quiz_id NULL, so num_nonnulls(...) = 1 holds and the
-- CHECK constraints validate with no data migration. create_module_with_quiz,
-- replace_topic_quiz and get_quiz_questions are untouched. grade_quiz's module
-- branch is byte-for-byte the previous behaviour (including the first-lesson
-- progress write); the new general-quiz branch skips all lesson/module progress.

-- 1. Entity ----------------------------------------------------------------
create table if not exists public.course_quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null unique references public.courses(id) on delete cascade,
  title text not null default 'General Course Quiz',
  created_at timestamptz not null default now()
);
alter table public.course_quizzes enable row level security;

drop policy if exists "course_quizzes_public_read" on public.course_quizzes;
drop policy if exists "course_quizzes_lecturer_write" on public.course_quizzes;
create policy "course_quizzes_public_read" on public.course_quizzes
  for select to anon, authenticated using (true);
create policy "course_quizzes_lecturer_write" on public.course_quizzes
  for all to authenticated
  using (course_id = public.current_lecturer_course())
  with check (course_id = public.current_lecturer_course());

-- 2. questions: allow course-quiz ownership -------------------------------
alter table public.questions alter column topic_id drop not null;
alter table public.questions
  add column if not exists course_quiz_id uuid references public.course_quizzes(id) on delete cascade;
alter table public.questions drop constraint if exists questions_owner_ck;
alter table public.questions
  add constraint questions_owner_ck check (num_nonnulls(topic_id, course_quiz_id) = 1);
create index if not exists questions_course_quiz_id_idx on public.questions(course_quiz_id);

-- 3. quiz_attempts: allow course-quiz attempts --------------------------------
alter table public.quiz_attempts alter column topic_id drop not null;
alter table public.quiz_attempts
  add column if not exists course_quiz_id uuid references public.course_quizzes(id) on delete cascade;
alter table public.quiz_attempts drop constraint if exists quiz_attempts_owner_ck;
alter table public.quiz_attempts
  add constraint quiz_attempts_owner_ck check (num_nonnulls(topic_id, course_quiz_id) = 1);
create index if not exists quiz_attempts_course_quiz_id_idx
  on public.quiz_attempts(course_quiz_id, user_id);

-- 4. Lecturer write RLS: extend to course-quiz questions --------------------
--    (module clause is identical to the previous policy; attempt/answer
--     policies are auth.uid() = user_id and already cover general-quiz rows.)
drop policy if exists "questions_lecturer_write" on public.questions;
create policy "questions_lecturer_write" on public.questions
  for all to authenticated
  using (
    (topic_id in (
      select t.id from public.topics t where t.course_id = public.current_lecturer_course()
    ))
    or
    (course_quiz_id in (
      select cq.id from public.course_quizzes cq
      where cq.course_id = public.current_lecturer_course()
    ))
  )
  with check (
    (topic_id in (
      select t.id from public.topics t where t.course_id = public.current_lecturer_course()
    ))
    or
    (course_quiz_id in (
      select cq.id from public.course_quizzes cq
      where cq.course_id = public.current_lecturer_course()
    ))
  );

-- 5. RPCs -----------------------------------------------------------------

-- ensure_course_quiz(): returns the caller's course-quiz id, creating the row
-- on first use. Course is derived from current_lecturer_course() only.
create or replace function public.ensure_course_quiz()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_cq_id uuid;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can manage the general course quiz.';
  end if;
  select id into v_cq_id from public.course_quizzes where course_id = v_course;
  if v_cq_id is null then
    insert into public.course_quizzes (course_id) values (v_course) returning id into v_cq_id;
  end if;
  return v_cq_id;
end;
$$;

-- get_course_quiz_questions(): sanitized questions (no answer key) for a
-- course's general quiz, mirroring get_quiz_questions.
create or replace function public.get_course_quiz_questions(_course_id uuid, _limit int default 30)
returns table (id uuid, prompt text, choices jsonb, difficulty int)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.prompt, q.choices, q.difficulty
  from public.questions q
  join public.course_quizzes cq on cq.id = q.course_quiz_id
  where cq.course_id = _course_id
  order by random()
  limit greatest(coalesce(_limit, 30), 1);
$$;

-- replace_course_quiz(): atomic delete + insert of the caller's general quiz
-- questions, mirroring replace_topic_quiz. Also ensures the entity exists.
create or replace function public.replace_course_quiz(_questions jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_cq_id uuid;
  v_n int;
  v_i int := 0;
  q jsonb;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can edit the general course quiz.';
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

  select id into v_cq_id from public.course_quizzes where course_id = v_course;
  if v_cq_id is null then
    insert into public.course_quizzes (course_id) values (v_course) returning id into v_cq_id;
  end if;

  delete from public.questions where course_quiz_id = v_cq_id;

  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      v_cq_id,
      q->>'prompt',
      q->'choices',
      (q->>'correct_index')::int,
      nullif(q->>'explanation', ''),
      coalesce((q->>'difficulty')::int, 3),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  return v_cq_id;
end;
$$;

-- course_quiz_has_attempts(): whether any student has attempted the caller's
-- general quiz (for the delete/replace warning; quiz_attempts RLS otherwise
-- hides other users' rows from the lecturer).
create or replace function public.course_quiz_has_attempts()
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
    where cq.course_id = public.current_lecturer_course()
  );
$$;

-- 6. grade_quiz: add the general-quiz branch ----------------------------------
--    The module branch (v_topic_id is not null) is unchanged, INCLUDING the
--    first-lesson progress-completion write. The general-quiz branch grades the
--    same way but never touches lessons or progress.
create or replace function public.grade_quiz(_attempt_id uuid, _answers jsonb)
returns table (question_id uuid, is_correct boolean, correct_index int, explanation text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_topic_id uuid;
  v_cq_id uuid;
  v_lesson_id uuid;
  v_total int := 0;
  v_score int := 0;
  rec record;
  v_sel int;
begin
  select user_id, topic_id, course_quiz_id
    into v_user, v_topic_id, v_cq_id
    from public.quiz_attempts where id = _attempt_id;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;

  if v_topic_id is not null then
    if not exists (select 1 from public.questions where topic_id = v_topic_id) then
      raise exception 'This module does not have a quiz yet.';
    end if;
  elsif v_cq_id is not null then
    if not exists (select 1 from public.questions where course_quiz_id = v_cq_id) then
      raise exception 'This course does not have a general quiz yet.';
    end if;
  else
    raise exception 'This quiz attempt is not linked to a quiz.';
  end if;

  for rec in
    select q.id, q.correct_index, q.explanation
    from public.questions q
    where q.id::text in (select jsonb_object_keys(_answers))
  loop
    v_sel := (_answers ->> rec.id::text)::int;
    v_total := v_total + 1;
    if v_sel = rec.correct_index then
      v_score := v_score + 1;
      insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
      values (_attempt_id, rec.id, v_sel, true);
    else
      insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
      values (_attempt_id, rec.id, v_sel, false);
    end if;

    question_id := rec.id;
    is_correct := (v_sel = rec.correct_index);
    correct_index := rec.correct_index;
    explanation := rec.explanation;
    return next;
  end loop;

  update public.quiz_attempts
    set score = v_score, total = v_total, finished_at = now()
    where id = _attempt_id;

  -- Module quizzes still mark the module's first lesson complete.
  -- General course quizzes do NOT touch lesson / module progress.
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

revoke execute on function public.ensure_course_quiz() from public, anon;
revoke execute on function public.get_course_quiz_questions(uuid, int) from public, anon;
revoke execute on function public.replace_course_quiz(jsonb) from public, anon;
revoke execute on function public.course_quiz_has_attempts() from public, anon;
revoke execute on function public.grade_quiz(uuid, jsonb) from public, anon;
grant execute on function public.ensure_course_quiz() to authenticated;
grant execute on function public.get_course_quiz_questions(uuid, int) to authenticated;
grant execute on function public.replace_course_quiz(jsonb) to authenticated;
grant execute on function public.course_quiz_has_attempts() to authenticated;
grant execute on function public.grade_quiz(uuid, jsonb) to authenticated;
