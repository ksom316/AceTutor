-- P2.2B — Essential Remaining Security Hardening (SEC-04 + SEC-05).
--
-- Applies AFTER 20260916120000_quiz_integrity_hardening.sql. Smallest safe
-- changes; NOTHING here rewrites or deletes historical data.
--
--   SEC-04  lessons.media_url was lecturer-controlled and rendered straight
--           into an <iframe src> with no server-side validation and a wide
--           `allow=` list. A malicious/compromised lecturer (or a direct
--           PostgREST write) could persist an arbitrary or non-https URL and
--           embed any site — or, bypassing the client form, a `javascript:`
--           URL (stored XSS in the learning page). Now: a CHECK constraint at
--           the DB (every write path — client insert AND create_module_with_quiz)
--           restricts media_url to https Supabase-Storage objects, direct media
--           files, or YouTube/Vimeo embeds. Iframe rendering is sandboxed and
--           the `allow=` list trimmed (client change).
--
--   SEC-05  public.progress had `progress_insert_own` / `progress_update_own` /
--           `progress_delete_own` (only `auth.uid() = user_id`), so a student
--           could `insert`/`update` a row with `completed_at` set and forge
--           lesson completion. The ONLY legitimate writer is grade_quiz()
--           (SECURITY DEFINER — marks the module's first lesson complete on a
--           finished module quiz); there is no standalone "mark lesson
--           complete" button. So: all client writes are blocked; SELECT stays.
--
-- MANUAL: apply in the Supabase SQL Editor. One validator function + one
-- (NOT VALID) CHECK constraint + three policy drops + two REVOKEs.

-- ============================================================================
-- SEC-04 — lessons.media_url allowlist
-- ============================================================================

-- The ONLY shapes AceTutor renders today:
--   1. a Supabase Storage public object   -> <video>/<audio> or PDF <iframe>
--      (uploaded lesson media — see course-material-storage.ts)
--   2. a direct media file by extension    -> <video>/<audio>
--   3. a YouTube or Vimeo embed URL        -> sandboxed <iframe>
-- Anything else (other iframe hosts, non-https, javascript:/data:/file:) is
-- rejected. IMMUTABLE + no table access, so it is safe in a CHECK constraint.
create or replace function public.is_allowed_lesson_media_url(_url text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    _url is null
    or _url = ''
    -- 1. Supabase Storage public object (host must be *.supabase.co)
    or _url ~* '^https://[a-z0-9][a-z0-9.-]*\.supabase\.co/storage/v1/object/public/[^\s]+$'
    -- 2. direct media file
    or _url ~* '^https://[^\s?#]+\.(mp4|webm|ogv|ogg|mov|m4v|m4a|mp3|wav|aac)([?#][^\s]*)?$'
    -- 3. YouTube / Vimeo embed
    or _url ~* '^https://(www\.)?youtube(-nocookie)?\.com/embed/[a-z0-9_\-]{6,}([?&][^\s]*)?$'
    or _url ~* '^https://player\.vimeo\.com/video/[0-9]+([?&/][^\s]*)?$'
    or _url ~* '^https://(www\.)?vimeo\.com/[0-9]+([?&/][^\s]*)?$';
$$;

grant execute on function public.is_allowed_lesson_media_url(text) to public;

-- NOT VALID: new/updated rows are checked, but the historical table is NOT
-- re-scanned (an existing stored URL that violates the rule is left in place —
-- see the P2.2B report; run `alter table public.lessons validate constraint
-- lessons_media_url_allowed;` after any cleanup).
alter table public.lessons
  drop constraint if exists lessons_media_url_allowed;
alter table public.lessons
  add constraint lessons_media_url_allowed
  check (public.is_allowed_lesson_media_url(media_url)) not valid;

-- ============================================================================
-- SEC-05 — public.progress: completion is written only by grade_quiz()
-- ============================================================================

drop policy if exists "progress_insert_own" on public.progress;
drop policy if exists "progress_update_own" on public.progress;
drop policy if exists "progress_delete_own" on public.progress;
revoke insert, update, delete on public.progress from anon, authenticated;
-- progress_select_own stays: the dashboard / analytics / My Courses read it.
-- grade_quiz() (SECURITY DEFINER) still upserts completed_at; the account
-- reset RPC (reset_my_learning_data) still deletes the caller's rows. Both run
-- as owner and are unaffected by the REVOKE.
