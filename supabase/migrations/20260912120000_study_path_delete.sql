-- Phase V4.2.3 — a student can remove their current personalized Study Path.
--
-- ADDITIVE ONLY. This adds a single SECURITY DEFINER entry point and its grant.
-- Nothing else is touched: no schema change, no column, no data migration, no
-- existing function, policy, trigger, table or index. The RLS design for
-- study_paths is unchanged — reads stay on study_paths_select_own, and writes
-- still go only through SECURITY DEFINER functions (save_study_path,
-- mark_study_path_completed, set_study_path_saved, and now this one).
--
-- delete_study_path removes exactly ONE study_paths row, and only the caller's
-- own. It never touches quiz_attempts, attempt_answers, questions, progress,
-- enrollments, learning_preferences, course progress, or any other study_paths
-- row. The study_paths.attempt_id FK is `on delete cascade` FROM quiz_attempts
-- TO study_paths, not the other way round, so deleting the study path leaves the
-- quiz attempt, its score and its answers completely intact.

create or replace function public.delete_study_path(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  delete from public.study_paths
   where id = _id and user_id = v_uid
  returning id into v_deleted;

  if v_deleted is null then
    raise exception 'STUDY_PATH_NOT_FOUND';
  end if;
end;
$$;

revoke execute on function public.delete_study_path(uuid) from public, anon;
grant execute on function public.delete_study_path(uuid) to authenticated;
