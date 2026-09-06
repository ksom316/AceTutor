/**
 * R8.1 — Personal Remedial Recommendation Engine.
 *
 * A PURE function over R7's `RemedialInterventionRecord[]` that answers ONE
 * question for a single student:
 *
 *   "What remediation format has historically been ASSOCIATED WITH this
 *    student's improvement?"
 *
 * It decides whether that student's OWN completed remedial history carries
 * enough evidence to justify leaning a future remedial-format recommendation
 * one way. It NEVER claims causation, and it changes nothing on its own — the
 * output is advisory data for a later wiring phase.
 *
 * NOT touched here (and never should be from this file): adaptive-modality.ts
 * / .functions.ts (A7), the VARK logic, Learning Preferences, Mastery, quiz
 * grading, the database schema. This layer only reads records.
 *
 * No React. No Supabase. No API calls. No writes. Deterministic.
 *
 * Evidence philosophy is A8 / R7's:
 *   - a format needs at least `REMEDIAL_STUDENT_MIN_OBSERVATIONS` real
 *     before/after observations before it is even a candidate ("no
 *     conclusions from one attempt");
 *   - it needs `REMEDIAL_INTELLIGENCE_MIN_SAMPLES` before the engine will name
 *     a `preferredFormat` at all;
 *   - video has no engagement signal (§7) so it is never a candidate and is
 *     never estimated.
 */

import {
  REMEDIAL_FORMAT_ENGAGEMENT_TRACKED,
  REMEDIAL_INTELLIGENCE_FORMATS,
  REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
  REMEDIAL_STUDENT_MIN_OBSERVATIONS,
  type RemedialEvidenceState,
  type RemedialIntelligenceFormat,
  type RemedialInterventionRecord,
} from "@/lib/remedial-intelligence";
import { classifyEvidenceState } from "@/lib/model-evaluation";

/** Average observed improvement (percentage points) the winning format must
 *  clear — alongside a majority of positive observations — for the engine to
 *  report `"high"` rather than `"medium"` confidence. */
export const REMEDIAL_ADAPTATION_STRONG_IMPROVEMENT_POINTS = 10;

/** Fraction of a format's observations that must be positive for `"high"`. */
export const REMEDIAL_ADAPTATION_POSITIVE_FRACTION_FOR_HIGH = 0.6;

export type RemedialAdaptationConfidence = "none" | "low" | "medium" | "high";

/** Transparent per-format breakdown behind the decision. `averageObserved
 *  Improvement` is OBSERVATIONAL — a later same-module attempt minus the
 *  baseline attempt — not proof the format caused anything. */
export type RemedialFormatEvidence = {
  format: RemedialIntelligenceFormat;
  /** meaningful engagements that have a real baseline AND a subsequent
   *  official-quiz score (a usable before/after pair). */
  observations: number;
  positiveObservations: number;
  averageObservedImprovement: number | null;
  evidenceState: RemedialEvidenceState;
};

export type RemedialAdaptationRecommendation = {
  /** The format to LEAN a future remedial recommendation toward. Non-null
   *  only at `"medium"` / `"high"` confidence. Never a causal claim. */
  preferredFormat: RemedialIntelligenceFormat | null;
  /** The direction the evidence points even when it is too thin to act on
   *  (`"low"`). Equals `preferredFormat` at `"medium"` / `"high"`; null at
   *  `"none"`. */
  leaningFormat: RemedialIntelligenceFormat | null;
  confidence: RemedialAdaptationConfidence;
  /** Student-facing sentence. Always phrased as ASSOCIATION. */
  reason: string;
  perFormat: RemedialFormatEvidence[];
  /** total usable before/after observations across every tracked format. */
  totalObservations: number;
};

const TITLE_CASE: Record<RemedialIntelligenceFormat, string> = {
  text: "Text",
  audio: "Audio",
  visual: "Visual",
  video: "Video",
};

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * @param records  R7 intervention records. MUST already be scoped to a single
 *                 student by the caller — the type carries no student id.
 * @param options.topicId  when set, only records for that topic are considered
 *                 (a topic-specific leaning); otherwise all topics count.
 */
export function deriveRemedialFormatRecommendation(
  records: readonly RemedialInterventionRecord[],
  options: { topicId?: string } = {},
): RemedialAdaptationRecommendation {
  const scoped =
    options.topicId == null ? records : records.filter((r) => r.topicId === options.topicId);

  // A usable observation: the student meaningfully engaged with the format AND
  // we have a real baseline→subsequent pair for it. Video is never usable
  // (no engagement signal — §7).
  const diffsByFormat = new Map<RemedialIntelligenceFormat, number[]>();
  for (const r of scoped) {
    if (!REMEDIAL_FORMAT_ENGAGEMENT_TRACKED[r.remedialFormatUsed]) continue;
    if (!r.meaningfulEngagement || r.scoreDifference == null) continue;
    const list = diffsByFormat.get(r.remedialFormatUsed) ?? [];
    list.push(r.scoreDifference);
    diffsByFormat.set(r.remedialFormatUsed, list);
  }

  const perFormat: RemedialFormatEvidence[] = REMEDIAL_INTELLIGENCE_FORMATS.map((format) => {
    if (!REMEDIAL_FORMAT_ENGAGEMENT_TRACKED[format]) {
      return {
        format,
        observations: 0,
        positiveObservations: 0,
        averageObservedImprovement: null,
        evidenceState: "unavailable" as RemedialEvidenceState,
      };
    }
    const diffs = diffsByFormat.get(format) ?? [];
    return {
      format,
      observations: diffs.length,
      positiveObservations: diffs.filter((d) => d > 0).length,
      averageObservedImprovement: mean(diffs),
      evidenceState: classifyEvidenceState(diffs.length, REMEDIAL_INTELLIGENCE_MIN_SAMPLES),
    };
  });

  const totalObservations = perFormat.reduce((n, f) => n + f.observations, 0);

  // Candidates: enough observations to be discussed at all, and an OBSERVED
  // average improvement that is actually positive.
  const candidates = perFormat
    .filter(
      (f) =>
        f.observations >= REMEDIAL_STUDENT_MIN_OBSERVATIONS &&
        (f.averageObservedImprovement ?? 0) > 0,
    )
    .sort(
      (a, b) =>
        (b.averageObservedImprovement ?? 0) - (a.averageObservedImprovement ?? 0) ||
        b.observations - a.observations ||
        REMEDIAL_INTELLIGENCE_FORMATS.indexOf(a.format) -
          REMEDIAL_INTELLIGENCE_FORMATS.indexOf(b.format),
    );

  const base = { perFormat, totalObservations };

  if (candidates.length === 0) {
    return {
      ...base,
      preferredFormat: null,
      leaningFormat: null,
      confidence: "none",
      reason:
        totalObservations === 0
          ? "Not enough completed remedial history yet — a format needs meaningfully-engaged remediation followed by an official quiz retake before it can be evaluated for you."
          : "No remedial format has been associated with improvement in your completed study paths yet.",
    };
  }

  const winner = candidates[0];
  const label = TITLE_CASE[winner.format];

  if (winner.observations < REMEDIAL_INTELLIGENCE_MIN_SAMPLES) {
    return {
      ...base,
      preferredFormat: null,
      leaningFormat: winner.format,
      confidence: "low",
      reason:
        `${label} remediation shows an early positive association with improvement in your ` +
        `completed study paths, but there is not enough history yet to act on it ` +
        `(${winner.observations} of ${REMEDIAL_INTELLIGENCE_MIN_SAMPLES} needed).`,
    };
  }

  const positiveFraction =
    winner.observations === 0 ? 0 : winner.positiveObservations / winner.observations;
  const isHigh =
    (winner.averageObservedImprovement ?? 0) >= REMEDIAL_ADAPTATION_STRONG_IMPROVEMENT_POINTS &&
    positiveFraction >= REMEDIAL_ADAPTATION_POSITIVE_FRACTION_FOR_HIGH;

  return {
    ...base,
    preferredFormat: winner.format,
    leaningFormat: winner.format,
    confidence: isHigh ? "high" : "medium",
    reason: isHigh
      ? `${label} remediation has previously been associated with improvement in your completed study paths.`
      : `${label} remediation has been associated with some improvement across several of your completed study paths.`,
  };
}
