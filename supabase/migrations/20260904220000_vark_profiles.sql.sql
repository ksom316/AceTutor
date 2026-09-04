-- Phase A1 — VARK foundation + learner-profile foundation.
--
-- ADDITIVE. One new table, its RLS, and nothing else. Does NOT touch, extend,
-- or replace public.learning_preferences (explicit self-reported preferences —
-- "how would you like this presented") or anything it drives (course-chat.
-- functions.ts / study-path.functions.ts / practice-quiz.functions.ts /
-- topic.$topicId.tsx). Both now sit side by side as the two halves of the
-- student's "learner profile": explicit Learning Preferences (unchanged) and
-- this VARK assessment/profile (new).
--
-- History note: AceTutor once had a VARK system (public.vark_style enum,
-- profiles.vark_primary / vark_scores, public.vark_responses) that was
-- deliberately retired in 20260913120000_retire_vark.sql in favour of
-- learning_preferences' simpler "current state, not a historical assessment"
-- shape. This migration deliberately reuses that same one-row-per-user
-- philosophy (not a revival of vark_responses) — vark_profiles is the CURRENT
-- VARK profile, one row per student, upserted on each (re)take. The full set
-- of answers from the most recent attempt is kept in `responses` (jsonb) purely
-- as an audit trail / future re-scoring or ML-feature input — retaking simply
-- overwrites it, no history table.
--
-- Score/prediction split, per the phase spec:
--   * visual_score / auditory_score / read_write_score / kinesthetic_score —
--     calculated feature values from the deterministic VARK questionnaire
--     (src/lib/vark.ts), always present (default 0).
--   * predicted_category — the current best guess at the student's VARK
--     tendency; null until an assessment is completed.
--   * prediction_source — 'assessment' (the deterministic scoring below) today;
--     'ml_model' is reserved for a LATER phase (Random Forest / Gradient
--     Boosting), not implemented here. Existing rows are never silently
--     reinterpreted as ml_model — only new code from that later phase would
--     ever write that value.
--   * prediction_confidence / model_version — nullable, unused until the ML
--     phase; kept now so that phase is additive (no further migration needed
--     just to add these two columns).
--
-- Nothing here gates onboarding (post-auth-redirect.ts is untouched and keeps
-- reading learning_preferences row-existence only) or restricts any lesson
-- modality/content — this is a profile signal, not an access control.

create table if not exists public.vark_profiles (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  -- Raw answers from the most recent completed assessment, e.g.
  -- [{ "questionId": "q1", "dimensions": ["visual", "kinesthetic"] }, ...].
  -- Ground truth for the scores below; lets scoring be recomputed later
  -- (a scoring-weight change, or ML feature extraction) without re-surveying.
  responses                jsonb,
  visual_score             integer not null default 0,
  auditory_score           integer not null default 0,
  read_write_score         integer not null default 0,
  kinesthetic_score        integer not null default 0,
  predicted_category       text,
  prediction_source        text not null default 'assessment',
  prediction_confidence    numeric(4,3),
  model_version            text,
  assessment_completed_at  timestamptz,
  updated_at               timestamptz not null default now(),
  constraint vark_profiles_predicted_category_check
    check (predicted_category is null or predicted_category in
      ('visual', 'auditory', 'read_write', 'kinesthetic')),
  constraint vark_profiles_prediction_source_check
    check (prediction_source in ('assessment', 'ml_model')),
  constraint vark_profiles_prediction_confidence_check
    check (prediction_confidence is null
      or (prediction_confidence >= 0 and prediction_confidence <= 1)),
  constraint vark_profiles_scores_nonnegative_check
    check (visual_score >= 0 and auditory_score >= 0
      and read_write_score >= 0 and kinesthetic_score >= 0)
);

alter table public.vark_profiles enable row level security;

-- Own row only — identical shape to learning_preferences' RLS. No lecturer
-- policy: exactly like learning_preferences, a VARK profile is never
-- lecturer-visible. This does not broaden or change any existing policy.
create policy "vark_profiles_select_own" on public.vark_profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "vark_profiles_insert_own" on public.vark_profiles
  for insert to authenticated with check (auth.uid() = user_id);
create policy "vark_profiles_update_own" on public.vark_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vark_profiles_delete_own" on public.vark_profiles
  for delete to authenticated using (auth.uid() = user_id);
