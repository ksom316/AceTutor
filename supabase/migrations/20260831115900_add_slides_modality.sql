-- Phase 7 enhancement: add a `slides` value to the lesson modality enum so a
-- lesson can carry an uploaded PDF of slides. `text` / `video` / `audio` are
-- untouched. Kept in its own migration because a new enum value must be
-- committed before it can be referenced (by the app, on insert).
alter type public.modality add value if not exists 'slides';
