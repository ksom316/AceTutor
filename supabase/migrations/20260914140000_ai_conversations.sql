-- Guide Me Phase G1 — persistent, course-aware AI tutor conversations.
--
-- ADDITIVE. Two new tables, their RLS, and indexes. Nothing existing is touched.
-- The AI chat was fully stateless (one system + one user prompt per call, no
-- history, no persistence). These tables give it a durable transcript so a
-- student can hold a continuous conversation, switch modes without losing it,
-- and reload the page and carry on. The Socratic "Guide Me" mode is just another
-- value of ai_messages.mode within the same conversation.
--
-- Ownership is enforced by RLS on user_id (conversations). ai_messages is the
-- AI's conversation memory, so the browser gets SELECT only — it has NO insert,
-- update or delete on it, and cannot forge transcript rows. The one writer is
-- the SECURITY DEFINER RPC append_ai_turn(), called by the trusted server-side
-- askCourse flow after a successful model reply; it re-checks the caller owns the
-- conversation and writes the user + assistant messages as one pair.

create table if not exists public.ai_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  course_id       uuid not null references public.courses(id) on delete cascade,
  -- Soft association only: a conversation may span modules; each message still
  -- carries the module it was grounded in.
  topic_id        uuid references public.topics(id) on delete set null,
  title           text,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_course_idx
  on public.ai_conversations (user_id, course_id, last_message_at desc);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  -- Which quick action / tutor mode produced this message. 'guide' = Socratic.
  mode            text not null default 'ask'
                  check (mode in ('general', 'ask', 'explain', 'summarize', 'test', 'guide', 'recommend')),
  created_at      timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx
  on public.ai_messages (conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;

-- conversations: a student owns and manages their own
create policy "ai_conversations_select_own" on public.ai_conversations
  for select to authenticated using (user_id = auth.uid());
create policy "ai_conversations_insert_own" on public.ai_conversations
  for insert to authenticated with check (user_id = auth.uid());
create policy "ai_conversations_update_own" on public.ai_conversations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ai_conversations_delete_own" on public.ai_conversations
  for delete to authenticated using (user_id = auth.uid());

-- messages: the browser may READ its own conversation's transcript and nothing
-- more. There is deliberately NO insert / update / delete policy, and the table
-- privileges below remove those grants too, so a client cannot inject or alter
-- AI history. Writes go through append_ai_turn() only.
create policy "ai_messages_select_own" on public.ai_messages
  for select to authenticated
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));

revoke insert, update, delete on public.ai_messages from anon, authenticated;

-- The single, narrow writer for the transcript. SECURITY DEFINER so it can
-- insert despite the client having no write grant; it re-verifies the caller
-- owns the conversation, so it cannot be used to write into anyone else's.
-- It accepts only the four fields a turn needs and always writes exactly one
-- user row + one assistant row.
create or replace function public.append_ai_turn(
  _conversation_id   uuid,
  _user_content      text,
  _assistant_content text,
  _mode              text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_mode  text := coalesce(nullif(trim(_mode), ''), 'ask');
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;
  if _conversation_id is null
     or coalesce(trim(_user_content), '') = ''
     or coalesce(trim(_assistant_content), '') = '' then
    raise exception 'append_ai_turn: missing required content';
  end if;
  if v_mode not in ('general', 'ask', 'explain', 'summarize', 'test', 'guide', 'recommend') then
    raise exception 'append_ai_turn: invalid mode %', v_mode;
  end if;

  select user_id into v_owner
  from public.ai_conversations
  where id = _conversation_id
  for update;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'forbidden';
  end if;

  insert into public.ai_messages (conversation_id, role, content, mode) values
    (_conversation_id, 'user',      _user_content,      v_mode),
    (_conversation_id, 'assistant', _assistant_content, v_mode);

  update public.ai_conversations
     set last_message_at = now(),
         title = coalesce(title, left(_user_content, 80))
   where id = _conversation_id;
end;
$$;

comment on function public.append_ai_turn(uuid, text, text, text) is
  'Appends one user + one assistant message to the caller''s OWN AI conversation and bumps last_message_at. The only write path for public.ai_messages. Re-checks ownership via auth.uid(); rejects anyone else''s conversation.';

revoke execute on function public.append_ai_turn(uuid, text, text, text) from public, anon;
grant  execute on function public.append_ai_turn(uuid, text, text, text) to authenticated;
