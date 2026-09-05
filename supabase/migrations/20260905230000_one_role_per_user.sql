-- FIX 1 — one authenticated identity = exactly ONE AceTutor role.
--
-- Root cause: `user_roles` only had a (user_id, role) unique key, so a single
-- account could hold both `student` and `teacher` rows, and
-- `claim_lecturer_slot()` did an unconditional `delete + insert` that would
-- overwrite an existing role no matter how established the account was. There
-- was also no way to tell a REAL student apart from the placeholder `student`
-- row `handle_new_user()` creates for every signup (including a would-be
-- lecturer's), so lecturer onboarding depended on "has zero student activity".
--
-- This migration makes ROLE OWNERSHIP EXPLICIT, not activity-derived:
--   1. `user_roles.status` distinguishes an ESTABLISHED role from a
--      PROVISIONAL placeholder (a would-be lecturer between signup and claim).
--      Every existing row is ESTABLISHED (they are all real).
--   2. `handle_new_user()` writes `status = 'provisional'` ONLY when the
--      signup explicitly declares lecturer intent (raw_user_meta_data ->
--      'signup_intent' = 'lecturer'); every other signup — student form,
--      Google OAuth — is an ESTABLISHED student. The marker can only WEAKEN
--      the row (provisional), never grant a role.
--   3. one-row-per-user unique constraint — no dual-role accounts, ever.
--   4. `claim_lecturer_slot()` decides purely on `status`: an ESTABLISHED
--      student is rejected outright; a PROVISIONAL / missing row converts in
--      place to `teacher` (status established). It NEVER deletes/overwrites a
--      role. A small activity probe stays ONLY as a defensive backstop for
--      provisional/legacy rows — never the primary rule.
--
-- MANUAL: apply in the Supabase SQL Editor. Additive column + de-dupe +
-- constraint + two CREATE OR REPLACEs. No data destroyed beyond genuine
-- duplicate role rows.

-- 1. de-dupe (safety net; the app never creates dual rows) ------------------
delete from public.user_roles a
using public.user_roles b
where a.user_id = b.user_id
  and a.ctid <> b.ctid
  and a.role = 'student'
  and b.role in ('teacher', 'admin');

delete from public.user_roles a
using public.user_roles b
where a.user_id = b.user_id
  and a.ctid > b.ctid;

-- 2. explicit role establishment state ------------------------------------
alter table public.user_roles
  add column if not exists status text not null default 'established'
    check (status in ('provisional', 'established'));
-- every pre-existing role is a real, established one
update public.user_roles set status = 'established' where status is null;

-- 3. one role per user ---------------------------------------------------
alter table public.user_roles drop constraint if exists user_roles_user_id_role_key;
alter table public.user_roles drop constraint if exists user_roles_user_id_key;
alter table public.user_roles add constraint user_roles_user_id_key unique (user_id);

-- 4. signup trigger: student is established; lecturer-intent is provisional -
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));

  -- The role is ALWAYS 'student' here; `signup_intent` (client-supplied) can
  -- only mark the row PROVISIONAL — it never grants a role. Authorisation to
  -- become a teacher still requires a valid public.lecturer_slots row via
  -- claim_lecturer_slot().
  insert into public.user_roles (user_id, role, status)
  values (
    new.id,
    'student',
    case
      when new.raw_user_meta_data->>'signup_intent' = 'lecturer' then 'provisional'
      else 'established'
    end
  );

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 5. claim_lecturer_slot: status is the primary rule; no overwrite --------
create or replace function public.claim_lecturer_slot(_lecturer_id text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := upper(trim(_lecturer_id));
  v_slot public.lecturer_slots%rowtype;
  v_role text;
  v_status text;
  v_legacy_student boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to register as a lecturer.';
  end if;
  if exists (select 1 from public.lecturer_slots where claimed_by = auth.uid()) then
    raise exception 'This account is already registered as a lecturer.';
  end if;

  select * into v_slot from public.lecturer_slots where lecturer_id = v_key for update;
  if not found then
    raise exception 'Invalid Lecturer ID.';
  end if;
  if v_slot.claimed_at is not null then
    raise exception 'This Lecturer ID has already been claimed.';
  end if;

  select role, status into v_role, v_status
    from public.user_roles where user_id = auth.uid();

  -- PRIMARY RULE: an established role of the opposite kind is a hard conflict.
  if v_role = 'student' and v_status = 'established' then
    raise exception
      'ROLE_CONFLICT_STUDENT: This email is already registered as a student account. Please sign in as a student or use a different email to register as a lecturer.'
      using errcode = 'P0001';
  end if;

  -- DEFENSIVE BACKSTOP ONLY (never the primary rule): a provisional / legacy /
  -- missing row that nonetheless carries real student history is treated as an
  -- established student. A `teacher` row is a retry — always fine to bind.
  if v_role is distinct from 'teacher' then
    select exists (
      select 1 from public.enrollments          where user_id = auth.uid()
      union all
      select 1 from public.quiz_attempts         where user_id = auth.uid()
      union all
      select 1 from public.learning_preferences  where user_id = auth.uid()
      union all
      select 1 from public.vark_profiles         where user_id = auth.uid()
      union all
      select 1 from public.study_paths           where user_id = auth.uid()
      union all
      select 1 from public.learning_interactions where user_id = auth.uid()
      union all
      select 1 from public.ai_conversations      where user_id = auth.uid()
    ) into v_legacy_student;

    if v_legacy_student then
      raise exception
        'ROLE_CONFLICT_STUDENT: This email is already registered as a student account. Please sign in as a student or use a different email to register as a lecturer.'
        using errcode = 'P0001';
    end if;
  end if;

  update public.lecturer_slots
     set claimed_by = auth.uid(), claimed_at = now()
   where lecturer_id = v_key;

  -- Establish the teacher role IN PLACE — never a delete-then-insert, never a
  -- second row.
  update public.user_roles set role = 'teacher', status = 'established'
   where user_id = auth.uid();
  if not found then
    insert into public.user_roles (user_id, role, status)
    values (auth.uid(), 'teacher', 'established');
  end if;

  return v_slot.course_id;
end;
$$;

revoke execute on function public.claim_lecturer_slot(text) from public, anon;
grant  execute on function public.claim_lecturer_slot(text) to authenticated;
