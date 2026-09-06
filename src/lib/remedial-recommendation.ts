/**
 * R8.2 — Connect Personal Remedial Evidence to the Study Path remedial
 * format recommendation.
 *
 * A PURE resolver that adds ONE new signal on top of the existing chain: the
 * student's OWN remedial-success history (R8.1 `deriveRemedialFormatRecommen
 * dation`). It does NOT rewrite the existing resolver — it delegates
 * priorities 2–5 to `resolveRecommendedRemedialModality` unchanged and only
 * decides whether the personal-history signal is strong enough to sit in
 * front of it.
 *
 * Final priority:
 *   1. Personal remedial success history (R8)      — medium / high confidence ONLY
 *   2. A7 adaptive recommendation                  ┐
 *   3. VARK recommendation                         │ delegated verbatim to
 *   4. Learning Preferences (lesson_format)        │ resolveRecommendedRemedialModality
 *   5. Default fallback ("text")                   ┘
 *
 * LOW (or none) personal-history confidence NEVER overrides — the existing
 * behaviour is preserved byte-for-byte in that case.
 *
 * NOT touched here (and never from this file): adaptive-modality.ts /
 * .functions.ts, the VARK model, Learning Preferences storage, Mastery, quiz
 * grading, the Study Path schema, R4/R5/R6 tracking, and R8.1's logic. This
 * layer only composes their outputs.
 *
 * No React. No Supabase. No API calls. No writes. Deterministic.
 */

import type { LessonModality } from "@/lib/lesson-shared";
import {
  resolveRecommendedRemedialModality,
  type RemedialModality,
  type RemedialModalitySource,
} from "@/lib/remedial-modality";
import type {
  RemedialAdaptationConfidence,
  RemedialAdaptationRecommendation,
} from "@/lib/remedial-adaptation";

/** The existing four sources, plus the R8 personal-history source. */
export type RemedialRecommendationSource = RemedialModalitySource | "history";

/** Personal-history confidences allowed to override the existing chain.
 *  `"low"` and `"none"` are deliberately excluded. */
export const REMEDIAL_HISTORY_OVERRIDE_CONFIDENCES: readonly RemedialAdaptationConfidence[] = [
  "medium",
  "high",
];

export type RemedialRecommendation = {
  modality: RemedialModality;
  source: RemedialRecommendationSource;
  personalHistory: {
    /** a usable R8 signal was present: a concrete `preferredFormat` at
     *  medium / high confidence. */
    considered: boolean;
    /** that signal actually drove `modality` and `source`. */
    applied: boolean;
    confidence: RemedialAdaptationConfidence | null;
    /** R8.1's own association-worded sentence, surfaced for UI copy. null when
     *  no adaptation input was supplied. */
    reason: string | null;
    /** the source the recommendation WOULD have carried without R8 — set only
     *  when `applied`, for transparency / later analytics. */
    replacedSource: RemedialModalitySource | null;
  };
};

const OVERRIDE = new Set<RemedialAdaptationConfidence>(REMEDIAL_HISTORY_OVERRIDE_CONFIDENCES);

const isRemedialModality = (v: string | null | undefined): v is RemedialModality =>
  v === "text" || v === "audio" || v === "visual";

/**
 * @param input.remedialAdaptation      R8.1 output for this student (already
 *        scoped), or null when R8 was not run.
 * @param input.adaptiveRecommendation  A7 result: `{ modality, source }` or
 *        null (course-level path / A7 unavailable) — passed straight through.
 * @param input.varkRecommendation      the VARK content modality, or null.
 * @param input.preferredModality       `learning_preferences.lesson_format`
 *        ("written" | "visual" | "audio"), or null.
 * @param input.availableModalities     remedial formats that can actually be
 *        presented. When provided and non-empty, an R8 `preferredFormat`
 *        outside it will NOT override. Omit / empty = all three allowed.
 */
export function resolveRemedialRecommendation(input: {
  remedialAdaptation: RemedialAdaptationRecommendation | null;
  adaptiveRecommendation: { modality: LessonModality | null; source: "vark" | "adaptive" } | null;
  varkRecommendation: LessonModality | null;
  preferredModality: string | null;
  availableModalities?: readonly RemedialModality[];
}): RemedialRecommendation {
  // Priorities 2–5 — the EXISTING resolver, unchanged.
  const baseline = resolveRecommendedRemedialModality({
    adaptive: input.adaptiveRecommendation,
    varkModality: input.varkRecommendation,
    lessonFormatPreference: input.preferredModality,
  });

  const adaptation = input.remedialAdaptation;
  const raw = adaptation?.preferredFormat ?? null;
  const preferred: RemedialModality | null = isRemedialModality(raw) ? raw : null;
  const confident = adaptation != null && OVERRIDE.has(adaptation.confidence);

  const avail = input.availableModalities ?? [];
  const isAvailable = avail.length === 0 || (preferred != null && avail.includes(preferred));

  const considered = confident && preferred != null;
  const applied = considered && isAvailable;

  if (applied && preferred != null && adaptation != null) {
    return {
      modality: preferred,
      source: "history",
      personalHistory: {
        considered: true,
        applied: true,
        confidence: adaptation.confidence,
        reason: adaptation.reason,
        replacedSource: baseline.source,
      },
    };
  }

  return {
    modality: baseline.modality,
    source: baseline.source,
    personalHistory: {
      considered,
      applied: false,
      confidence: adaptation?.confidence ?? null,
      reason: adaptation?.reason ?? null,
      replacedSource: null,
    },
  };
}
