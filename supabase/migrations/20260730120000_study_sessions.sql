-- Study sessions: how long a user actually spends learning in the app.
--
-- One row per contiguous stretch of active time on a learning surface (course
-- page, module, quiz, games). The client counts only seconds where the tab is
-- visible and the user isn't idle, and starts a new row whenever the course in
-- focus changes or the user comes back after a break — so a row is both a
-- "session segment" and the unit of per-course attribution.
create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Course being studied, or null for course-agnostic surfaces (e.g. Games
  -- with a mixed puzzle).
  course_id uuid references public.courses(id) on delete set null,
  -- Which surface the time was spent on: 'course' | 'module' | 'quiz' | 'game'.
  surface text not null default 'course',
  started_at timestamptz not null default now(),
  -- Bumped on every heartbeat, so an abandoned tab can be spotted.
  last_seen_at timestamptz not null default now(),
  -- Active seconds accumulated in this segment.
  seconds int not null default 0,
  constraint study_sessions_seconds_nonneg check (seconds >= 0)
);

create index if not exists study_sessions_user_started_idx
  on public.study_sessions (user_id, started_at desc);

alter table public.study_sessions enable row level security;

create policy "study_sessions_select_own" on public.study_sessions
  for select to authenticated using (auth.uid() = user_id);
create policy "study_sessions_insert_own" on public.study_sessions
  for insert to authenticated with check (auth.uid() = user_id);
create policy "study_sessions_update_own" on public.study_sessions
  for update to authenticated using (auth.uid() = user_id);
-- Backs Settings → "Reset account data".
create policy "study_sessions_delete_own" on public.study_sessions
  for delete to authenticated using (auth.uid() = user_id);
