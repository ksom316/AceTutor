/**
 * P1.1 — student-facing copy for WHY a remedial format is recommended.
 *
 * Pure presentation only. It reads the recommendation SOURCE that R8.2's
 * `resolveRemedialRecommendation` already resolved (history / adaptive / vark /
 * preference / default) and returns one short, OBSERVATIONAL sentence.
 *
 * Rules:
 *   - never claim a format is "proven" / "better" / "will improve your score";
 *   - never expose internal algorithm names (A7, VARK model, R8, …) — only the
 *     student-facing concepts (learning preferences, recent activity, …);
 *   - the student can always still switch formats, so the wording is a
 *     suggestion, not an instruction.
 *
 * No React, no Supabase, no writes.
 */

import { REMEDIAL_MODALITY_LABEL, type RemedialModality } from "@/lib/remedial-modality";
import type { RemedialRecommendationSource } from "@/lib/remedial-recommendation";

export type RemedialRecommendationExplanation = {
  /** the short chip shown next to the recommended format. */
  badge: string;
  /** one observational sentence explaining the recommendation. */
  detail: string;
};

/**
 * @param source  the resolved recommendation source (R8.2).
 * @param format  the recommended remedial format — only referenced in the
 *                history wording, and always as "you used it", never "it works".
 */
export function remedialRecommendationExplanation(
  source: RemedialRecommendationSource,
  format: RemedialModality,
): RemedialRecommendationExplanation {
  const label = REMEDIAL_MODALITY_LABEL[format];
  const badge = "Recommended for you";

  switch (source) {
    case "history":
      return {
        badge,
        detail:
          `Recommended because your previous remedial sessions showed positive observed outcomes ` +
          `with ${label} explanations. You can still choose any format below.`,
      };
    case "adaptive":
      return {
        badge,
        detail: "Recommended based on your recent learning activity in this course.",
      };
    case "vark":
      return {
        badge,
        detail: "Recommended based on your learning preferences.",
      };
    case "preference":
      return {
        badge,
        detail: "Recommended based on your selected learning format.",
      };
    case "default":
    default:
      return {
        badge: "Default format",
        detail: "Showing the default learning format. Pick whichever format works best for you.",
      };
  }
}

/** Every source this copy handles — for exhaustiveness tests. */
export const REMEDIAL_RECOMMENDATION_SOURCES: readonly RemedialRecommendationSource[] = [
  "history",
  "adaptive",
  "vark",
  "preference",
  "default",
];
