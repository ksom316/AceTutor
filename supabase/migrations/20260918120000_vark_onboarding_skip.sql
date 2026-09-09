-- VARK onboarding step — remember a deliberate "Skip for now". ADDITIVE ONLY.
--
-- The Learning Style Check (VARK) is now offered as an optional step in
-- onboarding, right after Learning Preferences (src/routes/_authenticated/
-- onboarding.vark.tsx). It must never block the student: a "Skip for now" is
-- always available and, once taken, is remembered permanently so the prompt
-- never reappears on future logins.
--
-- One new nullable column records that skip:
--
--   * assessment_completed_at (existing) — set when the questionnaire is
--     submitted. "completed".
--   * onboarding_skipped_at   (new)      — set when the student explicitly
--     skips the onboarding prompt. "skipped".
--   * neither set / no row               — "pending": the onboarding gate
--     (src/lib/post-auth-redirect.ts) shows the prompt once.
--
-- Completion always wins over a skip (a student who skipped and later took the
-- assessment from Profile is "completed"). See varkOnboardingStatus() in
-- src/lib/vark.ts — the single place that rule lives.
--
-- No RLS change: the existing own-row-only policies (vark_profiles_select_own /
-- insert_own / update_own / delete_own) already cover every column. No effect
-- on scores, predictions, course progress, mastery, or quiz results — this
-- column is read only by the onboarding gate and the Profile page.
-- reset_my_learning_data() already deletes the vark_profiles row, which
-- correctly returns the student to "pending".

alter table public.vark_profiles
  add column if not exists onboarding_skipped_at timestamptz;
