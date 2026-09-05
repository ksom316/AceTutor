-- Corrective fix: grade_quiz() raised "column reference 'question_id' is
-- ambiguous" when submitting/grading an official module (or General Course)
-- quiz.
--
-- ROOT CAUSE
-- grade_quiz() is declared `returns table (question_id uuid, is_correct
-- boolean, correct_index int, explanation text)`. In PL/pgSQL, RETURNS TABLE
-- columns are implicitly declared as OUT-parameter variables in scope for
-- the ENTIRE function body — so a later bare (unqualified) column reference
-- inside an embedded SQL command that ALSO matches one of those names can be
-- ambiguous between "the OUT parameter" and "a table column," and Postgres
-- raises this error under the default `plpgsql.variable_conflict = error`.
--
-- The offending statement is the per-answer UPSERT inside the answer-grading
-- loop:
--     insert into public.attempt_answers (attempt_id, question_id, ...)
--     values (...)
--     on conflict (attempt_id, question_id)          -- <-- here
--     do update set ...
-- `ON CONFLICT (column_list)` cannot be table-alias-qualified (that is not
-- valid SQL — the arbiter column list always refers to the INSERT's own
-- target table), so `question_id` here has no way to be qualified as
-- `aa.question_id`, and collides with the function's own `question_id` OUT
-- parameter.
--
-- Confirms this is genuinely fixable without changing which row is matched:
-- `public.attempt_answers` already has a real unique constraint on exactly
-- these two columns (`attempt_answers_attempt_question_key`, see
-- bootstrap_new_project.sql / 20260914130000_quiz_recovery.sql), and this
-- codebase's OWN `save_quiz_answer()` RPC (defined in the same migration
-- file grade_quiz()'s prior definition came from) already safely upserts the
-- same table via `ON CONFLICT ON CONSTRAINT attempt_answers_attempt_question_key`
-- — a form that names the constraint instead of listing columns, sidestepping
-- the ambiguity entirely. grade_quiz() is the only place that used the
-- column-list form, and the only place with a colliding OUT parameter name.
--
-- FIX
-- Change `on conflict (attempt_id, question_id)` to
-- `on conflict on constraint attempt_answers_attempt_question_key` —
-- functionally identical (the constraint IS the unique index on exactly
-- those two columns), it just avoids the ambiguous column-list syntax.
--
-- Everything else in grade_quiz() — scoring, timeout handling, the
-- progress/lesson-completion side effect, the Phase A6
-- official_quiz_completed logging (module quizzes only, after successful
-- grading, server-derived score_percent, idempotent via
-- learning_interactions_official_outcome_uq, isolated in its own exception
-- block) — is byte-for-byte unchanged from the migration that introduced it
-- (20260905190000_learning_interactions.sql). No other unqualified/ambiguous
-- reference to question_id, is_correct, correct_index, or explanation exists
-- anywhere else in this function (every other use is already qualified,
-- e.g. `aa.question_id`, `q.correct_index`, or appears only in a RETURNS
-- TABLE-column-shaped SELECT list already qualified by alias).
--
-- Does not touch Mastery, module completion, General Course Quiz behavior,
-- or Quiz Me (which never calls grade_quiz() at all — practice quizzes are
-- graded entirely by the separate gradePracticeQuiz TypeScript server
-- function and never touch quiz_attempts/attempt_answers).
create or replace function public.grade_quiz(
  _attempt_id uuid, _answers jsonb, _timed_out boolean default false
)
returns table (question_id uuid, is_correct boolean, correct_index int, explanation text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_topic_id uuid;
  v_cq_id uuid;
  v_finished timestamptz;
  v_expires timestamptz;
  v_cq_deadline timestamptz;
  v_lesson_id uuid;
  v_course_id uuid;
  v_total int := 0;
  v_answered int := 0;
  v_score int := 0;
  rec record;
  v_sel int;
begin
  select user_id, topic_id, course_quiz_id, finished_at, expires_at
    into v_user, v_topic_id, v_cq_id, v_finished, v_expires
    from public.quiz_attempts where id = _attempt_id
    for update;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;

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
    select deadline into v_cq_deadline from public.course_quizzes where id = v_cq_id;
  else
    raise exception 'This quiz attempt is not linked to a quiz.';
  end if;

  for rec in
    select q.id, q.correct_index
    from public.questions q
    where q.id::text in (select jsonb_object_keys(_answers))
      and (
        (v_topic_id is not null and q.topic_id = v_topic_id)
        or (v_cq_id is not null and q.course_quiz_id = v_cq_id)
      )
  loop
    v_sel := (_answers ->> rec.id::text)::int;
    insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
    values (_attempt_id, rec.id, v_sel, v_sel = rec.correct_index)
    -- FIX: was `on conflict (attempt_id, question_id)` — ambiguous against
    -- this function's own `question_id` OUT parameter. Naming the
    -- constraint instead avoids the ambiguity; same unique index either way.
    on conflict on constraint attempt_answers_attempt_question_key
    do update set selected_index = excluded.selected_index,
                  is_correct     = excluded.is_correct;
  end loop;

  select count(*), count(*) filter (where aa.is_correct)
    into v_answered, v_score
    from public.attempt_answers aa
    where aa.attempt_id = _attempt_id;

  update public.quiz_attempts
    set score = v_score,
        total = v_total,
        answered_count = v_answered,
        finished_at = now(),
        timed_out = _timed_out
          or (v_expires is not null and now() >= v_expires)
          or (v_cq_deadline is not null and now() >= v_cq_deadline)
    where id = _attempt_id;

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

    -- Phase A6 official_quiz_completed logging — unchanged from
    -- 20260905190000_learning_interactions.sql. `quiz_attempt_id` and
    -- `event_type` are not among this function's OUT parameter names, so
    -- this ON CONFLICT target was never ambiguous.
    begin
      select course_id into v_course_id from public.topics where id = v_topic_id;
      insert into public.learning_interactions
        (user_id, course_id, topic_id, event_type, quiz_attempt_id, score_percent)
      values
        (v_user, v_course_id, v_topic_id, 'official_quiz_completed', _attempt_id,
         round((v_score::numeric / v_total) * 100)::int)
      on conflict (quiz_attempt_id) where event_type = 'official_quiz_completed'
      do nothing;
    exception when others then
      null; -- swallow: grading above must stand regardless of this outcome.
    end;
  end if;

  return query
    select aa.question_id, aa.is_correct, q.correct_index, q.explanation
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where aa.attempt_id = _attempt_id;
end;
$$;
