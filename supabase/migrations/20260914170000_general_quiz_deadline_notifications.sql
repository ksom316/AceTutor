-- General Course Quiz schedule notifications — "available", "due soon" and
-- "closed" alerts for students and the lecturer, delivered through the EXISTING
-- public.notifications table and the existing student / lecturer Notifications
-- pages. No second notification system, no new table.
--
-- Time-based events cannot come from a DML trigger, and the project has no
-- scheduler, so this adds the smallest reliable Supabase-side one: a SECURITY
-- DEFINER sweep function run by pg_cron every 15 minutes. The sweep is fully
-- idempotent — every row it writes carries a deterministic event_key and a new
-- unique index (user_id, event_key) makes a repeat run a no-op via ON CONFLICT.
--
-- Rescheduling: the event_key embeds the available_from / deadline epoch, so if
-- a lecturer moves a date the sweep re-arms "due soon" / "closed" for the new
-- instant while the historical rows for the old instant stay untouched.
--
-- APPLY ORDER: after 20260914160000_general_quiz_schedule.sql (course_quizzes
-- .available_from). Filename order guarantees this.
--
-- NOT changed: existing notifications, their RLS (notifications_select_own /
-- _update_own, no INSERT policy), grading, quiz timing, Mastery, RLS elsewhere.

-- 1. Idempotency ledger on the existing table -------------------------------
alter table public.notifications
  add column if not exists event_key text;

-- (user_id, event_key). event_key is NULL for every existing / non-schedule
-- notification and NULLS are DISTINCT by default, so those rows are unaffected;
-- the schedule rows share one event_key string across all recipients, deduped
-- per user.
create unique index if not exists notifications_event_key_uq
  on public.notifications (user_id, event_key);

-- 2. Widen the kind CHECK (drop + re-add superset) --------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'note', 'quiz',
    'material', 'module_quiz', 'general_quiz',
    'material_updated', 'module_updated', 'quiz_updated',
    'enrollment', 'quiz_completed', 'module_completed',
    -- General Course Quiz schedule (this migration)
    'general_quiz_available', 'general_quiz_due_soon', 'general_quiz_closed', -- student
    'general_quiz_active', 'general_quiz_deadline'                            -- lecturer
  ));

-- 3. The sweep -------------------------------------------------------------------
-- Set-based: one INSERT per (event, audience). Every INSERT is guarded by
-- ON CONFLICT (user_id, event_key) DO NOTHING, so repeated runs never duplicate
-- and a student who enrols mid-window still gets the alert on the next run.
-- Recipients come only from enrollments + lecturer_slots — never client input.
create or replace function public.sweep_general_quiz_schedule()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_n int;
begin
  ----------------------------------------------------------------------------
  -- STUDENT: quiz is now available.
  -- Only for a quiz whose available_from was in the FUTURE and has now arrived
  -- (a quiz with no available_from is announced by notify_new_general_quiz on
  -- publish, so this would double up). Published = has >= 1 question.
  ----------------------------------------------------------------------------
  insert into public.notifications
    (user_id, course_id, quiz_id, audience, kind, title, message, event_key)
  select
    e.user_id, cq.course_id, cq.id, 'student', 'general_quiz_available',
    'General Course Quiz available',
    'The General Course Quiz "' || cq.title || '" for ' || c.title
      || ' is now available'
      || case when cq.deadline is null then '.'
              else '. It is due '
                   || to_char(cq.deadline at time zone 'UTC',
                              'FMMon FMDD, YYYY "at" HH12:MI AM') || ' UTC.' end,
    'gcq_avail:' || cq.id::text || ':'
      || extract(epoch from cq.available_from)::bigint::text
  from public.course_quizzes cq
  join public.courses c on c.id = cq.course_id
  join public.enrollments e on e.course_id = cq.course_id
  where cq.available_from is not null
    and now() >= cq.available_from
    and exists (select 1 from public.questions q where q.course_quiz_id = cq.id)
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  ----------------------------------------------------------------------------
  -- LECTURER: quiz is now active (same trigger condition).
  ----------------------------------------------------------------------------
  insert into public.notifications
    (user_id, course_id, quiz_id, audience, kind, title, message, event_key)
  select
    ls.claimed_by, cq.course_id, cq.id, 'lecturer', 'general_quiz_active',
    'General Course Quiz is now active',
    'The General Course Quiz "' || cq.title || '" for ' || c.title
      || ' is now available to students.',
    'gcq_active:' || cq.id::text || ':'
      || extract(epoch from cq.available_from)::bigint::text
  from public.course_quizzes cq
  join public.courses c on c.id = cq.course_id
  join public.lecturer_slots ls on ls.course_id = cq.course_id and ls.claimed_by is not null
  where cq.available_from is not null
    and now() >= cq.available_from
    and exists (select 1 from public.questions q where q.course_quiz_id = cq.id)
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  ----------------------------------------------------------------------------
  -- STUDENT: deadline within 24h and not yet submitted.
  ----------------------------------------------------------------------------
  insert into public.notifications
    (user_id, course_id, quiz_id, audience, kind, title, message, event_key)
  select
    e.user_id, cq.course_id, cq.id, 'student', 'general_quiz_due_soon',
    'General Course Quiz due soon',
    'Your General Course Quiz "' || cq.title || '" for ' || c.title
      || ' is due ' || to_char(cq.deadline at time zone 'UTC',
                               'FMMon FMDD, YYYY "at" HH12:MI AM') || ' UTC.',
    'gcq_soon:' || cq.id::text || ':' || extract(epoch from cq.deadline)::bigint::text
  from public.course_quizzes cq
  join public.courses c on c.id = cq.course_id
  join public.enrollments e on e.course_id = cq.course_id
  where cq.deadline is not null
    and now() >= cq.deadline - interval '24 hours'
    and now() < cq.deadline
    and (cq.available_from is null or now() >= cq.available_from)
    and exists (select 1 from public.questions q where q.course_quiz_id = cq.id)
    and not exists (
      select 1 from public.quiz_attempts a
      where a.course_quiz_id = cq.id and a.user_id = e.user_id
        and a.finished_at is not null
    )
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  ----------------------------------------------------------------------------
  -- STUDENT: deadline passed and never submitted.
  ----------------------------------------------------------------------------
  insert into public.notifications
    (user_id, course_id, quiz_id, audience, kind, title, message, event_key)
  select
    e.user_id, cq.course_id, cq.id, 'student', 'general_quiz_closed',
    'General Course Quiz closed',
    'The General Course Quiz "' || cq.title || '" for ' || c.title
      || ' closed on ' || to_char(cq.deadline at time zone 'UTC',
                                  'FMMon FMDD, YYYY "at" HH12:MI AM') || ' UTC.',
    'gcq_closed:' || cq.id::text || ':' || extract(epoch from cq.deadline)::bigint::text
  from public.course_quizzes cq
  join public.courses c on c.id = cq.course_id
  join public.enrollments e on e.course_id = cq.course_id
  where cq.deadline is not null
    and now() >= cq.deadline
    and exists (select 1 from public.questions q where q.course_quiz_id = cq.id)
    and not exists (
      select 1 from public.quiz_attempts a
      where a.course_quiz_id = cq.id and a.user_id = e.user_id
        and a.finished_at is not null
    )
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  ----------------------------------------------------------------------------
  -- LECTURER: deadline reached, with the real submission summary.
  ----------------------------------------------------------------------------
  insert into public.notifications
    (user_id, course_id, quiz_id, audience, kind, title, message, event_key)
  select
    ls.claimed_by, cq.course_id, cq.id, 'lecturer', 'general_quiz_deadline',
    'General Course Quiz deadline reached',
    'The General Course Quiz "' || cq.title || '" for ' || c.title
      || ' has closed. '
      || (select count(distinct a.user_id)
            from public.quiz_attempts a
            where a.course_quiz_id = cq.id and a.finished_at is not null)::text
      || ' of '
      || (select count(*) from public.enrollments e2 where e2.course_id = cq.course_id)::text
      || ' enrolled students submitted.',
    'gcq_dl:' || cq.id::text || ':' || extract(epoch from cq.deadline)::bigint::text
  from public.course_quizzes cq
  join public.courses c on c.id = cq.course_id
  join public.lecturer_slots ls on ls.course_id = cq.course_id and ls.claimed_by is not null
  where cq.deadline is not null
    and now() >= cq.deadline
    and exists (select 1 from public.questions q where q.course_quiz_id = cq.id)
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end;
$$;

comment on function public.sweep_general_quiz_schedule() is
  'Idempotent sweep: emits General Course Quiz available / due-soon / closed notifications for students and the lecturer. Run by pg_cron. Safe to call repeatedly — every row is deduped on (user_id, event_key).';

-- The sweep is infrastructure, not a user action: no client should call it.
revoke execute on function public.sweep_general_quiz_schedule() from public, anon, authenticated;

-- 4. Schedule it (pg_cron) -----------------------------------------------------
-- Best-effort: if pg_cron cannot be enabled by the migration role, the function
-- above still installs and this block only raises a NOTICE. In that case enable
-- pg_cron (Dashboard -> Database -> Extensions) and run, once:
--   select cron.schedule('gcq-schedule-sweep', '*/15 * * * *',
--                         'select public.sweep_general_quiz_schedule();');
do $$
begin
  execute 'create extension if not exists pg_cron';
  begin
    perform cron.unschedule('gcq-schedule-sweep');
  exception when others then null;
  end;
  perform cron.schedule(
    'gcq-schedule-sweep', '*/15 * * * *',
    'select public.sweep_general_quiz_schedule();'
  );
  raise notice 'pg_cron: scheduled gcq-schedule-sweep (every 15 minutes).';
exception when others then
  raise notice 'pg_cron not scheduled automatically (%). Enable pg_cron, then run: select cron.schedule(''gcq-schedule-sweep'', ''*/15 * * * *'', ''select public.sweep_general_quiz_schedule();'');', sqlerrm;
end $$;
