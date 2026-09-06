-- R6 — Embedded Video Remedial Recommendations.
--
-- Adds a cached, personalized remedial VIDEO recommendation to the existing
-- Study Path. One canonical YouTube video id + validated metadata — never
-- iframe HTML, never an arbitrary URL. Text/Audio/Visual remediation is
-- untouched; VARK, A7, Learning Preferences, Mastery and grading are untouched.
--
-- Stored:
--   remedial_video               jsonb  — the recommendation object, or SQL
--                                NULL meaning "searched, nothing suitable"
--                                (still cached, so no re-search every render).
--   remedial_video_generated_at  timestamptz — when the search last ran.
--
-- Not stored: provider API keys, search queries, raw provider payloads.
--
-- MANUAL: apply in the Supabase SQL Editor. Two nullable columns + one
-- SECURITY DEFINER RPC. No backfill.

alter table public.study_paths
  add column if not exists remedial_video              jsonb,
  add column if not exists remedial_video_generated_at timestamptz;

-- The sole writer for the remedial video recommendation on one of the caller's
-- OWN study paths. Mirrors save_study_path_remedial: requires an authenticated
-- ESTABLISHED student (trusted role source: public.user_roles), re-checks
-- ownership via auth.uid(). `_video` may be a JSON object (a recommendation)
-- or SQL NULL (searched, nothing found) — both stamp the timestamp.
create or replace function public.save_study_path_remedial_video(
  _study_path_id uuid, _video jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = v_uid and role = 'student' and status = 'established'
  ) then
    raise exception 'NOT_AN_ESTABLISHED_STUDENT';
  end if;

  if _video is not null and jsonb_typeof(_video) <> 'object' then
    raise exception 'INVALID_VIDEO';
  end if;

  select user_id into v_owner from public.study_paths where id = _study_path_id;
  if not found then raise exception 'STUDY_PATH_NOT_FOUND'; end if;
  if v_owner <> v_uid then raise exception 'STUDY_PATH_NOT_OWNED'; end if;

  update public.study_paths
     set remedial_video              = _video,
         remedial_video_generated_at = now()
   where id = _study_path_id
     and user_id = v_uid;
end;
$$;

revoke execute on function public.save_study_path_remedial_video(uuid, jsonb) from public, anon;
grant  execute on function public.save_study_path_remedial_video(uuid, jsonb) to authenticated;
