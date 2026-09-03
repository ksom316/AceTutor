-- Extends the module-quiz timer (20260904120000) to General Course Quizzes and
-- adds a "module quiz must keep at least one question" invariant.
--
-- Reuses the existing quiz_attempts / grade_quiz / questions architecture. NOT
-- changed: the General Course Quiz maximum-attempt cap (enforce_course_quiz_attempt
-- still counts quiz_attempts rows the same way), module quiz retry behaviour,
-- grading, incomplete-submission handling, RLS or lecturer course isolation.

-- 1. General Course Quiz time limit ------------------------------------------
alter table public.course_quizzes
  add column if not exists duration_minutes int not null default 30;
alter table public.course_quizzes drop constraint if exists course_quizzes_duration_ck;
alter table public.course_quizzes
  add constraint course_quizzes_duration_ck check (duration_minutes between 5 and 240);

-- 2. One expiry trigger for BOTH quiz kinds --------------------------------------
--    Replaces stamp_module_attempt_expiry. Module attempts use the topic's
--    duration, general attempts use the course quiz's duration. Attempts that
--    are neither (should not happen) pass straight through.
drop trigger if exists trg_stamp_module_attempt_expiry on public.quiz_attempts;
drop function if exists public.stamp_module_attempt_expiry();

create or replace function public.stamp_quiz_attempt_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes int;
begin
  if new.topic_id is not null then
    select quiz_duration_minutes into v_minutes
      from public.topics where id = new.topic_id;
  elsif new.course_quiz_id is not null then
    select duration_minutes into v_minutes
      from public.course_quizzes where id = new.course_quiz_id;
  else
    return new;
  end if;
  new.expires_at := coalesce(new.started_at, now())
    + make_interval(mins => coalesce(v_minutes, 30));
  return new;
end;
$$;

drop trigger if exists trg_stamp_quiz_attempt_expiry on public.quiz_attempts;
create trigger trg_stamp_quiz_attempt_expiry
  before insert on public.quiz_attempts
  for each row execute function public.stamp_quiz_attempt_expiry();

revoke execute on function public.stamp_quiz_attempt_expiry() from public, anon;

-- 3. Finalise expired attempts of EITHER kind ---------------------------------
--    Replaces finalize_expired_module_attempts. Same idea: grade the caller's
--    own timed-out attempts (module or general) that were never submitted, using
--    the authoritative grade_quiz path.
drop function if exists public.finalize_expired_module_attempts();

create or replace function public.finalize_expired_quiz_attempts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select a.id
    from public.quiz_attempts a
    where a.user_id = auth.uid()
      and (a.topic_id is not null or a.course_quiz_id is not null)
      and a.finished_at is null
      and a.expires_at is not null
      and now() >= a.expires_at
  loop
    perform public.grade_quiz(v_id, '{}'::jsonb, true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.finalize_expired_quiz_attempts() from public, anon;
grant execute on function public.finalize_expired_quiz_attempts() to authenticated;

-- 4. create_course_quiz / update_course_quiz — carry the duration --------------
drop function if exists public.create_course_quiz(text, text, timestamptz, int);

create function public.create_course_quiz(
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
    least(greatest(coalesce(_duration_minutes, 30), 5), 240)
  )
  returning id into v_id;

  return v_id;
end;
$$;

drop function if exists public.update_course_quiz(uuid, text, text, timestamptz, int);

create function public.update_course_quiz(
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
         duration_minutes = least(greatest(coalesce(_duration_minutes, 30), 5), 240)
   where id = _quiz_id and course_id = v_course;
end;
$$;

revoke execute on function public.create_course_quiz(text, text, timestamptz, int, int)
  from public, anon;
revoke execute on function public.update_course_quiz(uuid, text, text, timestamptz, int, int)
  from public, anon;
grant execute on function public.create_course_quiz(text, text, timestamptz, int, int)
  to authenticated;
grant execute on function public.update_course_quiz(uuid, text, text, timestamptz, int, int)
  to authenticated;

-- 5. list_course_quizzes — expose duration_minutes ----------------------------
drop function if exists public.list_course_quizzes(uuid);

create function public.list_course_quizzes(_course_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  deadline timestamptz,
  created_at timestamptz,
  question_count bigint,
  max_attempts int,
  duration_minutes int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cq.id,
    cq.title,
    cq.description,
    cq.deadline,
    cq.created_at,
    (select count(*) from public.questions q where q.course_quiz_id = cq.id),
    cq.max_attempts,
    cq.duration_minutes
  from public.course_quizzes cq
  where cq.course_id = _course_id
  order by cq.created_at;
$$;

revoke execute on function public.list_course_quizzes(uuid) from public, anon;
grant execute on function public.list_course_quizzes(uuid) to authenticated;

-- 6. get_course_quiz_performance — real `expired` for general attempts --------
--    (identical to 20260904120000 except the general branch's expired flag).
drop function if exists public.get_course_quiz_performance();

create function public.get_course_quiz_performance()
returns table (
  attempt_id uuid,
  student text,
  quiz_type text,
  quiz_title text,
  topic text,
  topic_id uuid,
  course_quiz_id uuid,
  score integer,
  total integer,
  pct integer,
  answered_count integer,
  started_at timestamptz,
  finished_at timestamptz,
  completed boolean,
  timed_out boolean,
  expired boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with lc as (select public.current_lecturer_course() as course_id)
  select
    a.id,
    p.full_name,
    'module'::text,
    t.title,
    t.title,
    t.id,
    null::uuid,
    a.score,
    a.total,
    case when a.total > 0 then round(a.score::numeric / a.total * 100)::integer else 0 end,
    a.answered_count,
    a.started_at,
    a.finished_at,
    a.finished_at is not null,
    a.timed_out,
    a.finished_at is null and a.expires_at is not null and now() >= a.expires_at
  from lc
  join public.topics t on t.course_id = lc.course_id
  join public.quiz_attempts a on a.topic_id = t.id
  join public.profiles p on p.id = a.user_id

  union all

  select
    a.id,
    p.full_name,
    'general'::text,
    cq.title,
    null::text,
    null::uuid,
    cq.id,
    a.score,
    a.total,
    case when a.total > 0 then round(a.score::numeric / a.total * 100)::integer else 0 end,
    a.answered_count,
    a.started_at,
    a.finished_at,
    a.finished_at is not null,
    a.timed_out,
    a.finished_at is null and a.expires_at is not null and now() >= a.expires_at
  from lc
  join public.course_quizzes cq on cq.course_id = lc.course_id
  join public.quiz_attempts a on a.course_quiz_id = cq.id
  join public.profiles p on p.id = a.user_id

  order by started_at desc;
$$;

revoke execute on function public.get_course_quiz_performance() from public, anon;
grant execute on function public.get_course_quiz_performance() to authenticated;

-- 7. A module quiz must always keep at least one question ----------------------
--    Deferred constraint trigger: it checks the invariant at COMMIT, so
--    replace_topic_quiz (delete-all then re-insert in one transaction) is not
--    affected, and a module-delete cascade (topic row gone) is ignored. General
--    Course Quiz questions are untouched — a general quiz may legitimately have
--    zero questions ("not published yet").
create or replace function public.assert_topic_has_questions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.topic_id is not null
     and exists (select 1 from public.topics where id = old.topic_id)
     and not exists (select 1 from public.questions where topic_id = old.topic_id)
  then
    raise exception 'A module quiz must have at least one question.';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_topic_has_questions on public.questions;
create constraint trigger trg_topic_has_questions
  after delete on public.questions
  deferrable initially deferred
  for each row execute function public.assert_topic_has_questions();

revoke execute on function public.assert_topic_has_questions() from public, anon;
