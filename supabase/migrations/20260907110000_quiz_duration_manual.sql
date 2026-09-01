-- Manual quiz time limit — allow any whole-minute duration from 1 to 240.
--
-- The lecturer picks the time limit with a numeric input instead of a fixed
-- drop-down. Previously both the CHECK constraints and the creation RPCs floored
-- the value at 5 minutes; this lowers that floor to 1. The 240-minute ceiling is
-- unchanged and the default is still 30.
--
-- APPLY ORDER: this migration must run AFTER 20260904120000_module_quiz_timer.sql
-- and 20260905120000_general_quiz_timer_and_min_questions.sql, which introduce
-- topics.quiz_duration_minutes / course_quizzes.duration_minutes and the RPC
-- signatures recreated below. Filename order already guarantees this.
--
-- Additive / non-destructive:
--   * only the two duration CHECK constraints are widened (drop-if-exists + re-add)
--   * create_module_with_quiz / create_course_quiz / update_course_quiz are
--     CREATE OR REPLACE'd with byte-identical bodies EXCEPT the clamp lower bound
--     (5 -> 1). Signatures are unchanged, so no DROP and no overload churn.
--   * server-side timer enforcement (stamp_quiz_attempt_expiry, expires_at,
--     finalize_expired_quiz_attempts), grading, RLS, lecturer authorization
--     (current_lecturer_course) and lecturer assignment are untouched.
--   * a student's already-running attempt is unaffected: expires_at is frozen at
--     attempt insert; changing a topic's / quiz's duration never rewrites it.

-- 1. Widen the duration CHECK constraints ------------------------------------
alter table public.topics drop constraint if exists topics_quiz_duration_ck;
alter table public.topics
  add constraint topics_quiz_duration_ck check (quiz_duration_minutes between 1 and 240);

alter table public.course_quizzes drop constraint if exists course_quizzes_duration_ck;
alter table public.course_quizzes
  add constraint course_quizzes_duration_ck check (duration_minutes between 1 and 240);

-- 2. create_module_with_quiz — clamp floor 5 -> 1 ---------------------------
--    Body identical to 20260904120000_module_quiz_timer.sql section 7 except the
--    v_duration clamp. Signature unchanged (no DROP).
create or replace function public.create_module_with_quiz(
  _title text,
  _summary text,
  _lessons jsonb,
  _questions jsonb,
  _duration_minutes int default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_topic_id uuid;
  v_slug text;
  v_order int;
  v_i int := 0;
  v_duration int;
  l jsonb;
  q jsonb;
  v_modality text;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can create a module.';
  end if;
  if coalesce(trim(_title), '') = '' then
    raise exception 'A module title is required.';
  end if;
  if char_length(trim(_title)) > 200 then
    raise exception 'The module title is too long.';
  end if;

  if _lessons is null or jsonb_typeof(_lessons) <> 'array'
     or jsonb_array_length(_lessons) < 1 then
    raise exception 'A module needs at least one course content before it can be created.';
  end if;
  if _questions is null or jsonb_typeof(_questions) <> 'array'
     or jsonb_array_length(_questions) < 1 then
    raise exception 'A quiz with at least one question is required before this module can be created.';
  end if;
  if jsonb_array_length(_questions) > 50 then
    raise exception 'A quiz can have at most 50 questions.';
  end if;

  v_duration := least(greatest(coalesce(_duration_minutes, 30), 1), 240);

  v_slug := trim(both '-' from regexp_replace(lower(trim(_title)), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    v_slug := 'module';
  end if;
  if exists (select 1 from public.topics where course_id = v_course and slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);
  end if;

  v_order := coalesce((select max(order_index) + 1 from public.topics where course_id = v_course), 0);

  insert into public.topics (course_id, slug, title, summary, order_index, quiz_duration_minutes)
  values (
    v_course,
    v_slug,
    trim(_title),
    nullif(trim(coalesce(_summary, '')), ''),
    v_order,
    v_duration
  )
  returning id into v_topic_id;

  v_i := 0;
  for l in select value from jsonb_array_elements(_lessons)
  loop
    v_modality := coalesce(nullif(l->>'modality', ''), 'text');
    if coalesce(trim(l->>'title'), '') = '' then
      raise exception 'Each course content needs a title.';
    end if;
    if v_modality = 'text' then
      if coalesce(trim(l->>'body_md'), '') = '' then
        raise exception 'A text lesson needs content.';
      end if;
    else
      if coalesce(trim(l->>'media_url'), '') = '' then
        raise exception 'A % lesson needs a file or link.', v_modality;
      end if;
    end if;

    insert into public.lessons (topic_id, modality, title, body_md, media_url, order_index)
    values (
      v_topic_id,
      v_modality::public.modality,
      trim(l->>'title'),
      nullif(trim(coalesce(l->>'body_md', '')), ''),
      nullif(trim(coalesce(l->>'media_url', '')), ''),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  v_i := 0;
  for q in select value from jsonb_array_elements(_questions)
  loop
    insert into public.questions
      (topic_id, prompt, choices, correct_index, explanation, difficulty, order_index)
    values (
      v_topic_id,
      q->>'prompt',
      q->'choices',
      (q->>'correct_index')::int,
      nullif(q->>'explanation', ''),
      coalesce((q->>'difficulty')::int, 3),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  return v_topic_id;
end;
$$;

revoke execute on function public.create_module_with_quiz(text, text, jsonb, jsonb, int)
  from public, anon;
grant execute on function public.create_module_with_quiz(text, text, jsonb, jsonb, int)
  to authenticated;

-- 3. create_course_quiz — clamp floor 5 -> 1 ------------------------------
--    Body identical to 20260905120000 section 4 except the clamp. Signature
--    unchanged (no DROP). A required _questions argument is NOT added here — that
--    is a separate additive RPC in 20260907120000.
create or replace function public.create_course_quiz(
  _title text,
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
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can create a general course quiz.';
  end if;
  if _max_attempts is not null and _max_attempts < 1 then
    raise exception 'Maximum attempts must be at least 1, or unlimited.';
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

  return v_id;
end;
$$;

revoke execute on function public.create_course_quiz(text, text, timestamptz, int, int)
  from public, anon;
grant execute on function public.create_course_quiz(text, text, timestamptz, int, int)
  to authenticated;

-- 4. update_course_quiz — clamp floor 5 -> 1 -----------------------------
--    Body identical to 20260905120000 section 4 except the clamp. Signature
--    unchanged (no DROP).
create or replace function public.update_course_quiz(
  _quiz_id uuid,
  _title text,
  _description text default null,
  _deadline timestamptz default null,
  _max_attempts int default null,
  _duration_minutes int default 30
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_title text;
begin
  v_course := public.current_lecturer_course();
  if v_course is null then
    raise exception 'Only a lecturer can edit a general course quiz.';
  end if;
  if not exists (
    select 1 from public.course_quizzes where id = _quiz_id and course_id = v_course
  ) then
    raise exception 'This general course quiz is not part of your course.';
  end if;
  if _max_attempts is not null and _max_attempts < 1 then
    raise exception 'Maximum attempts must be at least 1, or unlimited.';
  end if;

  v_title := nullif(btrim(coalesce(_title, '')), '');
  if v_title is null then
    v_title := 'General Course Quiz';
  end if;

  update public.course_quizzes
     set title = v_title,
         description = nullif(btrim(coalesce(_description, '')), ''),
         deadline = _deadline,
         max_attempts = _max_attempts,
         duration_minutes = least(greatest(coalesce(_duration_minutes, 30), 1), 240)
   where id = _quiz_id and course_id = v_course;
end;
$$;

revoke execute on function public.update_course_quiz(uuid, text, text, timestamptz, int, int)
  from public, anon;
grant execute on function public.update_course_quiz(uuid, text, text, timestamptz, int, int)
  to authenticated;
