-- Phase A7 evidence-quality fix — add a 'meaningful_engagement' event type.
-- ADDITIVE ONLY.
--
-- A7's adaptive recommendation previously treated any modality_selected /
-- lesson_opened event as proof a student studied with that modality — too
-- weak (a 2-second accidental tab click counted). meaningful_engagement is a
-- new, non-invasive signal emitted client-side once a modality's content has
-- been the active tab with the page visible for a small minimum period
-- (~30s). modality_selected / lesson_opened stay exactly as they are for A6
-- analytics; only A7's evidence query switches to meaningful_engagement.
--
-- Historical modality_selected / lesson_opened rows are NOT retroactively
-- reinterpreted — A7 simply stops selecting them.
--
-- Drop + recreate the event_type check (it was defined inline in
-- 20260905190000_learning_interactions.sql's CREATE TABLE, so it can't be
-- ALTERed in place). Every existing row keeps one of the original five
-- values — all still valid here — so this needs no data migration.
--
-- No RLS change: learning_interactions_insert_own already permits a student
-- to insert their own rows for any event_type except official_quiz_completed
-- (that guard is unchanged), and the select/delete own-row policies cover
-- every row regardless of event_type.

alter table public.learning_interactions
  drop constraint if exists learning_interactions_event_type_check;

alter table public.learning_interactions
  add constraint learning_interactions_event_type_check
    check (event_type in (
      'lesson_opened',
      'modality_selected',
      'meaningful_engagement',
      'practice_quiz_started',
      'practice_quiz_completed',
      'official_quiz_completed'
    ));
