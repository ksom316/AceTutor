-- Phase 4 — Personalized Learning: a reversible "saved to My Learning" state on
-- study_paths, and support for course-level Study Paths built from General
-- Course Quiz attempts.
--
-- Extends study_paths (Phase 2, 20260909120000). Fully additive / non-destructive:
--   * topic_id becomes NULLABLE — a General Course Quiz study path belongs to
--     the course as a whole, not to one module.
--   * course_id added (NOT NULL after backfill) — a study path always belongs to
--     exactly one course; for a general-quiz path it is the only location anchor.
--   * saved_at added — the reversible "in My Learning" flag. "Generated" (the row
--     exists) and "saved" (saved_at is set) stay separate per the product spec;
--     removing from My Learning clears saved_at and keeps the content.
--
-- Unchanged: UNIQUE(attempt_id) (one path per attempt — a retake makes a new
-- attempt and may make a new path), study_paths_select_own RLS,
-- mark_study_path_completed, and every quiz / progress / lecturer object.
-- save_study_path is replaced (create or replace) to populate course_id and to
-- accept a General Course Quiz attempt. Grants are preserved by create or
-- replace and re-stated below for clarity.

-- 1. Columns -----------------------------------------------------------------
alter table public.study_paths alter column topic_id drop not null;

alter table public.study_paths
  add column if not exists course_id uuid references public.courses(id) on delete cascade;

alter table public.study_paths
  add column if not exists saved_at timestamptz;

-- Backfill course_id for existing (module) rows from their topic. A row can only
-- exist with a valid topic today (topic_id was NOT NULL and FK-cascades), so
-- every existing row resolves.
update public.study_paths sp
   set course_id = t.course_id
  from public.topics t
 where t.id = sp.topic_id
   and sp.course_id is null;

alter table public.study_paths alter column course_id set not null;

-- 2. Indexes ---------------------------------------------------------------
--    The existing study_paths_user_topic_created_idx stays. This one backs the
--    course page's "my saved study paths for this course" query.
create index if not exists study_paths_user_course_idx
  on public.study_paths (user_id, course_id, created_at desc);

-- 3. save_study_path() — now also sets course_id and accepts a general quiz ----
--    Derives topic_id (nullable) and course_id from the caller's own attempt.
--    A module attempt → topic + that topic's course. A General Course Quiz
--    attempt → no topic + that quiz's course. Idempotent on attempt_id.
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
  v_att record;
  v_topic uuid;
  v_course uuid;
  v_row public.study_paths;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Idempotency: an existing path for this attempt wins — the caller's own only.
  select * into v_existing from public.study_paths where attempt_id = _attempt_id;
  if found then
    if v_existing.user_id <> v_uid then
      raise exception 'ATTEMPT_NOT_OWNED';
    end if;
    return v_existing;
  end if;

  select id, user_id, topic_id, course_quiz_id, finished_at
    into v_att
  from public.quiz_attempts
  where id = _attempt_id;

  if not found then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;
  if v_att.user_id <> v_uid then
    raise exception 'ATTEMPT_NOT_OWNED';
  end if;
  if v_att.finished_at is null then
    raise exception 'ATTEMPT_NOT_FINISHED';
  end if;
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'INVALID_CONTENT';
  end if;

  if v_att.topic_id is not null then
    v_topic := v_att.topic_id;
    select course_id into v_course from public.topics where id = v_att.topic_id;
  elsif v_att.course_quiz_id is not null then
    v_topic := null;
    select course_id into v_course from public.course_quizzes where id = v_att.course_quiz_id;
  else
    raise exception 'ATTEMPT_NOT_LINKED';
  end if;

  if v_course is null then
    raise exception 'COURSE_NOT_FOUND';
  end if;

  insert into public.study_paths
    (user_id, topic_id, course_id, attempt_id, weak_question_ids, content)
  values (
    v_uid,
    v_topic,
    v_course,
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

-- 4. set_study_path_saved() — the reversible "in My Learning" toggle ----------
--    Only touches saved_at, only on the caller's own row. Saving is idempotent
--    (the first saved_at is kept, not bumped); removing sets it null and never
--    deletes the row / content.
create or replace function public.set_study_path_saved(_id uuid, _saved boolean)
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
     set saved_at = case when _saved then coalesce(saved_at, now()) else null end
   where id = _id and user_id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'STUDY_PATH_NOT_FOUND';
  end if;

  return v_row;
end;
$$;

-- 5. Grants -------------------------------------------------------------
revoke execute on function public.save_study_path(uuid, jsonb, uuid[]) from public, anon;
revoke execute on function public.set_study_path_saved(uuid, boolean) from public, anon;
grant execute on function public.save_study_path(uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.set_study_path_saved(uuid, boolean) to authenticated;
