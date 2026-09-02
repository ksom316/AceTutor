-- Phase 6 — Retire the obsolete VARK learner-classification objects.
--
-- VARK is no longer a classification system in AceTutor. Its UI and application
-- logic were removed in earlier phases; the replacement is public.learning_
-- preferences (explanation_style / lesson_format / wrong_answer_help), which is
-- fully independent of VARK — its own table, its own string CHECK constraints
-- (not the vark_style enum), its own RLS. The one-time backfill in
-- 20260911120000_learning_preferences.sql already read profiles.vark_primary,
-- and this migration runs strictly after it, so a fresh replay is unaffected.
--
-- HISTORICAL MIGRATIONS ARE NOT TOUCHED. The objects below were created by
-- 20260511120656_*.sql (enum, profiles columns, vark_responses + its
-- vark_select_own / vark_insert_own policies) and 20260718140000_*.sql
-- (vark_delete_own policy). Those files stay exactly as they are — this
-- migration only removes the objects from the CURRENT schema.
--
-- Scope: VARK-only objects. Nothing else is altered — learning_preferences,
-- study_paths, quiz_attempts, attempt_answers, courses, lessons, quizzes,
-- questions, enrollments, progress, and every non-VARK column of profiles are
-- untouched. No table is recreated. No data outside these objects is affected.
--
-- Dependency-aware order:
--   1. vark_responses  — dropping the table also drops its three RLS policies
--                        (vark_select_own, vark_insert_own, vark_delete_own)
--                        and its computed_style column (the enum's only table
--                        use). The user_id FK points OUT to auth.users, so
--                        nothing else depends on this table.
--   2. profiles.vark_primary / profiles.vark_scores — nullable, no default, no
--      index, no constraint; nothing reads or writes them any more.
--   3. public.vark_style enum — after 1 and 2 it has no remaining references.

drop table if exists public.vark_responses;

alter table if exists public.profiles drop column if exists vark_primary;
alter table if exists public.profiles drop column if exists vark_scores;

drop type if exists public.vark_style;
