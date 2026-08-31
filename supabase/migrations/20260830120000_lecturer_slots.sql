-- Lecturer identity: five pre-assigned Lecturer IDs, each permanently bound to
-- one existing course. A person becomes a lecturer (internal role 'teacher')
-- only by claiming a valid, unclaimed Lecturer ID through claim_lecturer_slot().
-- The course binding is fixed at seed time and can never be changed from a
-- client: there is no UPDATE/DELETE policy on the table, and no function accepts
-- a course id.

create table if not exists public.lecturer_slots (
  lecturer_id text primary key,
  -- unique => each course has at most one slot, each slot exactly one course.
  course_id uuid not null unique references public.courses(id) on delete restrict,
  -- The auth user who claimed this slot. Nullable until claimed; set to null if
  -- the account is later deleted, but claimed_at stays set so the ID is spent.
  claimed_by uuid unique references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lecturer_slots enable row level security;

-- A lecturer may read only their own claimed slot. There is deliberately no
-- insert / update / delete policy: the sole mutation path is the SECURITY
-- DEFINER function claim_lecturer_slot().
create policy "lecturer_slots_select_own" on public.lecturer_slots
  for select to authenticated using (claimed_by = auth.uid());

revoke insert, update, delete on public.lecturer_slots from anon, authenticated;

-- Fail loudly rather than seed an incomplete lecturer setup.
do $$
declare
  v_missing text;
begin
  select string_agg(want.slug, ', ' order by want.slug) into v_missing
  from (values ('dsa'), ('dbms'), ('networks'), ('se'), ('ai')) as want(slug)
  where not exists (select 1 from public.courses c where c.slug = want.slug);
  if v_missing is not null then
    raise exception 'lecturer_slots seed aborted -- missing course slug(s): %', v_missing;
  end if;
end
$$;

insert into public.lecturer_slots (lecturer_id, course_id)
select map.lecturer_id, c.id
from (values
  ('LECT-001', 'dsa'),
  ('LECT-002', 'dbms'),
  ('LECT-003', 'networks'),
  ('LECT-004', 'se'),
  ('LECT-005', 'ai')
) as map(lecturer_id, slug)
join public.courses c on c.slug = map.slug
on conflict (lecturer_id) do nothing;

-- The caller's assigned course id, or NULL when the caller is not a lecturer.
-- SECURITY DEFINER so it can be used inside RLS policies without granting
-- clients direct read access to lecturer_slots.
create or replace function public.current_lecturer_course()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select course_id from public.lecturer_slots where claimed_by = auth.uid();
$$;

-- Pre-signup UX helper ONLY -- real enforcement lives in claim_lecturer_slot().
-- Returns one of: 'available' | 'claimed' | 'invalid'.
create or replace function public.lecturer_id_available(_lecturer_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.lecturer_id is null then 'invalid'
    when s.claimed_at is not null then 'claimed'
    else 'available'
  end
  from (select upper(trim(_lecturer_id)) as k) q
  left join public.lecturer_slots s on s.lecturer_id = q.k;
$$;

-- Atomically claim a Lecturer ID for the current user and promote them to the
-- internal 'teacher' role. Row-locks the target slot so concurrent claims of
-- the same ID serialize and only the first succeeds.
create or replace function public.claim_lecturer_slot(_lecturer_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := upper(trim(_lecturer_id));
  v_slot public.lecturer_slots%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to register as a lecturer.';
  end if;

  if exists (select 1 from public.lecturer_slots where claimed_by = auth.uid()) then
    raise exception 'This account is already registered as a lecturer.';
  end if;

  select * into v_slot from public.lecturer_slots
    where lecturer_id = v_key
    for update;

  if not found then
    raise exception 'Invalid Lecturer ID.';
  end if;

  if v_slot.claimed_at is not null then
    raise exception 'This Lecturer ID has already been claimed.';
  end if;

  update public.lecturer_slots
    set claimed_by = auth.uid(), claimed_at = now()
    where lecturer_id = v_key;

  -- Keep exactly one user_roles row for this user (the .maybeSingle() reads in
  -- AppSidebar / AppNavSheet / index.tsx depend on that).
  delete from public.user_roles where user_id = auth.uid();
  insert into public.user_roles (user_id, role) values (auth.uid(), 'teacher');

  return v_slot.course_id;
end;
$$;

revoke execute on function public.current_lecturer_course() from public;
revoke execute on function public.lecturer_id_available(text) from public;
revoke execute on function public.claim_lecturer_slot(text) from public, anon;
grant execute on function public.current_lecturer_course() to authenticated;
grant execute on function public.lecturer_id_available(text) to anon, authenticated;
grant execute on function public.claim_lecturer_slot(text) to authenticated;

-- Harden signup: every new account is a student. Lecturer status can only be
-- granted by claim_lecturer_slot() after a valid Lecturer ID is verified.
-- This removes the raw_user_meta_data->>'account_type' self-promotion path from
-- 20260822120000_teacher_publishing_notifications.sql.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  insert into public.user_roles (user_id, role) values (new.id, 'student');
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
