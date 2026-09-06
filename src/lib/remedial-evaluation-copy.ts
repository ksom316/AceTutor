/**
 * P1.3 — plain-language copy for the lecturer Remedial Intelligence page.
 *
 * Turns the R8.4 aggregate NUMBERS (from `buildRemedialIntelligenceEvaluation`)
 * into sentences a lecturer can read at a glance. It recomputes nothing,
 * changes no value, and stays strictly OBSERVATIONAL — every sentence about a
 * score difference is phrased as "students who did X later scored …", never
 * "X improved scores" or "X caused …".
 *
 * The inputs are already-aggregated counts and averages — no student name,
 * email, id, or per-student row ever reaches this module.
 *
 * No React, no Supabase, no AI, no writes. Pure.
 */

import type {
  RemedialFormatEvaluation,
  RemedialSourcePerformance,
} from "@/lib/remedial-intelligence-evaluation";
import type {
  RemedialEvidenceState,
  RemedialIntelligenceFormat,
} from "@/lib/remedial-intelligence";

/** Shown once, prominently, on the page. */
export const REMEDIAL_CAUSATION_NOTE =
  "These are observations, not proof that remediation caused improvement.";

/** The three A8 evidence states plus the video-only "unavailable" — student
 *  facing labels. */
export function evidenceStateLabel(state: RemedialEvidenceState): string {
  switch (state) {
    case "sufficient":
      return "Sufficient evidence";
    case "insufficient":
      return "Insufficient evidence";
    case "unavailable":
      return "Not measured yet";
    case "none":
    default:
      return "No evidence";
  }
}

/** A one-line "what this evidence state means" caption. */
export function evidenceStateHint(state: RemedialEvidenceState, minObservations: number): string {
  switch (state) {
    case "sufficient":
      return `At least ${minObservations} before/after observations — enough to read as a trend.`;
    case "insufficient":
      return `Fewer than ${minObservations} before/after observations — shown for transparency, not as a finding.`;
    case "unavailable":
      return "There is no signal to measure this yet.";
    case "none":
    default:
      return "No before/after observations yet.";
  }
}

const FORMAT_LABEL: Record<RemedialIntelligenceFormat, string> = {
  text: "text",
  audio: "audio",
  visual: "visual",
  video: "video",
};

const SOURCE_LABEL: Record<RemedialSourcePerformance["source"], string> = {
  history: "the student's own remedial history",
  adaptive: "recent learning activity",
  vark: "learning preferences",
  preference: "the student's chosen format",
  default: "the default format",
};

export function recommendationSourceLabel(source: RemedialSourcePerformance["source"]): string {
  return SOURCE_LABEL[source];
}

/**
 * Humanise an observed score delta.
 *
 * @param points   the R8.4 `observedImprovement` value (already rounded), or null.
 * @param subject  e.g. "text remediation", "remedial activities".
 */
export function observedImprovementSentence(points: number | null, subject: string): string {
  if (points == null) {
    return `Not enough before/after data yet to compare scores for ${subject}.`;
  }
  if (points > 0) {
    return (
      `Students who completed ${subject} later scored an average of ${points} ` +
      `point${points === 1 ? "" : "s"} higher on their next official module quiz.`
    );
  }
  if (points < 0) {
    const lower = Math.abs(points);
    return (
      `Students who completed ${subject} later scored an average of ${lower} ` +
      `point${lower === 1 ? "" : "s"} lower on their next official module quiz.`
    );
  }
  return `Students who completed ${subject} scored about the same, on average, on their next official module quiz.`;
}

/** "Of 30 recommendations, 20 were followed (66.7%)." — null-safe. */
export function followRateSentence(row: {
  recommendationsIssued: number;
  recommendationsFollowed: number;
  followRate: number | null;
}): string {
  if (row.recommendationsIssued === 0) {
    return "No recommendations from this source yet.";
  }
  const pct = row.followRate == null ? "—" : `${(row.followRate * 100).toFixed(1)}%`;
  return (
    `Of ${row.recommendationsIssued} recommendation${row.recommendationsIssued === 1 ? "" : "s"}, ` +
    `${row.recommendationsFollowed} ${row.recommendationsFollowed === 1 ? "was" : "were"} followed ` +
    `(${pct}) — the student meaningfully engaged with the recommended format.`
  );
}

/** One sentence describing a format's observed effectiveness row. */
export function formatEffectivenessSentence(row: RemedialFormatEvaluation): string {
  const fmt = FORMAT_LABEL[row.format];
  if (row.evidenceState === "unavailable") {
    return `Effectiveness of ${fmt} remediation isn't measured yet — there is no engagement signal for it.`;
  }
  if (row.linkedQuizOutcomes === 0) {
    return `No ${fmt} remediation has been followed by an official module quiz yet.`;
  }
  const base = observedImprovementSentence(row.observedImprovement, `${fmt} remediation`);
  return `${base} (${row.linkedQuizOutcomes} before/after observation${
    row.linkedQuizOutcomes === 1 ? "" : "s"
  }, ${evidenceStateLabel(row.evidenceState).toLowerCase()}.)`;
}

/** Column header for the observed-improvement figure — matches the R8.4 label
 *  but spelled out for the table. */
export const OBSERVED_IMPROVEMENT_COLUMN = "Observed improvement (points)";
