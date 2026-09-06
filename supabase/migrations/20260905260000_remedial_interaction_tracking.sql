-- R4 — Remedial Engagement & Outcome Tracking.
--
-- Extends the EXISTING A6 event log (public.learning_interactions) with two
-- remedial events — `remedial_format_selected` and
-- `remedial_meaningful_engagement` — rather than a second analytics table.
-- New checked columns (consistent with A6), no JSON blob:
--   study_path_id                the intervention
--   remedial_format              text | audio | visual  (visual is NOT a
--                                lesson modality, so it needs its own column)
--   recommended_remedial_format  text | audio | visual  (what R1 recommended)
--   remedial_content_version     study_paths.remedial_generated_at — the
--                                stable, truthful version for dedup
--
-- `recommendation_source` gains 'preference' / 'default' (R1's resolver can
-- return those); A7's code still only ever writes 'vark' / 'adaptive'.
--
-- This is TRACKING only. R4 events are NOT read by A7 (buildModalityEvidence /
-- the adaptive query filter `.eq("event_type","meaningful_engagement")` — a
-- different string). VARK, Learning Preferences, Mastery, completion and
-- official quiz grading are untouched.
--
-- MANUAL: apply in the Supabase SQL Editor. Additive columns + widened checks
-- + one partial unique index + one SECURITY DEFINER RPC + one RLS policy
-- recreate. No data change.

alter table public.learning_interactions
  add column if not exists study_path_id uuid
    references public.study_paths(id) on delete cascade,
  add column if not exists remedial_format text,
  add column if not exists recommended_remedial_format text,
  add column if not exists remedial_content_version timestamptz;

alter table public.learning_interactions
  drop constraint if exists learning_interactions_event_type_check;
alter table public.learning_interactions
  add constraint learning_interactions_event_type_check
    check (event_type in (
      'lesson_opened', 'modality_selected', 'meaningful_engagement',
      'practice_quiz_started', 'practice_quiz_completed', 'official_quiz_completed',
      'remedial_format_selected', 'remedial_meaningful_engagement'
    ));

alter table public.learning_interactions
  drop constraint if exists learning_interactions_recommendation_source_check;
alter table public.learning_interactions
  add constraint learning_interactions_recommendation_source_check
    check (recommendation_source is null
      or recommendation_source in ('vark', 'adaptive', 'preference', 'default'));

alter table public.learning_interactions
  drop constraint if exists learning_interactions_remedial_format_check;
alter table public.learning_interactions
  add constraint learning_interactions_remedial_format_check
    check (remedial_format is null or remedial_format in ('text', 'audio', 'visual'));

alter table public.learning_interactions
  drop constraint if exists learning_interactions_recommended_remedial_format_check;
alter table public.learning_interactions
  add constraint learning_interactions_recommended_remedial_format_check
    check (recommended_remedial_format is null
      or recommended_remedial_format in ('text', 'audio', 'visual'));

-- One meaningful engagement per (study path, format, content version).
create unique index if not exists learning_interactions_remedial_engagement_uq
  on public.learning_interactions (study_path_id, remedial_format, remedial_content_version)
  where event_type = 'remedial_meaningful_engagement';

create index if not exists learning_interactions_study_path_idx
  on public.learning_interactions (study_path_id, event_type, created_at)
  where study_path_id is not null;

-- R4 events go ONLY through log_remedial_interaction() (like official_quiz_completed).
drop policy if exists "learning_interactions_insert_own" on public.learning_interactions;
create policy "learning_interactions_insert_own" on public.learning_interactions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and event_type not in (
      'official_quiz_completed', 'remedial_format_selected', 'remedial_meaningful_engagement'
    )
  );

-- The sole R4 writer: ownership re-checked, topic/course/version server-derived,
-- meaningful engagement idempotent via the partial unique index.
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

  -- R4: only an ESTABLISHED student may log remedial evidence. The trusted
  -- source is public.user_roles (one role per user, FIX 1 / 20260905230000):
  -- role = 'student' AND status = 'established'. A lecturer ('teacher'), an
  -- admin, or a provisional/legacy row is rejected here even if malformed data
  -- somehow gave that account a study_paths row. No client parameter and no
  -- token claim is consulted for the role decision.
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
     and _recommendation_source not in ('vark', 'adaptive', 'preference', 'default') then
    raise exception 'INVALID_RECOMMENDATION_SOURCE';
  end if;

  select id, user_id, topic_id, course_id, remedial_generated_at
    into v_sp
  from public.study_paths
  where id = _study_path_id;

  if not found then raise exception 'STUDY_PATH_NOT_FOUND'; end if;
  if v_sp.user_id <> v_uid then raise exception 'STUDY_PATH_NOT_OWNED'; end if;

  -- Meaningful engagement is only real once content exists; the version is its
  -- dedup key.
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
