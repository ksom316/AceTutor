-- Lecturer module creation now requires BOTH at least one lesson/course content
-- AND at least one quiz question. `create_module_with_quiz` is the single
-- server-side creation boundary for the lecturer "Create module" flow, so the
-- rule is enforced here even if the client UI is bypassed.
--
-- The 3-arg signature (_title, _summary, _questions) is replaced by a 4-arg one
-- that also takes _lessons. Lecturer authorization (current_lecturer_course())
-- and the atomic single-transaction behaviour are unchanged. Existing modules,
-- lessons, questions and attempts are untouched. replace_topic_quiz and every
-- other function are unaffected.

drop function if exists public.create_module_with_quiz(text, text, jsonb);

create or replace function public.create_module_with_quiz(
  _title text,
  _summary text,
  _lessons jsonb,
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
  v_i int := 0;
  l jsonb;
  q jsonb;
  v_modality text;
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

  if _lessons is null or jsonb_typeof(_lessons) <> 'array'
     or jsonb_array_length(_lessons) < 1 then
    raise exception 'A module needs at least one course content before it can be created.';
  end if;
  if _questions is null or jsonb_typeof(_questions) <> 'array'
     or jsonb_array_length(_questions) < 1 then
    raise exception 'A quiz with at least one question is required before this module can be created.';
  end if;
  if jsonb_array_length(_questions) > 50 then
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

  -- Lessons
  v_i := 0;
  for l in select value from jsonb_array_elements(_lessons)
  loop
    v_modality := coalesce(nullif(l->>'modality', ''), 'text');
    if coalesce(trim(l->>'title'), '') = '' then
      raise exception 'Each course content needs a title.';
    end if;
    if v_modality = 'text' then
      if coalesce(trim(l->>'body_md'), '') = '' then
        raise exception 'A text lesson needs content.';
      end if;
    else
      if coalesce(trim(l->>'media_url'), '') = '' then
        raise exception 'A % lesson needs a file or link.', v_modality;
      end if;
    end if;

    insert into public.lessons (topic_id, modality, title, body_md, media_url, order_index)
    values (
      v_topic_id,
      v_modality::public.modality,
      trim(l->>'title'),
      nullif(trim(coalesce(l->>'body_md', '')), ''),
      nullif(trim(coalesce(l->>'media_url', '')), ''),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  -- Questions
  v_i := 0;
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

revoke execute on function public.create_module_with_quiz(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_module_with_quiz(text, text, jsonb, jsonb) to authenticated;
