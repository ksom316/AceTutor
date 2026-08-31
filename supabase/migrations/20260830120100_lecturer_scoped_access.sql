-- Lecturer-scoped write access + reporting. Every authorization check derives
-- the lecturer's course from public.current_lecturer_course() (resolved
-- server-side from auth.uid()). A client-supplied course id is never trusted as
-- proof of ownership.

-- 1. Lecturers may create / update / delete topics, lessons and questions that
--    belong to THEIR assigned course only. These policies are permissive and
--    OR-combined with the existing public read policies, so anonymous and
--    student reads are unchanged. For INSERT/UPDATE/DELETE the only applicable
--    policy is this one, and its predicate is NULL (=> denied) for non-lecturers.

create policy "topics_lecturer_write" on public.topics
  for all to authenticated
  using (course_id = public.current_lecturer_course())
  with check (course_id = public.current_lecturer_course());

create policy "lessons_lecturer_write" on public.lessons
  for all to authenticated
  using (
    topic_id in (
      select t.id from public.topics t
      where t.course_id = public.current_lecturer_course()
    )
  )
  with check (
    topic_id in (
      select t.id from public.topics t
      where t.course_id = public.current_lecturer_course()
    )
  );

create policy "questions_lecturer_write" on public.questions
  for all to authenticated
  using (
    topic_id in (
      select t.id from public.topics t
      where t.course_id = public.current_lecturer_course()
    )
  )
  with check (
    topic_id in (
      select t.id from public.topics t
      where t.course_id = public.current_lecturer_course()
    )
  );

-- 2. Course-ownership guard on the existing teacher publishing RPCs. Bodies are
--    otherwise identical to 20260822120000_teacher_publishing_notifications.sql;
--    the only change is the "assigned course" check after the role check.

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

  if _course_id is distinct from public.current_lecturer_course() then
    raise exception 'You can only publish content to your assigned course.';
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

  if _course_id is distinct from public.current_lecturer_course() then
    raise exception 'You can only publish content to your assigned course.';
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

-- 3. Lecturer reporting. SECURITY DEFINER; the course is derived from
--    current_lecturer_course() and never accepted as an argument. Returns
--    nothing for non-lecturers (the join key is NULL). Student email addresses
--    and VARK data are never selected.

create or replace function public.get_course_students()
returns table (
  user_id uuid,
  full_name text,
  avatar_url text,
  enrolled_at timestamptz,
  attempts integer,
  avg_pct integer,
  last_active timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with lc as (select public.current_lecturer_course() as course_id)
  select
    p.id,
    p.full_name,
    p.avatar_url,
    e.created_at,
    count(a.id) filter (where a.finished_at is not null)::integer,
    coalesce(
      round(
        avg((a.score::numeric / nullif(a.total, 0)) * 100)
          filter (where a.finished_at is not null)
      ),
      0
    )::integer,
    max(a.started_at)
  from lc
  join public.enrollments e on e.course_id = lc.course_id
  join public.profiles p on p.id = e.user_id
  left join public.quiz_attempts a
    on a.user_id = e.user_id
   and a.topic_id in (select t.id from public.topics t where t.course_id = lc.course_id)
  group by p.id, p.full_name, p.avatar_url, e.created_at;
$$;

create or replace function public.get_course_quiz_performance()
returns table (
  attempt_id uuid,
  student text,
  topic text,
  topic_id uuid,
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
  select
    a.id,
    p.full_name,
    t.title,
    t.id,
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
  order by a.started_at desc;
$$;

revoke execute on function public.get_course_students() from public, anon;
revoke execute on function public.get_course_quiz_performance() from public, anon;
grant execute on function public.get_course_students() to authenticated;
grant execute on function public.get_course_quiz_performance() to authenticated;
