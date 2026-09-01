-- AI Personalized Study Path — backend foundation (Phase 2).
--
-- After a student finishes a MODULE quiz and misses questions, a short targeted
-- remedial "study path" can be generated on demand (from the result page, in a
-- later phase). This migration adds the storage plus the two SECURITY DEFINER
-- write entry points. It is additive: it does NOT touch quiz_attempts,
-- attempt_answers, questions, grade_quiz, the quiz timer, any lecturer function,
-- or any existing RLS policy.
--
-- Ownership and the module are always derived server-side from the student's own
-- quiz attempt — the client never supplies user_id / topic_id / course_id.
-- UNIQUE (attempt_id) makes "one study path per attempt" a hard database
-- guarantee, so a double click can never create two rows or trigger a second AI
-- generation.

-- 1. Table -------------------------------------------------------------------
create table if not exists public.study_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  weak_question_ids uuid[] not null default '{}'::uuid[],
  content jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint study_paths_attempt_unique unique (attempt_id),
  constraint study_paths_content_object_ck check (jsonb_typeof(content) = 'object')
);

comment on table public.study_paths is
  'One AI-generated remedial study path per finished module-quiz attempt. Module-specific, owned by the student, derived from quiz_attempts — never from client input.';

-- 2. Indexes ----------------------------------------------------------------
--    UNIQUE (attempt_id) already indexes attempt lookups and the idempotency
--    check. This one backs "the student's latest study path for a module".
create index if not exists study_paths_user_topic_created_idx
  on public.study_paths (user_id, topic_id, created_at desc);

-- 3. RLS ------------------------------------------------------------------
--    Students read only their own paths. There is deliberately NO insert /
--    update / delete policy: the only write paths are the SECURITY DEFINER
--    functions below, so a client can never craft a row or edit the content /
--    ownership fields directly. Lecturers get no access at this stage.
alter table public.study_paths enable row level security;

drop policy if exists "study_paths_select_own" on public.study_paths;
create policy "study_paths_select_own" on public.study_paths
  for select to authenticated using (auth.uid() = user_id);

-- 4. save_study_path() — the single create entry point ---------------------
--    Derives user_id + topic_id from the attempt itself. Idempotent: if a path
--    already exists for the attempt it is returned unchanged and nothing is
--    written. Rejects an attempt that is not the caller's, is not a module
--    quiz, or is not finished.
create or replace function public.save_study_path(
  _attempt_id uuid,
  _content jsonb,
  _weak_question_ids uuid[]
)
returns public.study_paths
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.study_paths;
  v_attempt record;
  v_row public.study_paths;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Idempotency: an existing path for this attempt wins — but only ever the
  -- caller's own row, never another student's.
  select * into v_existing from public.study_paths where attempt_id = _attempt_id;
  if found then
    if v_existing.user_id <> v_uid then
      raise exception 'ATTEMPT_NOT_OWNED';
    end if;
    return v_existing;
  end if;

  select id, user_id, topic_id, finished_at
    into v_attempt
  from public.quiz_attempts
  where id = _attempt_id;

  if not found then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.user_id <> v_uid then
    raise exception 'ATTEMPT_NOT_OWNED';
  end if;
  if v_attempt.topic_id is null then
    raise exception 'NOT_A_MODULE_QUIZ';
  end if;
  if v_attempt.finished_at is null then
    raise exception 'ATTEMPT_NOT_FINISHED';
  end if;
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'INVALID_CONTENT';
  end if;

  insert into public.study_paths (user_id, topic_id, attempt_id, weak_question_ids, content)
  values (
    v_uid,
    v_attempt.topic_id,
    _attempt_id,
    coalesce(_weak_question_ids, '{}'::uuid[]),
    _content
  )
  on conflict (attempt_id) do nothing
  returning * into v_row;

  -- Lost an insert race with a concurrent call — return the row that won.
  if v_row.id is null then
    select * into v_row from public.study_paths where attempt_id = _attempt_id;
  end if;

  return v_row;
end;
$$;

-- 5. mark_study_path_completed() -----------------------------------------
--    Narrow update: only completed_at, only on the caller's own row. The
--    content / ownership / evidence columns can never be changed through this
--    path. Re-marking is a no-op (completed_at is kept, not bumped).
create or replace function public.mark_study_path_completed(_id uuid)
returns public.study_paths
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.study_paths;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.study_paths
     set completed_at = coalesce(completed_at, now())
   where id = _id and user_id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'STUDY_PATH_NOT_FOUND';
  end if;

  return v_row;
end;
$$;

-- 6. Grants -------------------------------------------------------------
revoke execute on function public.save_study_path(uuid, jsonb, uuid[]) from public, anon;
revoke execute on function public.mark_study_path_completed(uuid) from public, anon;
grant execute on function public.save_study_path(uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.mark_study_path_completed(uuid) to authenticated;
