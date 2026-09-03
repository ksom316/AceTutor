-- Quiz Recovery Phase QR1 — reliable recovery of an in-progress OFFICIAL quiz
-- (module quiz or General Course Quiz) after a refresh, tab/browser close,
-- network blip, or return from another device.
--
-- ADDITIVE. It adds two uniqueness guarantees, one restricted read function, one
-- write function, tightens one SELECT policy (strictly more restrictive), and
-- replaces grade_quiz's body (same signature). No table/column is dropped, no
-- data is destroyed beyond de-duplicating rows that should never have existed.
--
-- Design:
--   * The attempt row + its absolute `quiz_attempts.expires_at` (stamped by the
--     existing trigger from started_at + the quiz's duration) stay the single
--     source of truth for the deadline. Nothing here ever recomputes or extends
--     it. An expired attempt is finalized by the existing
--     finalize_expired_quiz_attempts(), never resumed with fresh time.
--   * Each selected answer is persisted immediately via save_quiz_answer(),
--     idempotently (UPSERT on the attempt+question), so changing an answer never
--     duplicates a row.
--   * On resume the client reads back only its own selected indices via
--     get_attempt_answers() — `is_correct` is never returned, and the
--     answers_select_own policy now hides attempt_answers entirely until the
--     attempt is finished, so a student cannot learn mid-quiz which answers were
--     right.
--   * At most one unfinished attempt can exist per (student, module) and per
--     (student, General Course Quiz) — enforced by partial unique indexes, so a
--     double-click / reload race can never create parallel active attempts.

-- ---------------------------------------------------------------------------
-- 1. attempt_answers: one row per (attempt, question)
-- ---------------------------------------------------------------------------
-- grade_quiz has only ever inserted one row per question in a single pass, so
-- there should be no duplicates; de-dupe defensively before adding the guard.
delete from public.attempt_answers a
using public.attempt_answers b
where a.ctid < b.ctid
  and a.attempt_id = b.attempt_id
  and a.question_id = b.question_id;

do $$
begin
  alter table public.attempt_answers
    add constraint attempt_answers_attempt_question_key unique (attempt_id, question_id);
exception
  when duplicate_object then null;  -- already added (safe re-run)
end $$;

-- ---------------------------------------------------------------------------
-- 2. quiz_attempts: at most one ACTIVE (unfinished) attempt per quiz per student
-- ---------------------------------------------------------------------------
-- Close any pre-existing extra active attempts (keep the newest per key). These
-- are leftovers from reload races; closing them just sets finished_at so they
-- become inert history (total = 0 → never usable for mastery / performance).
update public.quiz_attempts a
set finished_at = coalesce(a.expires_at, now()), timed_out = true
where a.finished_at is null
  and (a.topic_id is not null or a.course_quiz_id is not null)
  and exists (
    select 1 from public.quiz_attempts b
    where b.user_id = a.user_id
      and b.finished_at is null
      and b.id <> a.id
      and coalesce(b.topic_id, b.course_quiz_id) = coalesce(a.topic_id, a.course_quiz_id)
      and (b.started_at, b.id) > (a.started_at, a.id)
  );

create unique index if not exists quiz_attempts_one_active_module
  on public.quiz_attempts (user_id, topic_id)
  where finished_at is null and topic_id is not null;

create unique index if not exists quiz_attempts_one_active_general
  on public.quiz_attempts (user_id, course_quiz_id)
  where finished_at is null and course_quiz_id is not null;

-- ---------------------------------------------------------------------------
-- 3. attempt_answers SELECT: only visible once the attempt is finished
-- ---------------------------------------------------------------------------
drop policy if exists "answers_select_own" on public.attempt_answers;
create policy "answers_select_own" on public.attempt_answers
  for select to authenticated
  using (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id
        and a.user_id = auth.uid()
        and a.finished_at is not null
    )
  );
-- answers_insert_own / answers_delete_own are unchanged; incremental saves go
-- through the SECURITY DEFINER save_quiz_answer() below, not direct inserts.

-- ---------------------------------------------------------------------------
-- 4. save_quiz_answer — persist one selected answer, mid-quiz, idempotently
-- ---------------------------------------------------------------------------
create or replace function public.save_quiz_answer(
  _attempt_id uuid, _question_id uuid, _selected_index int
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user     uuid;
  v_topic    uuid;
  v_cq       uuid;
  v_finished timestamptz;
  v_expires  timestamptz;
  v_correct  int;
begin
  select user_id, topic_id, course_quiz_id, finished_at, expires_at
    into v_user, v_topic, v_cq, v_finished, v_expires
    from public.quiz_attempts
    where id = _attempt_id
    for update;

  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;
  if v_finished is not null then
    raise exception 'This attempt has already been submitted.';
  end if;
  if v_expires is not null and now() >= v_expires then
    raise exception 'This attempt has run out of time.';
  end if;
  if _selected_index is null or _selected_index < 0 then
    raise exception 'Invalid answer.';
  end if;

  -- The question must belong to THIS attempt's quiz (module XOR general) — never
  -- allow an answer to be attributed to another quiz's question.
  select q.correct_index
    into v_correct
    from public.questions q
    where q.id = _question_id
      and (
        (v_topic is not null and q.topic_id = v_topic)
        or (v_cq is not null and q.course_quiz_id = v_cq)
      );
  if v_correct is null then
    raise exception 'That question is not part of this quiz.';
  end if;

  insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
  values (_attempt_id, _question_id, _selected_index, _selected_index = v_correct)
  on conflict on constraint attempt_answers_attempt_question_key
  do update set selected_index = excluded.selected_index,
                is_correct     = excluded.is_correct;
end;
$$;

comment on function public.save_quiz_answer(uuid, uuid, int) is
  'Persist one selected answer for the caller''s OWN in-progress attempt. Idempotent UPSERT on (attempt_id, question_id). Rejects a finished or expired attempt and any question not belonging to the attempt''s quiz. Returns nothing — correctness is never exposed mid-quiz.';

-- ---------------------------------------------------------------------------
-- 5. get_attempt_answers — restore selected answers on resume (no answer key)
-- ---------------------------------------------------------------------------
create or replace function public.get_attempt_answers(_attempt_id uuid)
returns table (question_id uuid, selected_index int)
language sql stable security definer set search_path = public
as $$
  select aa.question_id, aa.selected_index
  from public.attempt_answers aa
  join public.quiz_attempts a on a.id = aa.attempt_id
  where aa.attempt_id = _attempt_id
    and a.user_id = auth.uid();
$$;

comment on function public.get_attempt_answers(uuid) is
  'The caller''s previously selected answers (question_id + selected_index only) for their own attempt, for restoring an in-progress quiz on resume. Never returns is_correct / correct_index / explanation.';

-- ---------------------------------------------------------------------------
-- 6. grade_quiz — UPSERT answers, score from everything persisted
-- ---------------------------------------------------------------------------
-- Same signature. Two changes: the per-answer insert is now an UPSERT (so a
-- final submit that re-sends an already-saved answer does not collide), and the
-- final score / answered_count are counted from attempt_answers (so a partially
-- answered attempt that is finalized on timeout — grade_quiz(id, '{}', true) —
-- is scored on what the student actually saved, not as 0).
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
  v_lesson_id uuid;
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
  else
    raise exception 'This quiz attempt is not linked to a quiz.';
  end if;

  -- UPSERT every answer the client submitted (may be '{}' on timeout-finalize).
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
    on conflict on constraint attempt_answers_attempt_question_key
    do update set selected_index = excluded.selected_index,
                  is_correct     = excluded.is_correct;
  end loop;

  -- Authoritative totals from everything persisted for this attempt
  -- (incremental saves + this submission).
  select count(*), count(*) filter (where aa.is_correct)
    into v_answered, v_score
    from public.attempt_answers aa
    where aa.attempt_id = _attempt_id;

  update public.quiz_attempts
    set score = v_score,
        total = v_total,
        answered_count = v_answered,
        finished_at = now(),
        timed_out = _timed_out or (v_expires is not null and now() >= v_expires)
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
  end if;

  return query
    select aa.question_id, aa.is_correct, q.correct_index, q.explanation
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where aa.attempt_id = _attempt_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.save_quiz_answer(uuid, uuid, int) from public, anon;
grant  execute on function public.save_quiz_answer(uuid, uuid, int) to authenticated;

revoke execute on function public.get_attempt_answers(uuid) from public, anon;
grant  execute on function public.get_attempt_answers(uuid) to authenticated;
