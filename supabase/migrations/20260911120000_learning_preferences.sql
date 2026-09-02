-- Phase V2 — Learning Preferences.
--
-- Performance data decides WHAT a student needs to learn; Learning Preferences
-- decide HOW AceTutor should present it — explanation style, preferred lesson
-- format, and what helps most after a wrong answer. Preferences are current
-- state, not a historical assessment: exactly one row per user, upserted on
-- user_id. Every field is nullable — a student may answer none, some, or all of
-- them, and change them anytime. Preferences never restrict access to any lesson
-- format or course content.
--
-- ADDITIVE AND REVERSIBLE. This migration does not touch the old VARK system:
-- the public.vark_style enum, profiles.vark_primary, profiles.vark_scores and
-- the public.vark_responses table (with its RLS policies) are all left exactly
-- as they are. A later cleanup phase removes them once this system is verified.

create table if not exists public.learning_preferences (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  explanation_style text,
  lesson_format     text,
  wrong_answer_help text,
  updated_at        timestamptz not null default now(),
  constraint learning_preferences_explanation_style_check
    check (explanation_style is null or explanation_style in
      ('concise', 'detailed', 'step_by_step', 'example_first')),
  constraint learning_preferences_lesson_format_check
    check (lesson_format is null or lesson_format in
      ('written', 'visual', 'audio')),
  constraint learning_preferences_wrong_answer_help_check
    check (wrong_answer_help is null or wrong_answer_help in
      ('simple', 'detailed', 'example', 'similar_practice'))
);

alter table public.learning_preferences enable row level security;

-- Self-only: a student reads and writes their own row and no one else's.
-- Preferences are never lecturer-visible (there is no teacher/admin policy, and
-- the lecturer-scoped RPCs do not select from this table).
create policy "learning_preferences_select_own" on public.learning_preferences
  for select to authenticated using (auth.uid() = user_id);
create policy "learning_preferences_insert_own" on public.learning_preferences
  for insert to authenticated with check (auth.uid() = user_id);
create policy "learning_preferences_update_own" on public.learning_preferences
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "learning_preferences_delete_own" on public.learning_preferences
  for delete to authenticated using (auth.uid() = user_id);

-- One-time, idempotent backfill: seed a lesson_format for students who
-- completed the old VARK assessment, so their default lesson tab keeps working.
-- Only the format maps cleanly from VARK; explanation_style and
-- wrong_answer_help cannot be inferred and are left null. Never creates a row
-- where one already exists, and never overwrites an existing row.
insert into public.learning_preferences (user_id, lesson_format)
select p.id,
       case p.vark_primary
         when 'visual'      then 'visual'
         when 'aural'       then 'audio'
         when 'read_write'  then 'written'
         when 'kinesthetic' then 'written'
       end
  from public.profiles p
 where p.vark_primary is not null
   and not exists (
     select 1 from public.learning_preferences lp where lp.user_id = p.id
   )
on conflict (user_id) do nothing;
