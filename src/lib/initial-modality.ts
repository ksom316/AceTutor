/**
 * Phase A7 final UX — decides which modality tab a topic learning page shows
 * FIRST, so the initial view matches the effective recommendation.
 *
 * Priority (first available one wins):
 *   1. the student's manual pick this page visit — sticky, always wins
 *   2. a genuine A7 adaptive OVERRIDE (adaptive recommendation whose source is
 *      "adaptive"; a "vark" source means A7 deferred to VARK, not an override)
 *   3. the A4 VARK baseline content recommendation
 *   4. the student's explicit Learning-Preferences default-tab modality
 *   5. the first available modality
 *
 * Every candidate is validated against `availableModalities`; an unavailable
 * one is skipped, never returned. Returns `undefined` only when the topic has
 * no lessons at all.
 *
 * Pure and read-only: it never touches the VARK profile / prediction fields,
 * Learning Preferences, or any stored state — it only reads already-resolved
 * values and returns one modality. A7 refining the CURRENT recommendation
 * never re-classifies the learner.
 */

import type { LessonModality } from "@/lib/lesson-shared";

export type InitialModalityInput = {
  /** The tab the student explicitly selected this visit, or null. */
  manualPick: LessonModality | null;
  /** The A7 recommendation's modality ONLY when it is a genuine override (its
   *  source is "adaptive"). Pass null for a "vark"-source result or while A7
   *  is still loading. */
  adaptiveOverrideModality: LessonModality | null;
  /** The A4 VARK content recommendation's modality, or null (no profile /
   *  kinesthetic / nothing available). */
  varkModality: LessonModality | null;
  /** Learning Preferences' mapped default-tab modality, or null. */
  preferredModality: LessonModality | null;
  availableModalities: readonly LessonModality[];
};

export function resolveInitialModality(input: InitialModalityInput): LessonModality | undefined {
  const available = (m: LessonModality | null): m is LessonModality =>
    m != null && input.availableModalities.includes(m);

  if (available(input.manualPick)) return input.manualPick;
  if (available(input.adaptiveOverrideModality)) return input.adaptiveOverrideModality;
  if (available(input.varkModality)) return input.varkModality;
  if (available(input.preferredModality)) return input.preferredModality;
  return input.availableModalities[0];
}
