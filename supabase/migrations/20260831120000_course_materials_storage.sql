-- Phase 7 enhancement: lecturer-uploaded course material files.
--
-- Lecturers may upload a video, an audio file, or a PDF of slides for a lesson
-- (they can still paste a video/audio URL instead). Uploaded files live in one
-- public-read Storage bucket. Reads are public to match the rest of the course
-- content -- courses / topics / lessons are all `*_public_read` and existing
-- audio lessons already point at public Storage object URLs. Writes are locked
-- to the lecturer whose assigned course matches the first path segment:
--
--     course-materials/{course_id}/{topic_id}/{uuid}.{ext}

-- 1. Storage bucket. 50 MB per-object cap; MIME allow-list is limited to common
--    video / audio containers and PDF. No DOCX / PPTX / Office formats.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-materials',
  'course-materials',
  true,
  52428800,
  array[
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg',
    'audio/aac', 'audio/mp4', 'audio/x-m4a',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage RLS on storage.objects for this bucket.
--
--    public.current_lecturer_course() is SECURITY DEFINER and resolves to
--    lecturer_slots.course_id WHERE claimed_by = auth.uid(). It cannot be
--    influenced by anything the browser sends. A student (no claimed slot)
--    gets NULL, which never equals a path segment, so students cannot write.
--
--    The path's first folder is the course id, so a lecturer can only create /
--    replace / delete objects under their own assigned course.

create policy "course_materials_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'course-materials');

create policy "course_materials_lecturer_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = public.current_lecturer_course()::text
  );

create policy "course_materials_lecturer_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = public.current_lecturer_course()::text
  )
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = public.current_lecturer_course()::text
  );

create policy "course_materials_lecturer_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = public.current_lecturer_course()::text
  );
