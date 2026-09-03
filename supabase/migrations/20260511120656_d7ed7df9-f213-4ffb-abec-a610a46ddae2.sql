
-- Enums
create type public.app_role as enum ('student', 'admin');
create type public.vark_style as enum ('visual', 'aural', 'read_write', 'kinesthetic');
create type public.modality as enum ('text', 'video', 'audio');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  vark_primary public.vark_style,
  vark_scores jsonb,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- User roles (separate table to avoid privilege-escalation)
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create policy "user_roles_select_own" on public.user_roles for select to authenticated using (auth.uid() = user_id);

-- Trigger to create profile + student role on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  insert into public.user_roles (user_id, role) values (new.id, 'student');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Courses
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  summary text,
  cover_url text,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.courses enable row level security;
create policy "courses_public_read" on public.courses for select to anon, authenticated using (true);

-- Topics
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  slug text not null,
  title text not null,
  summary text,
  order_index int not null default 0,
  unique (course_id, slug)
);
alter table public.topics enable row level security;
create policy "topics_public_read" on public.topics for select to anon, authenticated using (true);

-- Lessons
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  modality public.modality not null,
  title text not null,
  body_md text,
  media_url text,
  duration_sec int,
  order_index int not null default 0
);
alter table public.lessons enable row level security;
create policy "lessons_public_read" on public.lessons for select to anon, authenticated using (true);

-- Questions (sensitive: correct_index is NOT exposed to anon/auth via select policy)
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  prompt text not null,
  choices jsonb not null,
  correct_index int not null,
  explanation text,
  difficulty int not null default 2 check (difficulty between 1 and 5)
);
alter table public.questions enable row level security;
-- NOTE: no public select policy; clients fetch sanitized questions through a SECURITY DEFINER function.

-- Public-safe view of questions (no answer key)
create or replace function public.get_quiz_questions(_topic_id uuid, _limit int default 5)
returns table (id uuid, prompt text, choices jsonb, difficulty int)
language sql stable security definer set search_path = public
as $$
  select id, prompt, choices, difficulty
  from public.questions
  where topic_id = _topic_id
  order by random()
  limit greatest(coalesce(_limit, 5), 1);
$$;

-- Quiz attempts
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  score int not null default 0,
  total int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.quiz_attempts enable row level security;
create policy "attempts_select_own" on public.quiz_attempts for select to authenticated using (auth.uid() = user_id);
create policy "attempts_insert_own" on public.quiz_attempts for insert to authenticated with check (auth.uid() = user_id);
create policy "attempts_update_own" on public.quiz_attempts for update to authenticated using (auth.uid() = user_id);

-- Attempt answers
create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_index int not null,
  is_correct boolean not null,
  time_ms int
);
alter table public.attempt_answers enable row level security;
create policy "answers_select_own" on public.attempt_answers for select to authenticated
  using (exists (select 1 from public.quiz_attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy "answers_insert_own" on public.attempt_answers for insert to authenticated
  with check (exists (select 1 from public.quiz_attempts a where a.id = attempt_id and a.user_id = auth.uid()));

-- Progress
create table public.progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  watched_seconds int not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);
alter table public.progress enable row level security;
create policy "progress_select_own" on public.progress for select to authenticated using (auth.uid() = user_id);
create policy "progress_insert_own" on public.progress for insert to authenticated with check (auth.uid() = user_id);
create policy "progress_update_own" on public.progress for update to authenticated using (auth.uid() = user_id);

-- VARK responses
create table public.vark_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null,
  computed_style public.vark_style not null,
  created_at timestamptz not null default now()
);
alter table public.vark_responses enable row level security;
create policy "vark_select_own" on public.vark_responses for select to authenticated using (auth.uid() = user_id);
create policy "vark_insert_own" on public.vark_responses for insert to authenticated with check (auth.uid() = user_id);

-- Grading function: server-side scoring; returns per-question correctness
create or replace function public.grade_quiz(_attempt_id uuid, _answers jsonb)
returns table (question_id uuid, is_correct boolean, correct_index int, explanation text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_total int := 0;
  v_score int := 0;
  rec record;
  v_sel int;
begin
  select user_id into v_user from public.quiz_attempts where id = _attempt_id;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'forbidden';
  end if;

  for rec in
    select q.id, q.correct_index, q.explanation
    from public.questions q
    where q.id::text in (select jsonb_object_keys(_answers))
  loop
    v_sel := (_answers ->> rec.id::text)::int;
    v_total := v_total + 1;
    if v_sel = rec.correct_index then
      v_score := v_score + 1;
      insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
      values (_attempt_id, rec.id, v_sel, true);
    else
      insert into public.attempt_answers (attempt_id, question_id, selected_index, is_correct)
      values (_attempt_id, rec.id, v_sel, false);
    end if;

    question_id := rec.id;
    is_correct := (v_sel = rec.correct_index);
    correct_index := rec.correct_index;
    explanation := rec.explanation;
    return next;
  end loop;

  update public.quiz_attempts
    set score = v_score, total = v_total, finished_at = now()
    where id = _attempt_id;
end;
$$;
