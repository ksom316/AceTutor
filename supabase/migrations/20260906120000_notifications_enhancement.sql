-- Notification enhancement — student content notifications + lecturer course
-- activity notifications.
--
-- Reuses the existing public.notifications table (introduced in
-- 20260822120000_teacher_publishing_notifications.sql) and its RLS:
--   notifications_select_own  — SELECT where auth.uid() = user_id
--   notifications_update_own  — UPDATE where auth.uid() = user_id
--   (no INSERT policy — only SECURITY DEFINER code can create rows)
--
-- New rows are created ONLY by the AFTER-INSERT / AFTER-UPDATE triggers below,
-- which are SECURITY DEFINER and derive the course, the enrolled student list
-- and the target lecturer entirely from server-side data (the row being
-- written + enrollments + lecturer_slots). No course id, audience or recipient
-- is ever taken from a client request. A student therefore cannot create a
-- lecturer notification, and a lecturer cannot receive activity for a course
-- that is not the one bound to their claimed lecturer_slots row.
--
-- Idempotency: each trigger fires once per real row event, so one lecturer
-- action = one notification per recipient. The general-quiz trigger additionally
-- guards on an existing notification for the same quiz so re-saving a quiz's
-- questions (delete + re-insert) never re-notifies.
--
-- NOT changed: grading, quiz attempts, the quiz timer, performance RPCs, lecturer
-- course assignment, or any existing RLS policy. The legacy publish_teacher_note
-- / publish_teacher_quiz RPCs (unused by the current lecturer workspace) are left
-- exactly as-is.

-- 0. Base table --------------------------------------------------------------
-- public.notifications is normally created by
-- 20260822120000_teacher_publishing_notifications.sql. That migration is not
-- part of every deployed database (the hosted DB predates the migration folder
-- and was applied piecemeal), so the base table + RLS are recreated here
-- idempotently. `create table if not exists` is a no-op when the table already
-- exists, and on a full ordered replay 20260822120000 runs first and this
-- section becomes the no-op. This block deliberately does NOT touch app_role,
-- handle_new_user(), publish_teacher_note(), publish_teacher_quiz() or
-- grade_quiz() — those belong to their own (later) migrations. Nothing here
-- drops or recreates the table if it already exists.
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

-- Recreate the two original policies verbatim. drop-then-create keeps this
-- idempotent and changes nothing when they already exist (same pattern as
-- 20260831160000_course_general_quiz.sql).
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (auth.uid() = user_id);

-- 1. Extend the notifications table ------------------------------------------
alter table public.notifications
  add column if not exists audience text not null default 'student';
alter table public.notifications
  add column if not exists topic_id uuid references public.topics(id) on delete cascade;
alter table public.notifications
  add column if not exists quiz_id uuid references public.course_quizzes(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    -- legacy (publish_teacher_note / publish_teacher_quiz)
    'note', 'quiz',
    -- student: new lecturer content
    'material', 'module_quiz', 'general_quiz',
    -- lecturer: course activity
    'enrollment', 'quiz_completed', 'module_completed'
  ));

alter table public.notifications drop constraint if exists notifications_audience_check;
alter table public.notifications
  add constraint notifications_audience_check check (audience in ('student', 'lecturer'));

create index if not exists notifications_user_audience_idx
  on public.notifications (user_id, audience, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;
create index if not exists notifications_quiz_id_idx
  on public.notifications (quiz_id) where quiz_id is not null;

-- 2. Student: a new lesson / learning material -------------------------------
create or replace function public.notify_new_lesson()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_course_id uuid;
  v_course_title text;
  v_topic_title text;
begin
  select t.course_id, t.title, c.title
    into v_course_id, v_topic_title, v_course_title
  from public.topics t
  join public.courses c on c.id = t.course_id
  where t.id = new.topic_id;

  if v_course_id is null then
    return new;
  end if;

  insert into public.notifications (user_id, course_id, topic_id, audience, kind, title, message)
  select
    e.user_id,
    v_course_id,
    new.topic_id,
    'student',
    'material',
    'New learning material',
    'A new ' || new.modality::text || ' lesson "' || new.title || '" was added to '
      || v_topic_title || ' in ' || v_course_title || '.'
  from public.enrollments e
  where e.course_id = v_course_id
    and e.user_id is distinct from v_actor;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_lesson on public.lessons;
create trigger trg_notify_new_lesson
  after insert on public.lessons
  for each row execute function public.notify_new_lesson();

-- 3. Student: a new module (always ships with its module quiz) ----------------
create or replace function public.notify_new_module()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_course_title text;
begin
  select c.title into v_course_title from public.courses c where c.id = new.course_id;
  if v_course_title is null then
    return new;
  end if;

  insert into public.notifications (user_id, course_id, topic_id, audience, kind, title, message)
  select
    e.user_id,
    new.course_id,
    new.id,
    'student',
    'module_quiz',
    'New module quiz',
    'A new module "' || new.title || '" with a module quiz is now available in '
      || v_course_title || '.'
  from public.enrollments e
  where e.course_id = new.course_id
    and e.user_id is distinct from v_actor;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_module on public.topics;
create trigger trg_notify_new_module
  after insert on public.topics
  for each row execute function public.notify_new_module();

-- 4. Student: a general course quiz becomes answerable -----------------------
--    Fires on the first question inserted for a course_quizzes row. The guard
--    keeps it to exactly one notification per quiz even though replace_course_quiz
--    deletes and re-inserts every question on each save.
create or replace function public.notify_new_general_quiz()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_course_id uuid;
  v_course_title text;
  v_quiz_title text;
begin
  if exists (
    select 1 from public.notifications n
    where n.quiz_id = new.course_quiz_id and n.kind = 'general_quiz'
  ) then
    return new;
  end if;

  select cq.course_id, cq.title, c.title
    into v_course_id, v_quiz_title, v_course_title
  from public.course_quizzes cq
  join public.courses c on c.id = cq.course_id
  where cq.id = new.course_quiz_id;

  if v_course_id is null then
    return new;
  end if;

  insert into public.notifications (user_id, course_id, quiz_id, audience, kind, title, message)
  select
    e.user_id,
    v_course_id,
    new.course_quiz_id,
    'student',
    'general_quiz',
    'New course quiz',
    'A new general course quiz "' || v_quiz_title || '" is now available for '
      || v_course_title || '.'
  from public.enrollments e
  where e.course_id = v_course_id
    and e.user_id is distinct from v_actor;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_general_quiz on public.questions;
create trigger trg_notify_new_general_quiz
  after insert on public.questions
  for each row
  when (new.course_quiz_id is not null)
  execute function public.notify_new_general_quiz();

-- 5. Lecturer: a new student enrolls in their assigned course ----------------
create or replace function public.notify_new_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lecturer uuid;
  v_course_title text;
  v_student text;
begin
  select claimed_by into v_lecturer
  from public.lecturer_slots
  where course_id = new.course_id;

  if v_lecturer is null or v_lecturer = new.user_id then
    return new;
  end if;

  select c.title into v_course_title from public.courses c where c.id = new.course_id;
  select coalesce(nullif(btrim(full_name), ''), 'A student')
    into v_student from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, course_id, audience, kind, title, message)
  values (
    v_lecturer,
    new.course_id,
    'lecturer',
    'enrollment',
    'New student enrollment',
    coalesce(v_student, 'A student') || ' enrolled in ' || coalesce(v_course_title, 'your course') || '.'
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_new_enrollment on public.enrollments;
create trigger trg_notify_new_enrollment
  after insert on public.enrollments
  for each row execute function public.notify_new_enrollment();

-- 6. Lecturer: a student finishes a quiz (or completes a module) -------------
--    Fires only on the transition finished_at NULL -> NOT NULL, so a second
--    grade_quiz call (timeout finalisation, idempotent re-grade) never
--    re-notifies. A module quiz's FIRST finished attempt is reported as a
--    module completion (mirrors grade_quiz marking the module's first lesson
--    complete); later attempts are reported as quiz completions.
create or replace function public.notify_quiz_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_course_title text;
  v_quiz_label text;
  v_lecturer uuid;
  v_student text;
  v_is_module boolean;
  v_first_completion boolean := false;
  v_score_txt text;
begin
  if old.finished_at is not null or new.finished_at is null then
    return new;
  end if;

  if new.topic_id is not null then
    v_is_module := true;
    select t.course_id, c.title, t.title
      into v_course_id, v_course_title, v_quiz_label
    from public.topics t
    join public.courses c on c.id = t.course_id
    where t.id = new.topic_id;
  elsif new.course_quiz_id is not null then
    v_is_module := false;
    select cq.course_id, c.title, cq.title
      into v_course_id, v_course_title, v_quiz_label
    from public.course_quizzes cq
    join public.courses c on c.id = cq.course_id
    where cq.id = new.course_quiz_id;
  else
    return new;
  end if;

  if v_course_id is null then
    return new;
  end if;

  select claimed_by into v_lecturer
  from public.lecturer_slots
  where course_id = v_course_id;

  if v_lecturer is null or v_lecturer = new.user_id then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'A student')
    into v_student from public.profiles where id = new.user_id;

  v_score_txt := coalesce(new.score, 0)::text || '/' || coalesce(new.total, 0)::text;

  if v_is_module then
    select count(*) = 1 into v_first_completion
    from public.quiz_attempts a
    where a.user_id = new.user_id
      and a.topic_id = new.topic_id
      and a.finished_at is not null;
  end if;

  if v_is_module and v_first_completion then
    insert into public.notifications (user_id, course_id, topic_id, audience, kind, title, message)
    values (
      v_lecturer, v_course_id, new.topic_id, 'lecturer', 'module_completed',
      'Student completed a module',
      coalesce(v_student, 'A student') || ' completed the module "' || coalesce(v_quiz_label, 'a module')
        || '" (' || v_score_txt || ').'
    );
  elsif v_is_module then
    insert into public.notifications (user_id, course_id, topic_id, audience, kind, title, message)
    values (
      v_lecturer, v_course_id, new.topic_id, 'lecturer', 'quiz_completed',
      'Student completed a quiz',
      coalesce(v_student, 'A student') || ' completed the "' || coalesce(v_quiz_label, 'module')
        || '" module quiz (' || v_score_txt || ').'
    );
  else
    insert into public.notifications (user_id, course_id, quiz_id, audience, kind, title, message)
    values (
      v_lecturer, v_course_id, new.course_quiz_id, 'lecturer', 'quiz_completed',
      'Student completed a quiz',
      coalesce(v_student, 'A student') || ' completed the general course quiz "'
        || coalesce(v_quiz_label, 'a quiz') || '" (' || v_score_txt || ').'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_quiz_completed on public.quiz_attempts;
create trigger trg_notify_quiz_completed
  after update on public.quiz_attempts
  for each row execute function public.notify_quiz_completed();

-- 7. Lock down the trigger functions ----------------------------------------
revoke execute on function public.notify_new_lesson() from public, anon, authenticated;
revoke execute on function public.notify_new_module() from public, anon, authenticated;
revoke execute on function public.notify_new_general_quiz() from public, anon, authenticated;
revoke execute on function public.notify_new_enrollment() from public, anon, authenticated;
revoke execute on function public.notify_quiz_completed() from public, anon, authenticated;
