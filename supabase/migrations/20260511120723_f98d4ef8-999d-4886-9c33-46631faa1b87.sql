
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.get_quiz_questions(uuid, int) from public, anon;
revoke execute on function public.grade_quiz(uuid, jsonb) from public, anon;
grant execute on function public.get_quiz_questions(uuid, int) to authenticated;
grant execute on function public.grade_quiz(uuid, jsonb) to authenticated;
