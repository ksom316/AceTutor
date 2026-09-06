/**
 * R4 — pure aggregation of remedial-intervention evidence, shaped for a later
 * A8 / lecturer evaluation surface. Every figure is observational; score
 * differences are labelled "observed subsequent score difference", never
 * "improvement caused by remediation". Low samples are flagged with the same
 * `classifyEvidenceState` philosophy A8 already uses.
 *
 * Pure — no React, no Supabase.
 */

import { classifyEvidenceState, type EvidenceState } from "@/lib/model-evaluation";
import { REMEDIAL_MODALITIES, type RemedialModality } from "@/lib/remedial-modality";
import type { RemedialOutcomeLink } from "@/lib/remedial-outcome-linking";

/** Below this many linked before/after pairs, a per-format average is shown
 *  WITH its count and flagged — never presented as a finding. Same value as
 *  A8's OUTCOME_ASSOCIATION_MIN_SAMPLES. */
export const REMEDIAL_EVAL_MIN_SAMPLES = 5;

const zeroByFormat = (): Record<RemedialModality, number> => ({ text: 0, audio: 0, visual: 0 });

export type RemedialFormatOutcomeSummary = {
  pairCount: number;
  averageBaselineScore: number | null;
  averageSubsequentScore: number | null;
  /** average(subsequent − baseline) over pairs that HAVE a baseline. */
  averageObservedScoreDifference: number | null;
  evidenceState: EvidenceState;
};

export type RemedialEvaluationMetrics = {
  formatSelectionsByFormat: Record<RemedialModality, number>;
  meaningfulEngagementsByFormat: Record<RemedialModality, number>;
  /** fraction (0–1) of meaningful engagements whose format == the recommended
   *  format at that time. null when no meaningful engagement carried a
   *  recommendation. */
  recommendedFormatMatchRate: number | null;
  /** A. FORMAT-LEVEL observational links: text / audio / visual may each
   *  reference the SAME subsequent attempt, so this can exceed the number of
   *  actual retakes. Use it for per-format observation counts, not totals. */
  formatLevelObservationalLinks: number;
  /** B. UNIQUE subsequent official module quiz attempts that followed a
   *  meaningful remedial engagement — each real `quiz_attempts.id` counted
   *  once, even when several formats were used before it (40% → Text + Audio →
   *  80% is TWO format observations but ONE unique subsequent quiz). */
  uniqueSubsequentOfficialQuizzes: number;
  /** deprecated alias of `formatLevelObservationalLinks` (kept for the §8
   *  metric name "meaningful engagements followed by another official quiz"). */
  engagementsFollowedByOfficialQuiz: number;
  outcomeByFormat: Record<RemedialModality, RemedialFormatOutcomeSummary>;
  disclaimer: string;
};

const DISCLAIMER =
  "Observational only. Figures show what students did around a remedial intervention — " +
  "a per-format score column is the AVERAGE OBSERVED SUBSEQUENT SCORE DIFFERENCE between a " +
  "baseline attempt and a later attempt on the same module. It is NOT evidence that the " +
  "format changed the score. When several formats were meaningfully used before one retake " +
  "(e.g. 40% -> Text + Audio -> 80%) that retake is one UNIQUE subsequent quiz but counts " +
  "as a format-level observation for each format. Low-sample formats are flagged.";

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function aggregateRemedialEvaluation(input: {
  formatSelections: readonly { format: RemedialModality }[];
  meaningfulEngagements: readonly {
    format: RemedialModality;
    recommendedFormat: RemedialModality | null;
  }[];
  outcomeLinks: readonly RemedialOutcomeLink[];
}): RemedialEvaluationMetrics {
  const formatSelectionsByFormat = zeroByFormat();
  for (const s of input.formatSelections) formatSelectionsByFormat[s.format] += 1;

  const meaningfulEngagementsByFormat = zeroByFormat();
  let matched = 0;
  let withRecommendation = 0;
  for (const e of input.meaningfulEngagements) {
    meaningfulEngagementsByFormat[e.format] += 1;
    if (e.recommendedFormat != null) {
      withRecommendation += 1;
      if (e.recommendedFormat === e.format) matched += 1;
    }
  }
  const recommendedFormatMatchRate = withRecommendation === 0 ? null : matched / withRecommendation;

  const outcomeByFormat = {} as Record<RemedialModality, RemedialFormatOutcomeSummary>;
  for (const format of REMEDIAL_MODALITIES) {
    const links = input.outcomeLinks.filter((l) => l.formatUsed === format);
    const baselines = links
      .map((l) => l.baselineScorePercent)
      .filter((v): v is number => v != null);
    const subs = links.map((l) => l.subsequentScorePercent);
    const diffs = links.map((l) => l.observedScoreDifference).filter((v): v is number => v != null);
    outcomeByFormat[format] = {
      pairCount: links.length,
      averageBaselineScore: avg(baselines),
      averageSubsequentScore: avg(subs),
      averageObservedScoreDifference: avg(diffs),
      evidenceState: classifyEvidenceState(links.length, REMEDIAL_EVAL_MIN_SAMPLES),
    };
  }

  const uniqueSubsequentOfficialQuizzes = new Set(
    input.outcomeLinks.map((l) => l.subsequentAttemptId),
  ).size;

  return {
    formatSelectionsByFormat,
    meaningfulEngagementsByFormat,
    recommendedFormatMatchRate,
    formatLevelObservationalLinks: input.outcomeLinks.length,
    uniqueSubsequentOfficialQuizzes,
    engagementsFollowedByOfficialQuiz: input.outcomeLinks.length,
    outcomeByFormat,
    disclaimer: DISCLAIMER,
  };
}
