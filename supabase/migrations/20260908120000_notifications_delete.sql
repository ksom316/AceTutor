-- Notification deletion — students and lecturers can delete their own
-- notifications (individually or all at once).
--
-- public.notifications has had SELECT and UPDATE "own row" policies since
-- 20260822120000_teacher_publishing_notifications.sql (re-affirmed in
-- 20260906120000_notifications_enhancement.sql):
--   notifications_select_own — for select using (auth.uid() = user_id)
--   notifications_update_own — for update using (auth.uid() = user_id)
-- There has never been a DELETE policy, so a client-side delete has always
-- been rejected by RLS. This migration adds exactly that — nothing else.
--
-- Additive / non-destructive:
--   * one new policy, same "own row" shape and naming convention as the
--     existing select/update policies
--   * does not touch notifications_select_own, notifications_update_own, the
--     (still absent) INSERT policy, or any of the SECURITY DEFINER
--     notification-generating triggers (notify_new_lesson, notify_new_module,
--     notify_new_general_quiz, notify_lesson_updated, notify_module_updated,
--     notify_quiz_updated, notify_new_enrollment, notify_quiz_completed)
--   * covers both audiences uniformly: a lecturer's own notification rows and
--     a student's own notification rows both carry user_id = the recipient,
--     so this single "own row" predicate is already exactly right for both —
--     a student can never delete a lecturer's row (or another student's) and
--     a lecturer can never delete another lecturer's row, because none of
--     those rows ever have user_id = auth.uid() for the caller.

create policy "notifications_delete_own" on public.notifications
  for delete to authenticated using (auth.uid() = user_id);
