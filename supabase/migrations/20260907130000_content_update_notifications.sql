-- Notify enrolled students when a lecturer makes a MEANINGFUL change to existing
-- course content — a lesson, a module/topic, or a quiz.
--
-- Complements 20260906120000_notifications_enhancement.sql, which notifies on
-- NEW content. Same design: SECURITY DEFINER AFTER triggers, course + recipients
-- derived entirely server-side (the changed row + enrollments), no client input,
-- RLS unchanged (notifications_select_own / _update_own, no INSERT policy).
--
-- APPLY ORDER: after 20260906120000 (adds notifications.topic_id / quiz_id /
-- audience and the notifications_kind_check this widens). Filename order already
-- guarantees this.
--
-- What is deliberately NOT notified:
--   * order_index-only changes (reordering lessons / modules / questions)
--   * no-op saves (a save that re-writes identical values) — the trigger WHEN
--     clauses / body checks use IS DISTINCT FROM
--   * a topic's quiz_duration_minutes edit on its own (the module time limit)
--   * the initial publish of a module / general quiz — the questions written by
--     create_module_with_quiz / create_course_quiz_with_questions are covered by
--     the existing module_quiz / general_quiz notification; the quiz_updated
--     trigger's recency guard skips them
--   * a burst from ONE lecturer action: replace_topic_quiz / replace_course_quiz
--     (delete-all + re-insert) and bulk question inserts coalesce into a single
--     quiz_updated notification via the same recency guard
--
-- Additive / non-destructive: only notifications_kind_check is widened
-- (drop-if-exists + re-add superset). No existing function / trigger / policy is
-- altered. Grading, the quiz timer, lecturer authorization and lecturer
-- assignment are untouched.

-- 1. Widen the kind CHECK --------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'note', 'quiz',
    'material', 'module_quiz', 'general_quiz',
    'material_updated', 'module_updated', 'quiz_updated',
    'enrollment', 'quiz_completed', 'module_completed'
  ));

-- 2. Lesson updated -------------------------------------------------------
create or replace function public.notify_lesson_updated()
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
  v_what text;
begin
  select t.course_id, t.title, c.title
    into v_course_id, v_topic_title, v_course_title
  from public.topics t
  join public.courses c on c.id = t.course_id
  where t.id = new.topic_id;

  if v_course_id is null then
    return new;
  end if;

  if new.title is distinct from old.title then
    v_what := 'renamed to "' || new.title || '"';
  elsif new.modality is distinct from old.modality then
    v_what := 'changed to a ' || new.modality::text || ' lesson';
  elsif new.media_url is distinct from old.media_url then
    v_what := 'has a new resource';
  else
    v_what := 'was updated';
  end if;

  insert into public.notifications (user_id, course_id, topic_id, audience, kind, title, message)
  select
    e.user_id,
    v_course_id,
    new.topic_id,
    'student',
    'material_updated',
    'Learning material updated',
    'The lesson "' || old.title || '" in ' || v_topic_title || ' ' || v_what
      || ' — open ' || v_topic_title || ' in ' || v_course_title || ' to view it.'
  from public.enrollments e
  where e.course_id = v_course_id
    and e.user_id is distinct from v_actor;

  return new;
end;
$$;

drop trigger if exists trg_notify_lesson_updated on public.lessons;
create trigger trg_notify_lesson_updated
  after update on public.lessons
  for each row
  when (
    new.title is distinct from old.title
    or new.body_md is distinct from old.body_md
    or new.modality is distinct from old.modality
    or new.media_url is distinct from old.media_url
  )
  execute function public.notify_lesson_updated();

-- 3. Module / topic updated --------------------------------------------------
create or replace function public.notify_module_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_course_title text;
  v_what text;
begin
  select c.title into v_course_title from public.courses c where c.id = new.course_id;
  if v_course_title is null then
    return new;
  end if;

  if new.title is distinct from old.title then
    v_what := 'was renamed to "' || new.title || '"';
  else
    v_what := 'details were updated';
  end if;

  insert into public.notifications (user_id, course_id, topic_id, audience, kind, title, message)
  select
    e.user_id,
    new.course_id,
    new.id,
    'student',
    'module_updated',
    'Module updated',
    'The module "' || old.title || '" ' || v_what || ' in ' || v_course_title || '.'
  from public.enrollments e
  where e.course_id = new.course_id
    and e.user_id is distinct from v_actor;

  return new;
end;
$$;

drop trigger if exists trg_notify_module_updated on public.topics;
create trigger trg_notify_module_updated
  after update on public.topics
  for each row
  when (
    new.title is distinct from old.title
    or new.summary is distinct from old.summary
  )
  execute function public.notify_module_updated();

-- 4. Quiz updated (module quiz or general course quiz) ---------------------
--    One AFTER INSERT/UPDATE/DELETE trigger. TG_OP + column checks in the body
--    drop pure reorder / no-op updates; the recency guard collapses a burst and
--    skips the initial publish.
create or replace function public.notify_quiz_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_topic uuid;
  v_cq uuid;
  v_course_id uuid;
  v_course_title text;
  v_label text;
  v_message text;
begin
  if tg_op = 'DELETE' then
    v_topic := old.topic_id;
    v_cq := old.course_quiz_id;
  else
    v_topic := new.topic_id;
    v_cq := new.course_quiz_id;
  end if;

  -- Ignore reorder-only / no-op question updates.
  if tg_op = 'UPDATE'
     and new.prompt is not distinct from old.prompt
     and new.choices is not distinct from old.choices
     and new.correct_index is not distinct from old.correct_index
     and new.explanation is not distinct from old.explanation
     and new.difficulty is not distinct from old.difficulty then
    return null;
  end if;

  if v_topic is not null then
    select t.course_id, c.title, t.title
      into v_course_id, v_course_title, v_label
    from public.topics t
    join public.courses c on c.id = t.course_id
    where t.id = v_topic;
    v_message := 'The quiz for the module "' || coalesce(v_label, 'a module')
      || '" was updated in ' || coalesce(v_course_title, 'your course') || '.';
  elsif v_cq is not null then
    select cq.course_id, c.title, cq.title
      into v_course_id, v_course_title, v_label
    from public.course_quizzes cq
    join public.courses c on c.id = cq.course_id
    where cq.id = v_cq;
    v_message := 'The general course quiz "' || coalesce(v_label, 'a quiz')
      || '" was updated in ' || coalesce(v_course_title, 'your course') || '.';
  else
    return null;
  end if;

  if v_course_id is null then
    return null;
  end if;

  -- Recency guard: one notification per quiz per edit burst, and none for the
  -- questions written at initial publish (module_quiz / general_quiz was just
  -- created in this same transaction).
  if exists (
    select 1 from public.notifications n
    where n.kind in ('module_quiz', 'general_quiz', 'quiz_updated')
      and (
        (v_topic is not null and n.topic_id = v_topic)
        or (v_cq is not null and n.quiz_id = v_cq)
      )
      and n.created_at > now() - interval '45 seconds'
  ) then
    return null;
  end if;

  insert into public.notifications (user_id, course_id, topic_id, quiz_id, audience, kind, title, message)
  select
    e.user_id,
    v_course_id,
    v_topic,
    v_cq,
    'student',
    'quiz_updated',
    'Quiz updated',
    v_message
  from public.enrollments e
  where e.course_id = v_course_id
    and e.user_id is distinct from v_actor;

  return null;
end;
$$;

drop trigger if exists trg_notify_quiz_updated on public.questions;
create trigger trg_notify_quiz_updated
  after insert or update or delete on public.questions
  for each row execute function public.notify_quiz_updated();

-- 5. Lock down --------------------------------------------------------------
revoke execute on function public.notify_lesson_updated() from public, anon, authenticated;
revoke execute on function public.notify_module_updated() from public, anon, authenticated;
revoke execute on function public.notify_quiz_updated() from public, anon, authenticated;
