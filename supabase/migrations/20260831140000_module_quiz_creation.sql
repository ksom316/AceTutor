-- Phase 8 enhancement — mandatory quiz at module creation + atomic quiz replace.
--
-- No schema changes. Two SECURITY DEFINER helper functions so that:
--   * a module + its first quiz are written in ONE transaction (a module can
--     never land in the DB without a quiz), and
--   * "replace existing quiz" is one transaction (never a half-replaced quiz).
--
-- Both derive the lecturer's course from current_lecturer_course() (resolved
-- from auth.uid()); a client-supplied course id is never trusted. Existing
-- quizzes / questions / attempts are untouched by this migration.

-- create_module_with_quiz(title, summary, questions[])
--   Used by the lecturer Materials "Create Module" flow. `questions` is a JSON
--   array of { prompt, choices[], correct_index, explanation?, difficulty? }.
create or replace function public.create_module_with_quiz(
  _title text,
  _summary text,
  _questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_topic_id uuid;
  v_slug text;
  v_order int;
  v_n int;
  v_i int := 0;
  q jsonb;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can create a module.';
  end if;
  if coalesce(trim(_title), '') = '' then
    raise exception 'A module title is required.';
  end if;
  if char_length(trim(_title)) > 200 then
    raise exception 'The module title is too long.';
  end if;
  if _questions is null or jsonb_typeof(_questions) <> 'array' then
    raise exception 'A quiz is required before this module can be created.';
  end if;
  v_n := jsonb_array_length(_questions);
  if v_n < 1 then
    raise exception 'A quiz with at least one question is required before this module can be created.';
  end if;
  if v_n > 50 then
    raise exception 'A quiz can have at most 50 questions.';
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(trim(_title)), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    v_slug := 'module';
  end if;
  if exists (select 1 from public.topics where course_id = v_course and slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);
  end if;

  v_order := coalesce((select max(order_index) + 1 from public.topics where course_id = v_course), 0);

  insert into public.topics (course_id, slug, title, summary, order_index)
  values (
    v_course,
    v_slug,
    trim(_title),
    nullif(trim(coalesce(_summary, '')), ''),
    v_order
  )
  returning id into v_topic_id;

  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (topic_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      v_topic_id,
      q->>'prompt',
      q->'choices',
      (q->>'correct_index')::int,
      nullif(q->>'explanation', ''),
      coalesce((q->>'difficulty')::int, 3),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  return v_topic_id;
end;
$$;

-- replace_topic_quiz(topic_id, questions[])
--   Backs the "Replace existing quiz" action in the quiz builder. Deleting the
--   current questions cascades to attempt_answers (existing FK) — the UI warns
--   about this and requires explicit confirmation. quiz_attempts rows and their
--   frozen score/total are NOT touched.
create or replace function public.replace_topic_quiz(
  _topic_id uuid,
  _questions jsonb
)
returns void
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
    raise exception 'Only a lecturer can edit this quiz.';
  end if;
  if not exists (
    select 1 from public.topics where id = _topic_id and course_id = v_course
  ) then
    raise exception 'You can only edit quizzes for modules in your assigned course.';
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

  delete from public.questions where topic_id = _topic_id;

  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (topic_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      _topic_id,
      q->>'prompt',
      q->'choices',
      (q->>'correct_index')::int,
      nullif(q->>'explanation', ''),
      coalesce((q->>'difficulty')::int, 3),
      v_i
    );
    v_i := v_i + 1;
  end loop;
end;
$$;

revoke execute on function public.create_module_with_quiz(text, text, jsonb) from public, anon;
revoke execute on function public.replace_topic_quiz(uuid, jsonb) from public, anon;
grant execute on function public.create_module_with_quiz(text, text, jsonb) to authenticated;
grant execute on function public.replace_topic_quiz(uuid, jsonb) to authenticated;
