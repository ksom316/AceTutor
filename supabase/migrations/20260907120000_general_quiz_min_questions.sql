-- General Course Quiz: created atomically with at least one question, and kept
-- non-empty afterwards.
--
-- Today a lecturer creates an empty course_quizzes row and adds questions later.
-- This migration:
--   1. adds an ADDITIVE RPC create_course_quiz_with_questions(...) that requires
--      >= 1 question and writes the quiz + its questions in one transaction. The
--      existing create_course_quiz(...) is left exactly as-is (unused by the new
--      lecturer flow, still valid for anything else).
--   2. adds a deferred constraint trigger so a general course quiz can never be
--      left with zero questions once it has one — the same shape as
--      assert_topic_has_questions (20260905120000) but keyed on course_quiz_id.
--
-- APPLY ORDER: after 20260905120000 (course_quizzes.duration_minutes / questions
-- .course_quiz_id) and 20260907110000 (duration clamp floor 1). Filename order
-- already guarantees this.
--
-- Additive / non-destructive:
--   * no existing function, trigger, policy or column is dropped or altered
--   * replace_course_quiz / delete_course_quiz are unaffected: replace_course_quiz
--     deletes + re-inserts in one transaction (the deferred trigger checks at
--     COMMIT, when the count is > 0 again); delete_course_quiz removes the
--     course_quizzes row first, so the trigger sees the parent gone and skips.
--   * existing empty general quizzes stay as they are (the trigger only fires on
--     DELETE) and remain hidden from students until they get a question.
--   * grading, the quiz timer, RLS, lecturer authorization and lecturer
--     assignment are untouched.

-- 1. Atomic create-with-questions RPC --------------------------------------
create or replace function public.create_course_quiz_with_questions(
  _title text,
  _questions jsonb,
  _description text default null,
  _deadline timestamptz default null,
  _max_attempts int default null,
  _duration_minutes int default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_id uuid;
  v_title text;
  v_i int := 0;
  q jsonb;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can create a general course quiz.';
  end if;
  if _max_attempts is not null and _max_attempts < 1 then
    raise exception 'Maximum attempts must be at least 1, or unlimited.';
  end if;
  if _questions is null or jsonb_typeof(_questions) <> 'array'
     or jsonb_array_length(_questions) < 1 then
    raise exception 'A general course quiz needs at least one question before it can be created.';
  end if;
  if jsonb_array_length(_questions) > 50 then
    raise exception 'A quiz can have at most 50 questions.';
  end if;

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then
    v_title := 'General Course Quiz';
  end if;

  insert into public.course_quizzes
    (course_id, title, description, deadline, max_attempts, duration_minutes)
  values (
    v_course,
    v_title,
    nullif(btrim(coalesce(_description, '')), ''),
    _deadline,
    _max_attempts,
    least(greatest(coalesce(_duration_minutes, 30), 1), 240)
  )
  returning id into v_id;

  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      v_id,
      q->>'prompt',
      q->'choices',
      (q->>'correct_index')::int,
      nullif(q->>'explanation', ''),
      coalesce((q->>'difficulty')::int, 3),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  return v_id;
end;
$$;

revoke execute on function
  public.create_course_quiz_with_questions(text, jsonb, text, timestamptz, int, int)
  from public, anon;
grant execute on function
  public.create_course_quiz_with_questions(text, jsonb, text, timestamptz, int, int)
  to authenticated;

-- 2. A general course quiz must keep at least one question ------------------
--    Deferred: checked at COMMIT so replace_course_quiz (delete-all then
--    re-insert) is unaffected, and a course-quiz delete cascade is ignored
--    (parent row already gone). Module quizzes have their own equivalent
--    (assert_topic_has_questions) — this one is course_quiz_id only.
create or replace function public.assert_course_quiz_has_questions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.course_quiz_id is not null
     and exists (select 1 from public.course_quizzes where id = old.course_quiz_id)
     and not exists (select 1 from public.questions where course_quiz_id = old.course_quiz_id)
  then
    raise exception 'A general course quiz must keep at least one question.';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_course_quiz_has_questions on public.questions;
create constraint trigger trg_course_quiz_has_questions
  after delete on public.questions
  deferrable initially deferred
  for each row execute function public.assert_course_quiz_has_questions();

revoke execute on function public.assert_course_quiz_has_questions() from public, anon;
