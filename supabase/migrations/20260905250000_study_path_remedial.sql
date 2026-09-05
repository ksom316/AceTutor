-- R1 — Adaptive Remedial Content Core.
--
-- Extends the EXISTING Study Path (public.study_paths) with a cached,
-- personalized remedial explanation for its weak concepts. No new tutoring
-- table, no parallel system.
--
-- `study_paths.content` is write-once (save_study_path uses ON CONFLICT DO
-- NOTHING and its Zod contract strips unknown keys), so the remedial payload
-- gets its own nullable columns rather than being merged into `content`.
--
-- Stored: the generated remedial lesson, the recommended modality AT
-- GENERATION TIME, and the timestamp. NOT stored: AI prompts, secrets, or any
-- raw interaction history.
--
-- No A1–A8 object is touched. Grading, Mastery, VARK, Learning Preferences,
-- A7 rewards/thresholds and official quiz behaviour are unchanged.
--
-- MANUAL: apply in the Supabase SQL Editor. Three nullable columns + one
-- SECURITY DEFINER RPC. No backfill.

alter table public.study_paths
  add column if not exists remedial_content       jsonb,
  add column if not exists remedial_modality      text
    check (remedial_modality is null or remedial_modality in ('text', 'audio', 'visual')),
  add column if not exists remedial_generated_at  timestamptz;

-- Upsert the remedial payload for one of the caller's OWN study paths.
-- study_paths has no client write policy by design — this is the only writer,
-- and it re-checks ownership via auth.uid().
create or replace function public.save_study_path_remedial(
  _study_path_id uuid, _content jsonb, _modality text
)
returns public.study_paths
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.study_paths;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'INVALID_CONTENT';
  end if;
  if _modality is null or _modality not in ('text', 'audio', 'visual') then
    raise exception 'INVALID_MODALITY';
  end if;

  update public.study_paths
     set remedial_content      = _content,
         remedial_modality     = _modality,
         remedial_generated_at = now()
   where id = _study_path_id
     and user_id = v_uid
  returning * into v_row;

  if v_row.id is null then raise exception 'STUDY_PATH_NOT_FOUND'; end if;
  return v_row;
end;
$$;

revoke execute on function public.save_study_path_remedial(uuid, jsonb, text) from public, anon;
grant  execute on function public.save_study_path_remedial(uuid, jsonb, text) to authenticated;
