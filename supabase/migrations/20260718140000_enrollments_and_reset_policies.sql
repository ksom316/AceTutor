-- Enrollments: which courses a user has joined. Existed only in the original
-- hosted database; recorded here so migrations fully describe the schema.
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);
alter table public.enrollments enable row level security;

create policy "enrollments_select_own" on public.enrollments
  for select to authenticated using (auth.uid() = user_id);
create policy "enrollments_insert_own" on public.enrollments
  for insert to authenticated with check (auth.uid() = user_id);
create policy "enrollments_delete_own" on public.enrollments
  for delete to authenticated using (auth.uid() = user_id);

-- Delete policies backing Settings → "Reset account data": users may erase
-- their own activity records.
create policy "attempts_delete_own" on public.quiz_attempts
  for delete to authenticated using (auth.uid() = user_id);
create policy "answers_delete_own" on public.attempt_answers
  for delete to authenticated
  using (exists (select 1 from public.quiz_attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy "progress_delete_own" on public.progress
  for delete to authenticated using (auth.uid() = user_id);
create policy "vark_delete_own" on public.vark_responses
  for delete to authenticated using (auth.uid() = user_id);
