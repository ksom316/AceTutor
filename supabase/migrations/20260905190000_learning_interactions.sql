-- Phase A6 — real student interaction + outcome tracking. ADDITIVE ONLY.
--
-- One small, compact event table for genuine learning interactions —
-- deliberately NOT a giant catch-all analytics table. Exists so a later
-- phase (A7/A8) can eventually ask "what modality was recommended, what did
-- the student actually use, and what was their next official quiz outcome?"
-- This migration only COLLECTS data — no RL/adaptive-weighting logic, no
-- dashboards, no causal attribution anywhere here.
--
-- Event types (exactly 5 — see event_type check below):
--   lesson_opened            — a specific lesson became visible to the student
--   modality_selected        — the student's active modality tab changed
--   practice_quiz_started    — an AI "Quiz Me" practice quiz was generated
--   practice_quiz_completed  — a practice quiz was graded
--   official_quiz_completed  — an official MODULE quiz attempt finished
--
-- Deliberately NOT added: a "lesson_completed" event. public.progress
-- (lesson_id, completed_at) already exists and is the one completion signal
-- this app has — it is set as a side effect of finishing that module's
-- official quiz (see grade_quiz()), not from reading/watching. Duplicating
-- or reinterpreting that here would be exactly the "invent a fake read
-- percentage" / "duplicate tracking" this phase is told not to do. A future
-- query can already join this table to public.progress on
-- (user_id, lesson_id) for completion state.
--
-- Recommendation-context fields (recommended_modality, effective_vark_category,
-- recommendation_matched) are populated only for content events
-- (lesson_opened / modality_selected) where a Phase A4 recommendation
-- computation actually ran. recommendation_matched is NULL — never false —
-- when there was no recommendation to match against at all (no VARK
-- category resolvable, or the recommended modality has no content in this
-- topic); false is reserved strictly for "there was a recommendation and
-- this wasn't it." Nothing here fabricates a recommendation that didn't
-- exist.
--
-- official_quiz_completed rows store ONLY quiz_attempt_id (a reference) +
-- score_percent (a derived value) — never a duplicate of the full attempt
-- row. public.quiz_attempts remains the source of truth; join on
-- quiz_attempt_id for anything else (finished_at, total, etc.).
--
-- Reliability correction (still Phase A6): official_quiz_completed is logged
-- INSIDE grade_quiz() itself, in the same transaction as the score/
-- finished_at update — not from a page the student may never visit, and not
-- from any client-supplied score. This covers every way an official module
-- attempt actually finishes, because finalize_expired_quiz_attempts() (the
-- timeout path) itself only ever finalizes an attempt by calling
-- grade_quiz() — there is no other code path that sets quiz_attempts.
-- finished_at. Idempotent via learning_interactions_official_outcome_uq (a
-- partial unique index on quiz_attempt_id where event_type =
-- 'official_quiz_completed') + `on conflict ... do nothing` — one attempt can
-- produce at most one such row, even if grade_quiz() were ever called again
-- for it (in practice it can't reach that code twice: a second call on an
-- already-finished attempt short-circuits earlier in the function).
-- General Course Quiz attempts (course_quiz_id-based, topic_id null) are
-- never logged this way — only the topic_id-based module-quiz branch does.
--
-- No "metadata jsonb" column — every field this phase actually needs already
-- has a dedicated, checked column.
--
-- Write-once event log: no update policy. A student may insert their own
-- rows, read their own rows, and delete their own rows (the last for
-- Settings → "Reset account data" parity with vark_profiles/progress/etc.).
-- Never lecturer/admin-visible — same posture as vark_profiles.

create table public.learning_interactions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  course_id                uuid references public.courses(id) on delete cascade,
  topic_id                 uuid references public.topics(id) on delete cascade,
  lesson_id                uuid references public.lessons(id) on delete cascade,
  event_type               text not null,
  -- The modality actually engaged with (lesson_opened / modality_selected).
  modality                 text,
  -- Phase A4's resolved recommendation at the time, if any.
  recommended_modality     text,
  effective_vark_category  text,
  recommendation_matched   boolean,
  -- official_quiz_completed only — a reference, not a data duplicate.
  quiz_attempt_id          uuid references public.quiz_attempts(id) on delete cascade,
  -- Derived percentage: official_quiz_completed (server-derived) or
  -- practice_quiz_completed (already server-computed by gradePracticeQuiz).
  score_percent            int,
  -- Phase A5's resolved adaptive difficulty, for practice quiz events.
  difficulty               text,
  created_at               timestamptz not null default now(),
  constraint learning_interactions_event_type_check
    check (event_type in (
      'lesson_opened', 'modality_selected',
      'practice_quiz_started', 'practice_quiz_completed',
      'official_quiz_completed'
    )),
  constraint learning_interactions_modality_check
    check (modality is null or modality in ('text', 'video', 'audio', 'slides')),
  constraint learning_interactions_recommended_modality_check
    check (recommended_modality is null or recommended_modality in ('text', 'video', 'audio', 'slides')),
  constraint learning_interactions_vark_category_check
    check (effective_vark_category is null or effective_vark_category in
      ('visual', 'auditory', 'read_write', 'kinesthetic')),
  constraint learning_interactions_score_percent_check
    check (score_percent is null or (score_percent >= 0 and score_percent <= 100)),
  constraint learning_interactions_difficulty_check
    check (difficulty is null or difficulty in ('easy', 'medium', 'hard'))
);

create index learning_interactions_user_topic_idx
  on public.learning_interactions (user_id, topic_id, created_at);

-- One official_quiz_completed row per attempt, at most. See grade_quiz()
-- below, which relies on this via `on conflict ... where event_type = ...`.
create unique index learning_interactions_official_outcome_uq
  on public.learning_interactions (quiz_attempt_id)
  where event_type = 'official_quiz_completed';

alter table public.learning_interactions enable row level security;

create policy "learning_interactions_select_own" on public.learning_interactions
  for select to authenticated using (auth.uid() = user_id);
-- A plain authenticated client may insert its own rows for every event type
-- EXCEPT official_quiz_completed — that one must only ever be written by
-- grade_quiz() (SECURITY DEFINER, so it runs as the function owner and is
-- unaffected by this policy). Without this exclusion, a client could call the
-- REST API directly to insert a fabricated official_quiz_completed row with
-- an arbitrary score_percent, bypassing both the TS logging helper and
-- grade_quiz()'s server-derived score entirely.
create policy "learning_interactions_insert_own" on public.learning_interactions
  for insert to authenticated
  with check (auth.uid() = user_id and event_type <> 'official_quiz_completed');
create policy "learning_interactions_delete_own" on public.learning_interactions
  for delete to authenticated using (auth.uid() = user_id);

-- Redefine grade_quiz() (verbatim from 20260914160000_general_quiz_schedule.sql,
-- the latest prior definition) to ALSO log the official_quiz_completed
-- outcome, in the same transaction as grading, for module-quiz attempts only.
-- Everything else — grading logic, answer scoring, timeout handling, the
-- progress/lesson-completion side effect — is byte-for-byte unchanged; the
-- only addition is the new v_course_id lookup and the one new insert block
-- (clearly marked below). Mastery, General Course Quiz behavior, and quiz
-- score/grading behavior are all untouched.
create or replace function public.grade_quiz(
  _attempt_id uuid, _answers jsonb, _timed_out boolean default false
)
returns table (question_id uuid, is_correct boolean, correct_index int, explanation text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_topic_id uuid;
  v_cq_id uuid;
  v_finished timestamptz;
  v_expires timestamptz;
  v_cq_deadline timestamptz;
  v_lesson_id uuid;
  v_course_id uuid;
  v_total int := 0;
  v_answered int := 0;
  v_score int := 0;
  rec record;
  v_sel int;
begin
  select user_id, topic_id, course_quiz_id, finished_at, expires_at
    into v_user, v_topic_id, v_cq_id, v_finished, v_expires
    from public.quiz_attempts where id = _attempt_id
    for update;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;

  if v_finished is not null then
    return query
      select aa.question_id, aa.is_correct, q.correct_index, q.explanation
      from public.attempt_answers aa
      join public.questions q on q.id = aa.question_id
      where aa.attempt_id = _attempt_id;
    return;
  end if;

  if v_topic_id is not null then
    select count(*) into v_total from public.questions where topic_id = v_topic_id;
    if v_total = 0 then
      raise exception 'This module does not have a quiz yet.';
    end if;
  elsif v_cq_id is not null then
    select count(*) into v_total from public.questions where course_quiz_id = v_cq_id;
    if v_total = 0 then
      raise exception 'This course does not have a general quiz yet.';
    end if;
    select deadline into v_cq_deadline from public.course_quizzes where id = v_cq_id;
  else
    raise exception 'This quiz attempt is not linked to a quiz.';
  end if;

  for rec in
    select q.id, q.correct_index
    from public.questions q
    where q.id::text in (select jsonb_object_keys(_answers))
      and (
        (v_topic_id is not null and q.topic_id = v_topic_id)
        or (v_cq_id is not null and q.course_quiz_id = v_cq_id)
      )
  loop
    v_sel := (_answers ->> rec.id::text)::int;
    insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
    values (_attempt_id, rec.id, v_sel, v_sel = rec.correct_index)
    -- Named-constraint form (not a column list): this function has a
    -- `question_id` OUT parameter (RETURNS TABLE), and an ON CONFLICT
    -- column-list here is ambiguous against it. Same unique index either way.
    -- (Historical correction — see 20260905200000_grade_quiz_ambiguous_
    -- column_fix.sql for the corrective migration that fixed the live DB;
    -- this file is edited only for future full-migration-replay consistency.)
    on conflict on constraint attempt_answers_attempt_question_key
    do update set selected_index = excluded.selected_index,
                  is_correct     = excluded.is_correct;
  end loop;

  select count(*), count(*) filter (where aa.is_correct)
    into v_answered, v_score
    from public.attempt_answers aa
    where aa.attempt_id = _attempt_id;

  update public.quiz_attempts
    set score = v_score,
        total = v_total,
        answered_count = v_answered,
        finished_at = now(),
        timed_out = _timed_out
          or (v_expires is not null and now() >= v_expires)
          or (v_cq_deadline is not null and now() >= v_cq_deadline)
    where id = _attempt_id;

  if v_topic_id is not null then
    select id into v_lesson_id from public.lessons
      where topic_id = v_topic_id order by order_index, id limit 1;
    if v_lesson_id is not null then
      insert into public.progress (user_id, lesson_id, watched_seconds, completed_at, updated_at)
      values (v_user, v_lesson_id, 0, now(), now())
      on conflict (user_id, lesson_id) do update
        set completed_at = coalesce(public.progress.completed_at, excluded.completed_at),
            updated_at = now();
    end if;

    -- === Phase A6 reliability correction — the only new logic in this
    -- redefinition. v_total is guaranteed > 0 here (checked above), so no
    -- divide-by-zero guard is needed. score_percent comes from v_score/
    -- v_total — the exact values just written to quiz_attempts above, never
    -- client-supplied. Wrapped in its own exception block: this whole
    -- function body is one implicit transaction, so an UNHANDLED error here
    -- would roll back the grading update above too — analytics is secondary
    -- and must never be able to fail grading itself. ===
    begin
      select course_id into v_course_id from public.topics where id = v_topic_id;
      insert into public.learning_interactions
        (user_id, course_id, topic_id, event_type, quiz_attempt_id, score_percent)
      values
        (v_user, v_course_id, v_topic_id, 'official_quiz_completed', _attempt_id,
         round((v_score::numeric / v_total) * 100)::int)
      on conflict (quiz_attempt_id) where event_type = 'official_quiz_completed'
      do nothing;
    exception when others then
      null; -- swallow: grading above must stand regardless of this outcome.
    end;
  end if;

  return query
    select aa.question_id, aa.is_correct, q.correct_index, q.explanation
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where aa.attempt_id = _attempt_id;
end;
$$;
