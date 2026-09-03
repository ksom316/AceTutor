-- Clear Conversation (Quiz Me + Clear Conversation phase).
--
-- ADDITIVE — one new SECURITY DEFINER function. Standalone from
-- 20260914140000_ai_conversations.sql so it applies cleanly whether or not that
-- migration has already been run. Quiz Me itself needs NO schema (practice
-- quizzes are session-only and never persisted).
--
-- clear_course_conversations() deletes ALL of the caller's OWN AI tutor
-- conversations for ONE course; the ON DELETE CASCADE on ai_messages removes
-- their messages. Scoped by auth.uid() AND the given course id, so a student can
-- only ever clear their own history, and only for that one course — other
-- students' conversations and other courses' conversations are untouched.
-- Nothing outside ai_conversations / ai_messages is affected (no quizzes,
-- attempts, mastery, progress, preferences, enrolments or study paths).

create or replace function public.clear_course_conversations(_course_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;
  if _course_id is null then
    raise exception 'clear_course_conversations: course id required';
  end if;

  delete from public.ai_conversations
  where user_id = auth.uid()
    and course_id = _course_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.clear_course_conversations(uuid) is
  'Deletes the caller''s own AI tutor conversations (and, by cascade, their messages) for one course only. Scoped by auth.uid() and the given course id.';

revoke execute on function public.clear_course_conversations(uuid) from public, anon;
grant  execute on function public.clear_course_conversations(uuid) to authenticated;
