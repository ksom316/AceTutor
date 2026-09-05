-- Phase A7 correctness — record whether the modality recommendation the
-- student was actually shown at interaction time came from the VARK prior
-- (A4) or from the adaptive override (A7). ADDITIVE ONLY.
--
-- Why this is necessary (not just nice-to-have): once A7 can override the
-- displayed recommendation, `recommended_modality` alone no longer tells a
-- later A8 evaluation which recommendation a student was following. The two
-- cases are NOT cleanly re-derivable after the fact — the VARK->modality
-- mapping depends on which lesson modalities existed for that topic at that
-- moment (lecturers add/remove content over time), and an adaptive
-- recommendation that happened to agree with VARK ("vark_confirmed") is
-- indistinguishable from a pure VARK event without this field. So one small
-- nullable, checked column is the smallest truthful solution.
--
-- Populated only for content events (lesson_opened / modality_selected) that
-- actually displayed a recommendation. NULL when no recommendation was shown
-- (same as recommended_modality / recommendation_matched). Never changes the
-- student's VARK classification — effective_vark_category continues to carry
-- their real resolved category regardless of which source drove the
-- displayed recommendation.
--
-- No RLS change: the existing own-row policies
-- (learning_interactions_select_own / insert_own / delete_own) already cover
-- every column of the row. The insert_own policy's
-- `event_type <> 'official_quiz_completed'` guard is untouched.

alter table public.learning_interactions
  add column if not exists recommendation_source text;

alter table public.learning_interactions
  add constraint learning_interactions_recommendation_source_check
    check (recommendation_source is null or recommendation_source in ('vark', 'adaptive'));
