/**
 * R1 — pure resolution of the RECOMMENDED remedial presentation format.
 *
 * This only decides which format to *recommend* for a personalized remedial
 * explanation. It NEVER mutates the VARK classification, Learning Preferences,
 * A7 state/reward, or Mastery, and it never restricts the student to one
 * format — the UI always offers text / audio / visual.
 *
 * Priority (first match wins):
 *   1. a genuine A7 adaptive OVERRIDE  (source === "adaptive")
 *   2. the A4 / VARK content recommendation
 *   3. an explicit Learning Preference — `learning_preferences.lesson_format`
 *      is the ONLY modality-bearing preference (`explanation_style` /
 *      `wrong_answer_help` tune the text, not the format), so there is no
 *      ambiguity to break.
 *   4. text fallback
 *
 * Pure — no React, no Supabase.
 */

import type { LessonModality } from "@/lib/lesson-shared";

export type RemedialModality = "text" | "audio" | "visual";

export type RemedialModalitySource = "adaptive" | "vark" | "preference" | "default";

export type RemedialModalityResolution = {
  modality: RemedialModality;
  source: RemedialModalitySource;
};

export const REMEDIAL_MODALITIES: readonly RemedialModality[] = [
  "text",
  "audio",
  "visual",
] as const;

/** A7 / A4 lesson modality → remedial presentation format.
 *  text→text · audio→audio · video→visual · slides→visual */
export function lessonModalityToRemedial(m: LessonModality): RemedialModality {
  switch (m) {
    case "audio":
      return "audio";
    case "video":
    case "slides":
      return "visual";
    case "text":
    default:
      return "text";
  }
}

/** `learning_preferences.lesson_format` → remedial presentation format.
 *  written→text · visual→visual · audio→audio · anything else → null */
export function lessonFormatToRemedial(format: string | null | undefined): RemedialModality | null {
  switch (format) {
    case "audio":
      return "audio";
    case "visual":
      return "visual";
    case "written":
      return "text";
    default:
      return null;
  }
}

export function resolveRecommendedRemedialModality(input: {
  /** The A7 adaptive recommendation for this topic — its modality and whether
   *  it was a genuine override. Pass null when A7 has no result (e.g. a
   *  course-level Study Path with no single topic). */
  adaptive: { modality: LessonModality | null; source: "vark" | "adaptive" } | null;
  /** The A4 / VARK content modality for this topic, or null. */
  varkModality: LessonModality | null;
  /** `learning_preferences.lesson_format` ("written" | "visual" | "audio"), or null. */
  lessonFormatPreference: string | null;
}): RemedialModalityResolution {
  if (input.adaptive?.source === "adaptive" && input.adaptive.modality) {
    return { modality: lessonModalityToRemedial(input.adaptive.modality), source: "adaptive" };
  }
  if (input.varkModality) {
    return { modality: lessonModalityToRemedial(input.varkModality), source: "vark" };
  }
  const pref = lessonFormatToRemedial(input.lessonFormatPreference);
  if (pref) {
    return { modality: pref, source: "preference" };
  }
  return { modality: "text", source: "default" };
}

/** Human label for the UI. */
export const REMEDIAL_MODALITY_LABEL: Record<RemedialModality, string> = {
  text: "Text",
  audio: "Audio",
  visual: "Visual",
};

/** R1 ships a text renderer only. Audio/Visual are recommended but not yet
 *  produced — the UI shows an honest "coming next" note and the text version. */
export const REMEDIAL_MODALITY_IMPLEMENTED: Record<RemedialModality, boolean> = {
  text: true,
  audio: false,
  visual: false,
};
