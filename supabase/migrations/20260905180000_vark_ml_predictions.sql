-- Phase A3 — live VARK ML integration. ADDITIVE ONLY.
--
-- Adds 5 new columns to public.vark_profiles to store the ACTUAL trained
-- 4-feature scikit-learn model's prediction (ml/vark/, model_version
-- "vark-assessment-a2.1-v1") separately from the questionnaire-derived
-- result. Nothing existing is renamed, backfilled, or reinterpreted:
--
--   * predicted_category / prediction_source / prediction_confidence /
--     model_version already represent the questionnaire result exclusively
--     (every row's prediction_source is 'assessment' today — nothing has
--     ever written 'ml_model' to it). They are left completely untouched.
--   * ml_predicted_category / ml_prediction_confidence /
--     ml_class_probabilities / ml_model_version / ml_predicted_at are the
--     NEW, separate ML signal. Written only by the server-side
--     predictVarkMlCategory function (src/lib/vark-inference.functions.ts)
--     after a real call to the deployed model — never faked, never derived
--     client-side, never overwriting the questionnaire fields above.
--
-- All nullable: null means "ML inference hasn't run yet, or its last attempt
-- failed" — the UI shows "ML classification unavailable" in that case rather
-- than guessing. A retake recomputes the questionnaire result AND reruns
-- inference, replacing these 5 fields together on success.
--
-- No RLS change needed — the existing own-row-only policies on vark_profiles
-- (vark_profiles_select_own / insert_own / update_own / delete_own) already
-- cover every column of the row, these included.

alter table public.vark_profiles
  add column if not exists ml_predicted_category text,
  add column if not exists ml_prediction_confidence numeric(4,3),
  add column if not exists ml_class_probabilities jsonb,
  add column if not exists ml_model_version text,
  add column if not exists ml_predicted_at timestamptz;

alter table public.vark_profiles
  add constraint vark_profiles_ml_predicted_category_check
    check (ml_predicted_category is null or ml_predicted_category in
      ('visual', 'auditory', 'read_write', 'kinesthetic'));

alter table public.vark_profiles
  add constraint vark_profiles_ml_prediction_confidence_check
    check (ml_prediction_confidence is null
      or (ml_prediction_confidence >= 0 and ml_prediction_confidence <= 1));
