-- Phase 8 — Lecturer quiz management.
--
-- The `questions` table already carries everything a quiz needs (prompt,
-- choices jsonb, correct_index, explanation, difficulty) and Phase 1 already
-- gave lecturers scoped write access via `questions_lecturer_write`
-- (topic -> course = current_lecturer_course()). Students already read
-- questions through "Authenticated can read questions" + get_quiz_questions().
--
-- Only two changes are needed:

-- 1. Question ordering. The lecturer quiz builder lets the lecturer reorder
--    questions; `topics` and `lessons` already use `order_index` for this, so
--    `questions` gets the same column. Existing rows default to 0. The student
--    quiz runner pulls questions through get_quiz_questions(), which orders by
--    random() — that is unchanged, so student quizzes are unaffected.
alter table public.questions add column if not exists order_index int not null default 0;

-- 2. "A module requires a quiz before it can be completed."
--    Module completion is derived from a *finished* quiz_attempts row
--    (finished_at set by grade_quiz). grade_quiz previously graded and finished
--    an attempt even for a topic with zero questions, which let a student
--    "complete" a module that has no quiz. grade_quiz now refuses when the
--    topic has no questions — the attempt never gets finished_at, so the
--    module cannot be completed until the lecturer publishes a quiz. Behaviour
--    for topics that DO have questions is unchanged (including the existing
--    first-lesson progress-completion write).
create or replace function public.grade_quiz(_attempt_id uuid, _answers jsonb)
returns table (question_id uuid, is_correct boolean, correct_index int, explanation text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_topic_id uuid;
  v_lesson_id uuid;
  v_total int := 0;
  v_score int := 0;
  rec record;
  v_sel int;
begin
  select user_id, topic_id into v_user, v_topic_id
    from public.quiz_attempts where id = _attempt_id;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from public.questions where topic_id = v_topic_id) then
    raise exception 'This module does not have a quiz yet.';
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

  select id into v_lesson_id from public.lessons
    where topic_id = v_topic_id order by order_index, id limit 1;
  if v_lesson_id is not null then
    insert into public.progress (user_id, lesson_id, watched_seconds, completed_at, updated_at)
    values (v_user, v_lesson_id, 0, now(), now())
    on conflict (user_id, lesson_id) do update
      set completed_at = coalesce(public.progress.completed_at, excluded.completed_at),
          updated_at = now();
  end if;
end;
$$;

revoke execute on function public.grade_quiz(uuid, jsonb) from public, anon;
grant execute on function public.grade_quiz(uuid, jsonb) to authenticated;
