/** Shared lesson-form types + validation. Pure — no React, no server imports.
 *  Used by LessonFormDialog and both of its callers (materials page, create-
 *  module flow). */

export type LessonModality = "text" | "video" | "audio" | "slides";
export type LessonSource = "upload" | "url";
export const LESSON_TITLE_MAX = 200;

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
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
  return looksLikeUrl(v.url);
}
