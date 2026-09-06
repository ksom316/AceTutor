/**
 * R4 — OBSERVATIONAL reconstruction of:
 *
 *   previous official module quiz  →  remedial meaningful engagement  →
 *   next completed official module quiz for the SAME student + SAME topic
 *
 * Nothing here is persisted and nothing claims causation. A link means only
 * "the student meaningfully used <format> remediation between a baseline
 * attempt and a later attempt on the same module" — never "remediation caused
 * the score change".
 *
 * Rules (all enforced here):
 *   - MODULE official quizzes only — General Course Quiz and practice "Quiz Me"
 *     are excluded (callers pass module outcomes only; this is also asserted).
 *   - the subsequent quiz must be COMPLETED and occur strictly AFTER the
 *     remedial engagement.
 *   - EACH qualifying meaningful engagement links to ITS OWN first subsequent
 *     completed official module quiz for the same student + topic. A single
 *     retake may therefore be referenced by more than one format-level link
 *     (e.g. Text engagement AND Audio engagement both preceding one 80%
 *     retake = two format observations, one unique quiz attempt). Aggregation
 *     is responsible for not inflating unique-attempt counts — see
 *     `subsequentAttemptId` and `remedial-evaluation.ts`.
 *   - baseline = the Study Path's original attempt score where available.
 *
 * Pure — no React, no Supabase.
 */

import type { RemedialModality } from "@/lib/remedial-modality";

export type RemedialEngagementRecord = {
  studyPathId: string;
  topicId: string;
  formatUsed: RemedialModality;
  recommendedFormat: RemedialModality | null;
  /** `remedial_meaningful_engagement.created_at` (ISO). */
  engagedAt: string;
};

export type OfficialModuleOutcome = {
  attemptId: string;
  topicId: string;
  /** 0–100, derived from the attempt's score/total — observational. */
  scorePercent: number;
  /** `quiz_attempts.finished_at` (ISO). Only completed attempts belong here. */
  completedAt: string;
};

export type RemedialOutcomeLink = {
  studyPathId: string;
  topicId: string;
  formatUsed: RemedialModality;
  recommendedFormat: RemedialModality | null;
  /** null when the Study Path's baseline attempt score is unknown. */
  baselineScorePercent: number | null;
  subsequentScorePercent: number;
  /** the real `quiz_attempts.id` of the subsequent official module attempt.
   *  The same id can appear on multiple links (one per format meaningfully
   *  used before that retake) — used to count UNIQUE quiz attempts once. */
  subsequentAttemptId: string;
  engagedAt: string;
  subsequentQuizAt: string;
  /** subsequent − baseline. OBSERVATIONAL only — labelled everywhere as
   *  "observed subsequent score difference", never "improvement". null when
   *  there is no baseline. */
  observedScoreDifference: number | null;
};

const byTimeAsc = (a: { t: string }, b: { t: string }) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

export function linkRemedialEngagementsToOutcomes(input: {
  engagements: readonly RemedialEngagementRecord[];
  /** COMPLETED official MODULE attempts only (no general quiz, no practice). */
  moduleOutcomes: readonly OfficialModuleOutcome[];
  /** studyPathId → the Study Path's baseline attempt score (0–100) or null. */
  baselineScoreByStudyPath: ReadonlyMap<string, number | null>;
}): RemedialOutcomeLink[] {
  // Oldest engagement first — purely for deterministic output order; each
  // engagement is evaluated independently (no outcome is "claimed").
  const engagements = [...input.engagements]
    .map((e) => ({ e, t: e.engagedAt }))
    .sort(byTimeAsc)
    .map((x) => x.e);

  const outcomesByTopic = new Map<string, OfficialModuleOutcome[]>();
  for (const o of input.moduleOutcomes) {
    const list = outcomesByTopic.get(o.topicId) ?? [];
    list.push(o);
    outcomesByTopic.set(o.topicId, list);
  }
  for (const list of outcomesByTopic.values()) {
    list.sort((a, b) => byTimeAsc({ t: a.completedAt }, { t: b.completedAt }));
  }

  const links: RemedialOutcomeLink[] = [];

  for (const eng of engagements) {
    const candidates = outcomesByTopic.get(eng.topicId) ?? [];
    // this engagement's OWN first subsequent completed official module quiz.
    const subsequent = candidates.find((o) => o.completedAt > eng.engagedAt);
    if (!subsequent) continue;

    const baseline = input.baselineScoreByStudyPath.get(eng.studyPathId) ?? null;
    links.push({
      studyPathId: eng.studyPathId,
      topicId: eng.topicId,
      formatUsed: eng.formatUsed,
      recommendedFormat: eng.recommendedFormat,
      baselineScorePercent: baseline,
      subsequentScorePercent: subsequent.scorePercent,
      subsequentAttemptId: subsequent.attemptId,
      engagedAt: eng.engagedAt,
      subsequentQuizAt: subsequent.completedAt,
      observedScoreDifference: baseline == null ? null : subsequent.scorePercent - baseline,
    });
  }

  return links;
}
