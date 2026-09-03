alter type public.app_role add value if not exists 'teacher';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  kind text not null check (kind in ('note', 'quiz')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select to authenticated using (auth.uid() = user_id);
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  new_role public.app_role;
begin
  new_role := case
    when new.raw_user_meta_data->>'account_type' = 'teacher' then 'teacher'::public.app_role
    else 'student'::public.app_role
  end;
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  insert into public.user_roles (user_id, role) values (new.id, new_role);
  return new;
end;
$$;

create or replace function public.publish_teacher_note(
  _course_id uuid,
  _topic_title text,
  _lesson_title text,
  _body_md text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_topic_id uuid;
  v_lesson_id uuid;
  v_teacher_name text;
  v_course_title text;
begin
  if not public.has_role(auth.uid(), 'teacher'::public.app_role) then
    raise exception 'Only teachers can publish materials';
  end if;

  select title into v_course_title from public.courses where id = _course_id;
  if v_course_title is null then raise exception 'Course not found'; end if;

  select id into v_topic_id from public.topics
    where course_id = _course_id and lower(title) = lower(trim(_topic_title)) limit 1;
  if v_topic_id is null then
    insert into public.topics (course_id, slug, title, order_index)
    values (
      _course_id,
      trim(both '-' from regexp_replace(lower(trim(_topic_title)), '[^a-z0-9]+', '-', 'g')),
      trim(_topic_title),
      coalesce((select max(order_index) + 1 from public.topics where course_id = _course_id), 0)
    ) returning id into v_topic_id;
  end if;

  insert into public.lessons (topic_id, modality, title, body_md, order_index)
  values (
    v_topic_id, 'text', trim(_lesson_title), coalesce(_body_md, ''),
    coalesce((select max(order_index) + 1 from public.lessons where topic_id = v_topic_id), 0)
  ) returning id into v_lesson_id;

  select coalesce(nullif(trim(full_name), ''), 'Your teacher') into v_teacher_name
    from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, course_id, kind, title, message)
    select e.user_id, _course_id, 'note', 'New course note',
      v_teacher_name || ' posted "' || trim(_lesson_title) || '" in ' || v_course_title || '.'
    from public.enrollments e where e.course_id = _course_id and e.user_id <> auth.uid();
  return v_lesson_id;
end;
$$;

create or replace function public.publish_teacher_quiz(
  _course_id uuid,
  _topic_title text,
  _quiz_title text,
  _questions jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_topic_id uuid;
  v_quiz_id uuid := gen_random_uuid();
  v_teacher_name text;
  v_course_title text;
  q jsonb;
begin
  if not public.has_role(auth.uid(), 'teacher'::public.app_role) then
    raise exception 'Only teachers can publish materials';
  end if;
  if jsonb_typeof(_questions) <> 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'At least one quiz question is required';
  end if;
  select title into v_course_title from public.courses where id = _course_id;
  if v_course_title is null then raise exception 'Course not found'; end if;

  select id into v_topic_id from public.topics
    where course_id = _course_id and lower(title) = lower(trim(_topic_title)) limit 1;
  if v_topic_id is null then
    insert into public.topics (course_id, slug, title, order_index)
    values (
      _course_id,
      trim(both '-' from regexp_replace(lower(trim(_topic_title)), '[^a-z0-9]+', '-', 'g')),
      trim(_topic_title),
      coalesce((select max(order_index) + 1 from public.topics where course_id = _course_id), 0)
    ) returning id into v_topic_id;
  end if;

  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions (topic_id, prompt, choices, correct_index, explanation, difficulty)
    values (
      v_topic_id, q->>'prompt', q->'choices', (q->>'correct_index')::int,
      nullif(q->>'explanation', ''), coalesce((q->>'difficulty')::int, 2)
    );
  end loop;

  select coalesce(nullif(trim(full_name), ''), 'Your teacher') into v_teacher_name
    from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, course_id, kind, title, message)
    select e.user_id, _course_id, 'quiz', 'New quiz available',
      v_teacher_name || ' posted "' || trim(_quiz_title) || '" in ' || v_course_title || '.'
    from public.enrollments e where e.course_id = _course_id and e.user_id <> auth.uid();
  return v_quiz_id;
end;
$$;

revoke execute on function public.publish_teacher_note(uuid, text, text, text) from public, anon;
revoke execute on function public.publish_teacher_quiz(uuid, text, text, jsonb) from public, anon;
grant execute on function public.publish_teacher_note(uuid, text, text, text) to authenticated;
grant execute on function public.publish_teacher_quiz(uuid, text, text, jsonb) to authenticated;

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