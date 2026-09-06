-- R8.3 — allow 'history' as a remedial recommendation source.
--
-- R8 (personal remedial success history) can now sit in front of the existing
-- A7 / VARK / Learning-Preferences / default chain when the student's own
-- completed remedial history carries medium/high-confidence evidence
-- (src/lib/remedial-recommendation.ts). When that happens the recommendation
-- shown — and therefore the value R4 tracking records in
-- learning_interactions.recommendation_source — is 'history'.
--
-- The existing CHECK constraint and the log_remedial_interaction() validation
-- only allowed ('vark', 'adaptive', 'preference', 'default'), so a
-- history-driven remedial engagement event would be silently rejected. This
-- migration widens BOTH to also accept 'history'. ADDITIVE ONLY.
--
-- Untouched: A7 still writes only 'vark' / 'adaptive' (its client logger's
-- RecommendationSource type is unchanged); VARK, Learning Preferences,
-- Mastery, quiz grading, the study_paths schema and every other RLS policy
-- are not modified. No column added, no data changed.
--
-- MANUAL: apply in the Supabase SQL Editor. One constraint recreate + one
-- SECURITY DEFINER function recreate.

alter table public.learning_interactions
  drop constraint if exists learning_interactions_recommendation_source_check;
alter table public.learning_interactions
  add constraint learning_interactions_recommendation_source_check
    check (recommendation_source is null
      or recommendation_source in ('vark', 'adaptive', 'preference', 'default', 'history'));

-- Recreate the sole R4 writer with 'history' accepted for _recommendation_source.
-- Everything else is byte-for-byte the 20260905260000 definition: established-
-- student gate first, ownership re-check, server-derived topic/course/version,
-- idempotent meaningful engagement.
create or replace function public.log_remedial_interaction(
  _study_path_id uuid,
  _event_type text,
  _remedial_format text,
  _recommended_format text,
  _recommendation_source text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sp record;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = v_uid and role = 'student' and status = 'established'
  ) then
    raise exception 'NOT_AN_ESTABLISHED_STUDENT';
  end if;

  if _event_type not in ('remedial_format_selected', 'remedial_meaningful_engagement') then
    raise exception 'INVALID_EVENT_TYPE';
  end if;
  if _remedial_format is null or _remedial_format not in ('text', 'audio', 'visual') then
    raise exception 'INVALID_REMEDIAL_FORMAT';
  end if;
  if _recommended_format is not null
     and _recommended_format not in ('text', 'audio', 'visual') then
    raise exception 'INVALID_RECOMMENDED_FORMAT';
  end if;
  if _recommendation_source is not null
     and _recommendation_source not in ('vark', 'adaptive', 'preference', 'default', 'history') then
    raise exception 'INVALID_RECOMMENDATION_SOURCE';
  end if;

  select id, user_id, topic_id, course_id, remedial_generated_at
    into v_sp
  from public.study_paths
  where id = _study_path_id;

  if not found then raise exception 'STUDY_PATH_NOT_FOUND'; end if;
  if v_sp.user_id <> v_uid then raise exception 'STUDY_PATH_NOT_OWNED'; end if;

  if _event_type = 'remedial_meaningful_engagement' and v_sp.remedial_generated_at is null then
    raise exception 'NO_REMEDIAL_CONTENT';
  end if;

  insert into public.learning_interactions
    (user_id, course_id, topic_id, study_path_id, event_type,
     remedial_format, recommended_remedial_format, recommendation_source,
     remedial_content_version)
  values
    (v_uid, v_sp.course_id, v_sp.topic_id, v_sp.id, _event_type,
     _remedial_format, _recommended_format, _recommendation_source,
     v_sp.remedial_generated_at)
  on conflict do nothing;
end;
$$;

revoke execute on function public.log_remedial_interaction(uuid, text, text, text, text)
  from public, anon;
grant  execute on function public.log_remedial_interaction(uuid, text, text, text, text)
  to authenticated;
