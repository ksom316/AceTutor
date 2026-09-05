/**
 * Phase A4 — maps a student's VARK profile to an EXISTING lesson modality, so
 * the topic page can prioritize (never hide) matching material. Pure — no
 * React, no Supabase, no AI. Deliberately three small, deterministic
 * functions rather than one combined one, so each step (resolve effective
 * category / map to modality / determine a match) is independently testable
 * — see vark-content-recommendation.test.ts.
 *
 * This never calls the ML inference service and never fabricates a
 * prediction — it only reads the already-persisted vark_profiles columns
 * (ml_predicted_category / predicted_category) that Phase A3 wrote.
 */

import type { VarkCategory, VarkProfileRow } from "@/lib/vark";
import type { LessonModality } from "@/lib/lesson-shared";

/**
 * Each category maps to an ORDERED list of acceptable modalities — the first
 * one the current topic actually has content for wins; the rest are never
 * simultaneously recommended. `visual` prefers `video` first and only falls
 * back to `slides` (also legitimate visual content) when the topic has no
 * video lessons at all. Every other category has exactly one modality, so
 * this list shape doesn't change their existing behaviour.
 *
 * `kinesthetic` is DELIBERATELY OMITTED: AceTutor's lesson modality enum
 * (text/video/audio/slides — see src/lib/lesson-shared.ts) has no
 * practice/interactive value, and mapping kinesthetic onto one of the other
 * four would misrepresent that content as something it isn't. A kinesthetic
 * student simply gets no content recommendation on this surface — see the
 * phase report for why an existing surface (e.g. Quiz Me) was deliberately
 * not repurposed for this.
 */
export const VARK_TO_CONTENT_MODALITY: Partial<Record<VarkCategory, readonly LessonModality[]>> = {
  visual: ["video", "slides"],
  auditory: ["audio"],
  read_write: ["text"],
};

/**
 * Priority: the real ML model's prediction (Phase A3) first, the
 * questionnaire-derived tendency (Phase A1) as fallback, otherwise no
 * category at all. Never invents a value — a profile with both fields null
 * (or no profile/no assessment taken) returns null, meaning "no VARK
 * prioritization," exactly as the phase spec requires.
 */
export function resolveEffectiveVarkCategory(
  profile: Pick<VarkProfileRow, "ml_predicted_category" | "predicted_category"> | null,
): VarkCategory | null {
  if (!profile) return null;
  return profile.ml_predicted_category ?? profile.predicted_category ?? null;
}

export type VarkContentRecommendation = { modality: LessonModality; category: VarkCategory };

/**
 * Resolves to a real recommendation only when ALL of: a category is known,
 * that category maps to at least one candidate modality (kinesthetic never
 * does), AND this topic actually has at least one lesson in one of those
 * candidates (`availableModalities` — the topic's OWN modality list, never
 * assumed). Candidates are tried IN ORDER and the first available one wins —
 * exactly one modality is ever returned, never more than one (e.g. visual
 * never recommends both video and slides at once: video wins whenever it's
 * available, slides only when it's the sole visual option present).
 * Otherwise null, which callers must render as "no recommendation" rather
 * than guessing or defaulting to some other modality.
 */
export function resolveVarkContentRecommendation(
  category: VarkCategory | null,
  availableModalities: readonly LessonModality[],
): VarkContentRecommendation | null {
  if (!category) return null;
  const candidates = VARK_TO_CONTENT_MODALITY[category];
  if (!candidates) return null;
  const modality = candidates.find((m) => availableModalities.includes(m));
  if (!modality) return null;
  return { modality, category };
}
