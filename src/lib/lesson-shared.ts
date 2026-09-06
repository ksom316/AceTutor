/** Shared lesson-form types + validation. Pure — no React, no server imports.
 *  Used by LessonFormDialog and both of its callers (materials page, create-
 *  module flow). */

export type LessonModality = "text" | "video" | "audio" | "slides";
export type LessonSource = "upload" | "url";
export const LESSON_TITLE_MAX = 200;

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** Mirror of the DB `is_allowed_lesson_media_url()` CHECK constraint
 *  (migration 20260917120000). The only lesson media shapes AceTutor renders:
 *  a Supabase Storage public object, a direct media file, or a YouTube/Vimeo
 *  embed. Anything else — other iframe hosts, non-https, `javascript:`,
 *  `data:`, `file:` — is rejected. Keep the two in sync. */
const LESSON_MEDIA_URL_PATTERNS: RegExp[] = [
  /^https:\/\/[a-z0-9][a-z0-9.-]*\.supabase\.co\/storage\/v1\/object\/public\/\S+$/i,
  /^https:\/\/[^\s?#]+\.(mp4|webm|ogv|ogg|mov|m4v|m4a|mp3|wav|aac)([?#]\S*)?$/i,
  /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\/[a-z0-9_-]{6,}([?&]\S*)?$/i,
  /^https:\/\/player\.vimeo\.com\/video\/[0-9]+([?&/]\S*)?$/i,
  /^https:\/\/(www\.)?vimeo\.com\/[0-9]+([?&/]\S*)?$/i,
];

export function isAllowedLessonMediaUrl(url: string | null | undefined): boolean {
  if (url == null || url === "") return true;
  const v = url.trim();
  return LESSON_MEDIA_URL_PATTERNS.some((re) => re.test(v));
}

/** Subset of a `lessons` row the form needs when editing. */
export type LessonRecord = {
  id: string;
  title: string;
  modality: string;
  body_md: string | null;
  media_url: string | null;
};

export type LessonFormValue = {
  title: string;
  modality: LessonModality;
  source: LessonSource;
  body: string;
  url: string;
  /** A newly-picked file, OR the still-pending file carried over from a draft. */
  file: File | null;
};

export type LessonFormTarget = {
  lesson: LessonRecord | null;
  /** A file already chosen for this draft but not uploaded yet (create-module flow). */
  pendingFile?: File | null;
};

/** True when the form value is a complete, saveable lesson. */
export function isLessonValueComplete(v: LessonFormValue): boolean {
  if (!v.title.trim() || v.title.length > LESSON_TITLE_MAX) return false;
  if (v.modality === "text") return v.body.trim().length > 0;
  if (v.modality === "slides") return !!v.file;
  if (v.source === "upload") return !!v.file;
  return looksLikeUrl(v.url) && isAllowedLessonMediaUrl(v.url);
}
