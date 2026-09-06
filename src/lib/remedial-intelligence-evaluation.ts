/**
 * R8.4 — Remedial Intelligence Evaluation.
 *
 * A PURE lecturer-facing evaluation of the R8 remedial-intelligence pipeline
 * (R1 content → R4 engagement → R7 observed outcomes → R8 history-based
 * recommendations). Its ONLY purpose is to measure whether R8 is producing
 * useful EVIDENCE — it never improves the algorithm, never retrains, and never
 * claims causation.
 *
 * Every calculation is delegated to the existing R7 helpers
 * (`aggregateCourseRemedialInsights`, `aggregateRemedialFormatEffectiveness`
 * via that, `aggregateRemedialRecommendationAccuracy`) and A8's
 * `classifyEvidenceState` — nothing is recomputed here. This module only
 * RESHAPES those aggregates for the lecturer page and folds in a few scalar
 * counts the server pre-computes (never identifiers).
 *
 * Output is 100% aggregate: counts, sums, averages, evidence states, format
 * names. It carries NO user id, email, name, study-path id, attempt id, topic
 * id, quiz text, or UUID of any kind — see remedial-intelligence-evaluation.test.ts.
 *
 * No React. No Supabase. No API calls. No writes. Deterministic.
 */

import {
  aggregateCourseRemedialInsights,
  aggregateRemedialRecommendationAccuracy,
  buildRemedialInterventionRecords,
  OBSERVED_IMPROVEMENT_LABEL,
  REMEDIAL_INTELLIGENCE_FORMATS,
  REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
  REMEDIAL_INTERACTION_EVENT_TYPES,
  type RemedialEvidenceState,
  type RemedialIntelligenceFormat,
  type RemedialInterventionRecord,
} from "@/lib/remedial-intelligence";
import { classifyEvidenceState } from "@/lib/model-evaluation";
import { isSufficientAttempt, type PerfAttempt } from "@/lib/quiz-performance";

/** The recommendation sources shown in the source-performance table, in
 *  priority order (R8.2). */
export const REMEDIAL_EVALUATION_SOURCES = [
  "history",
  "adaptive",
  "vark",
  "preference",
  "default",
] as const;
export type RemedialEvaluationSource = (typeof REMEDIAL_EVALUATION_SOURCES)[number];

/** R6 records a video recommendation but no watch time — so video
 *  effectiveness is never estimated (R7 §7). */
export const VIDEO_EVIDENCE_MESSAGE =
  "Video recommendations exist, but meaningful watch time is not currently measured.";

export const REMEDIAL_EVALUATION_LIMITATIONS = [
  "Evidence is observational only.",
  "Observed improvement does not prove causation.",
  "More student data is required for reliable conclusions.",
  "Video effectiveness cannot currently be measured (no playback tracking).",
  "R8 does not automatically retrain itself.",
] as const;

/* ============================ row -> R7 records ========================== */

export type StudyPathScopeRow = {
  id: string;
  topicId: string | null;
  /** the quiz attempt that anchored the Study Path (baseline). */
  attemptId: string | null;
};

export type RemedialInteractionScopeRow = {
  studyPathId: string | null;
  eventType: string;
  remedialFormat: string | null;
  recommendedFormat: string | null;
  recommendationSource: string | null;
  contentVersion: string | null;
  createdAt: string;
};

const asFormat = (v: string | null): "text" | "audio" | "visual" | null =>
  v === "text" || v === "audio" || v === "visual" ? v : null;

const EVENT_TYPES = new Set<string>(REMEDIAL_INTERACTION_EVENT_TYPES);

/**
 * Map raw DB rows (already course-scoped by the caller) into R7
 * `RemedialInterventionRecord[]` via the unchanged
 * `buildRemedialInterventionRecords`. Baseline / outcome scores use the SAME
 * "sufficient attempt" bar as Mastery / Study Path / the R4 evaluation layer.
 * Shared by the lecturer feed and the per-student runtime resolver so the two
 * never drift.
 */
export function toRemedialInterventionRecords(input: {
  studyPaths: readonly StudyPathScopeRow[];
  moduleAttempts: readonly PerfAttempt[];
  interactions: readonly RemedialInteractionScopeRow[];
}): RemedialInterventionRecord[] {
  const sufficient = input.moduleAttempts.filter(isSufficientAttempt);
  const pct = (a: PerfAttempt): number | null =>
    a.total && a.total > 0 ? Math.round(((a.score ?? 0) / a.total) * 100) : null;
  const attemptById = new Map(sufficient.map((a) => [a.id, a] as const));

  const studyPaths = input.studyPaths
    .filter((p) => p.topicId)
    .map((p) => {
      const anchor = p.attemptId ? attemptById.get(p.attemptId) : undefined;
      return {
        id: p.id,
        topicId: p.topicId as string,
        baselineScore: anchor ? pct(anchor) : null,
        hasRemedialVideoRecommendation: false,
      };
    });

  const moduleOutcomes = sufficient
    .filter((a) => a.topic_id && a.finished_at && pct(a) != null)
    .map((a) => ({
      attemptId: a.id,
      topicId: a.topic_id as string,
      scorePercent: pct(a) as number,
      completedAt: a.finished_at as string,
    }));

  const remedialInteractions = input.interactions.flatMap((e) => {
    const fmt = asFormat(e.remedialFormat);
    if (!e.studyPathId || !fmt || !EVENT_TYPES.has(e.eventType)) return [];
    return [
      {
        studyPathId: e.studyPathId,
        eventType: e.eventType as (typeof REMEDIAL_INTERACTION_EVENT_TYPES)[number],
        format: fmt,
        recommendedFormat: asFormat(e.recommendedFormat),
        recommendationSource: e.recommendationSource,
        contentVersion: e.contentVersion,
        createdAt: e.createdAt,
      },
    ];
  });

  return buildRemedialInterventionRecords({ studyPaths, remedialInteractions, moduleOutcomes });
}

/* ============================== evaluation ============================== */

export type RemedialSourcePerformance = {
  source: RemedialEvaluationSource;
  recommendationsIssued: number;
  recommendationsFollowed: number;
  /** followed / issued, 0–1. null when none issued. */
  followRate: number | null;
  evidenceState: RemedialEvidenceState;
};

export type RemedialFormatEvaluation = {
  format: RemedialIntelligenceFormat;
  interventions: number;
  meaningfulEngagements: number;
  linkedQuizOutcomes: number;
  averageBaselineScore: number | null;
  averageSubsequentScore: number | null;
  /** OBSERVED improvement after remediation — never a causal claim. null when
   *  there is no before/after population. */
  observedImprovement: number | null;
  evidenceState: RemedialEvidenceState;
};

export type FormatTally = { format: RemedialIntelligenceFormat; count: number };

export type RemedialIntelligenceEvaluation = {
  generatedAt: string;

  overview: {
    studyPathsWithRemedialContent: number;
    meaningfulRemedialEngagements: number;
    linkedOfficialQuizOutcomes: number;
    historyRecommendations: number;
    evidenceState: RemedialEvidenceState;
    minimumObservations: number;
  };

  recommendationSourcePerformance: RemedialSourcePerformance[];

  formatEffectiveness: RemedialFormatEvaluation[];
  observedImprovementLabel: string;

  historyLearning: {
    recommendationCount: number;
    studentsWithHistoryRecommendation: number;
    formatsRecommended: FormatTally[];
    currentlyEligibleStudents: number;
    currentConfidenceDistribution: { medium: number; high: number };
    currentPreferredFormats: FormatTally[];
    outcomesAfterHistoryRecommendations: {
      observationsWithOutcome: number;
      averageBaselineScore: number | null;
      averageSubsequentScore: number | null;
      observedImprovement: number | null;
      evidenceState: RemedialEvidenceState;
    };
  };

  video: {
    recommendationsPresent: number;
    evidenceState: "unavailable";
    message: string;
  };

  limitations: string[];
  disclaimer: string;
};

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

const isFormat = (v: string | null): v is RemedialIntelligenceFormat =>
  v != null && (REMEDIAL_INTELLIGENCE_FORMATS as readonly string[]).includes(v);

function tallyFormats(formats: readonly RemedialIntelligenceFormat[]): FormatTally[] {
  const counts = new Map<RemedialIntelligenceFormat, number>();
  for (const f of formats) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        REMEDIAL_INTELLIGENCE_FORMATS.indexOf(a.format) -
          REMEDIAL_INTELLIGENCE_FORMATS.indexOf(b.format),
    );
}

/** One recommendation "instance" per (study path, content version). */
function dedupeInstances(
  records: readonly RemedialInterventionRecord[],
): RemedialInterventionRecord[] {
  const seen = new Map<string, RemedialInterventionRecord>();
  for (const r of records) {
    const key = `${r.studyPathId} ${r.contentVersion ?? ""}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

const EMPTY_BUCKET = {
  recommendationCount: 0,
  followedRecommendationCount: 0,
  matchRate: null as number | null,
};

/**
 * @param input.records                          course-scoped R7 records.
 * @param input.studyPathsWithRemedialContent    denominator only (server count).
 * @param input.studyPathsWithVideoRecommendation server count of non-null remedial_video.
 * @param input.studentsWithHistoryRecommendation distinct students whose logged
 *        events include a 'history'-sourced recommendation (server count).
 * @param input.currentHistoryLeanings           for each student who WOULD
 *        currently receive a history-based recommendation, its confidence +
 *        format (server re-runs the unchanged R8.1 engine). No identifiers.
 */
export function buildRemedialIntelligenceEvaluation(input: {
  records: readonly RemedialInterventionRecord[];
  generatedAt: string;
  studyPathsWithRemedialContent: number;
  studyPathsWithVideoRecommendation: number;
  studentsWithHistoryRecommendation: number;
  currentHistoryLeanings: readonly {
    confidence: "medium" | "high";
    format: RemedialIntelligenceFormat;
  }[];
}): RemedialIntelligenceEvaluation {
  const { records } = input;

  const insights = aggregateCourseRemedialInsights({
    records,
    totalStudyPaths: input.studyPathsWithRemedialContent,
    studyPathsWithVideoRecommendation: input.studyPathsWithVideoRecommendation,
  });
  const accuracy = aggregateRemedialRecommendationAccuracy(records);

  const linkedOfficialQuizOutcomes = REMEDIAL_INTELLIGENCE_FORMATS.reduce(
    (n, f) => n + insights.formatEffectiveness[f].followedByQuizOutcome,
    0,
  );
  const historyBucket = accuracy.bySource.history ?? EMPTY_BUCKET;

  // B — recommendation source performance
  const recommendationSourcePerformance: RemedialSourcePerformance[] =
    REMEDIAL_EVALUATION_SOURCES.map((source) => {
      const b = accuracy.bySource[source] ?? EMPTY_BUCKET;
      return {
        source,
        recommendationsIssued: b.recommendationCount,
        recommendationsFollowed: b.followedRecommendationCount,
        followRate: b.matchRate,
        evidenceState: classifyEvidenceState(
          b.recommendationCount,
          REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
        ),
      };
    });

  // C — format effectiveness (reshaped R7 aggregate)
  const formatEffectiveness: RemedialFormatEvaluation[] = REMEDIAL_INTELLIGENCE_FORMATS.map(
    (format) => {
      const e = insights.formatEffectiveness[format];
      return {
        format,
        interventions: e.interventions,
        meaningfulEngagements: e.withMeaningfulEngagement,
        linkedQuizOutcomes: e.followedByQuizOutcome,
        averageBaselineScore: e.averageBaselineScore,
        averageSubsequentScore: e.averageSubsequentScore,
        observedImprovement: e.averageObservedImprovement,
        evidenceState: e.evidenceState,
      };
    },
  );

  // D — R8 personal history learning
  const historyInstances = dedupeInstances(
    records.filter((r) => r.recommendationSource === "history"),
  );
  const formatsRecommended = tallyFormats(
    historyInstances.map((i) => i.recommendedFormat).filter(isFormat),
  );
  const historyOutcomeRecords = records.filter(
    (r) => r.recommendationSource === "history" && r.subsequentQuizScore != null,
  );
  const historyOutcomeWithBaseline = historyOutcomeRecords.filter((r) => r.baselineScore != null);

  return {
    generatedAt: input.generatedAt,

    overview: {
      studyPathsWithRemedialContent: input.studyPathsWithRemedialContent,
      meaningfulRemedialEngagements: insights.totalEngagedInterventions,
      linkedOfficialQuizOutcomes,
      historyRecommendations: historyBucket.recommendationCount,
      evidenceState: classifyEvidenceState(
        linkedOfficialQuizOutcomes,
        REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
      ),
      minimumObservations: REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
    },

    recommendationSourcePerformance,

    formatEffectiveness,
    observedImprovementLabel: OBSERVED_IMPROVEMENT_LABEL,

    historyLearning: {
      recommendationCount: historyBucket.recommendationCount,
      studentsWithHistoryRecommendation: input.studentsWithHistoryRecommendation,
      formatsRecommended,
      currentlyEligibleStudents: input.currentHistoryLeanings.length,
      currentConfidenceDistribution: {
        medium: input.currentHistoryLeanings.filter((l) => l.confidence === "medium").length,
        high: input.currentHistoryLeanings.filter((l) => l.confidence === "high").length,
      },
      currentPreferredFormats: tallyFormats(input.currentHistoryLeanings.map((l) => l.format)),
      outcomesAfterHistoryRecommendations: {
        observationsWithOutcome: historyOutcomeRecords.length,
        averageBaselineScore: mean(
          historyOutcomeWithBaseline.map((r) => r.baselineScore as number),
        ),
        averageSubsequentScore: mean(
          historyOutcomeRecords.map((r) => r.subsequentQuizScore as number),
        ),
        observedImprovement: mean(
          historyOutcomeWithBaseline.map((r) => r.scoreDifference as number),
        ),
        evidenceState: classifyEvidenceState(
          historyOutcomeRecords.length,
          REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
        ),
      },
    },

    video: {
      recommendationsPresent: insights.videoEvidence.recommendationsPresent,
      evidenceState: "unavailable",
      message: VIDEO_EVIDENCE_MESSAGE,
    },

    limitations: [...REMEDIAL_EVALUATION_LIMITATIONS],
    disclaimer: insights.disclaimer,
  };
}
