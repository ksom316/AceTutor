/**
 * Phase A8 — truthful, defense-ready evaluation layer for AceTutor's VARK
 * model + A7 adaptation. Pure: no React, no Supabase, no AI, no training.
 *
 * Three deliberately separate concerns, never blended:
 *   1. OFFLINE ML metrics — from the committed synthetic-data training
 *      artifact (getOfflineModelEvaluation). Prototype numbers ONLY.
 *   2. LIVE VARK usage — privacy-safe aggregates over vark_profiles.
 *   3. A7 ADAPTATION — privacy-safe aggregates over learning_interactions,
 *      reconstructed with the UNCHANGED A7 pure functions.
 *
 * Every aggregate output here is counts / sums / averages / distributions.
 * No output carries a user id, email, name, quiz text, or per-student row —
 * see model-evaluation.test.ts (no-PII + no-student-rows assertions).
 */

import type { VarkCategory } from "@/lib/vark";
import { VARK_CATEGORIES } from "@/lib/vark";
import type { LessonModality } from "@/lib/lesson-shared";
import {
  resolveEffectiveVarkCategory,
  resolveVarkContentRecommendation,
} from "@/lib/vark-content-recommendation";
import {
  buildModalityEvidence,
  computeAdaptiveModalityRecommendation,
  type AdaptiveReasonCode,
  MIN_LINKED_OUTCOMES,
} from "@/lib/adaptive-modality";
import { OFFLINE_MODEL_EVALUATION } from "@/lib/model-evaluation.offline.generated";

export const DEPLOYED_VARK_MODEL_VERSION = "vark-assessment-a2.1-v1";

/** An observational-association metric with fewer linked samples than this is
 *  reported WITH its count and flagged — never presented as a finding. */
export const OUTCOME_ASSOCIATION_MIN_SAMPLES = 5;

const MODALITIES: readonly LessonModality[] = ["text", "video", "audio", "slides"];
const REASON_CODES: readonly AdaptiveReasonCode[] = [
  "no_evidence",
  "insufficient_evidence",
  "insufficient_modality_evidence",
  "no_positive_evidence",
  "tie",
  "vark_confirmed",
  "adaptive_override",
  "adaptive_no_vark",
];

/* ============================ PART A — offline ============================ */

export type OfflineModelEvaluation = typeof OFFLINE_MODEL_EVALUATION;

/** The committed offline (synthetic-data) training summary. Single source of
 *  truth: ml/vark/service/model/model_metadata.json → the generated module. */
export function getOfflineModelEvaluation(): OfflineModelEvaluation {
  return OFFLINE_MODEL_EVALUATION;
}

/* ========================= PART B — live VARK usage ====================== */

export type VarkProfileEvalRow = {
  userId: string;
  assessmentCompletedAt: string | null;
  mlPredictedCategory: string | null;
  mlPredictionConfidence: number | null;
  mlModelVersion: string | null;
  predictedCategory: string | null;
};

export type VarkUsageMetrics = {
  completedAssessments: number;
  withMlPrediction: number;
  /** null when there are no completed assessments to divide by. */
  mlCoveragePercent: number | null;
  mlCategoryDistribution: Record<VarkCategory, number>;
  /** Average of the per-student ML confidences, 0–100. null when none exist.
   *  This is a mean of per-INPUT model confidences — NOT model accuracy. */
  averageMlConfidencePercent: number | null;
  modelVersionsObserved: string[];
};

const emptyCategoryRecord = (): Record<VarkCategory, number> => ({
  visual: 0,
  auditory: 0,
  read_write: 0,
  kinesthetic: 0,
});

const isVarkCategory = (v: string | null): v is VarkCategory =>
  v != null && (VARK_CATEGORIES as readonly string[]).includes(v);

export function aggregateVarkUsage(rows: readonly VarkProfileEvalRow[]): VarkUsageMetrics {
  const completed = rows.filter((r) => r.assessmentCompletedAt != null);
  const withMl = completed.filter((r) => r.mlPredictedCategory != null);

  const dist = emptyCategoryRecord();
  for (const r of withMl) {
    if (isVarkCategory(r.mlPredictedCategory)) dist[r.mlPredictedCategory] += 1;
  }

  const confidences = withMl
    .map((r) => r.mlPredictionConfidence)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  const averageMlConfidencePercent =
    confidences.length === 0
      ? null
      : Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100);

  const versions = new Set<string>();
  for (const r of withMl) if (r.mlModelVersion) versions.add(r.mlModelVersion);

  return {
    completedAssessments: completed.length,
    withMlPrediction: withMl.length,
    mlCoveragePercent:
      completed.length === 0 ? null : Math.round((withMl.length / completed.length) * 100),
    mlCategoryDistribution: dist,
    averageMlConfidencePercent,
    modelVersionsObserved: [...versions].sort(),
  };
}

/* ===================== course scoping (defense in depth) ================= */

/**
 * Restricts the raw rows the server pulled to the calling lecturer's course
 * ONLY: VARK profiles for enrolled students, interactions for enrolled
 * students AND this course's topics. The server function already applies the
 * same filter at the database level (`.in(...)`) — this is an explicit
 * second, pure enforcement because `supabaseAdmin` bypasses RLS. `studentIds`
 * / `courseTopicIds` are used for filtering only and are never returned.
 */
export function scopeEvaluationInputs(input: {
  studentIds: readonly string[];
  courseTopicIds: readonly string[];
  varkRows: readonly VarkProfileEvalRow[];
  interactionRows: readonly InteractionEvalRow[];
}): { varkRows: VarkProfileEvalRow[]; interactionRows: InteractionEvalRow[] } {
  const students = new Set(input.studentIds);
  const topics = new Set(input.courseTopicIds);
  return {
    varkRows: input.varkRows.filter((r) => students.has(r.userId)),
    interactionRows: input.interactionRows.filter(
      (r) => students.has(r.userId) && r.topicId != null && topics.has(r.topicId),
    ),
  };
}

/* ======================= PART C — A7 adaptation ========================== */

export type InteractionEvalRow = {
  userId: string;
  topicId: string | null;
  eventType: string;
  modality: string | null;
  recommendationSource: string | null;
  scorePercent: number | null;
  createdAt: string;
};

export type EvidenceState = "none" | "insufficient" | "sufficient";

export function classifyEvidenceState(count: number, minSamples: number): EvidenceState {
  if (count <= 0) return "none";
  if (count < minSamples) return "insufficient";
  return "sufficient";
}

export type ModalityOutcomeAssociation = {
  modality: LessonModality;
  linkedOutcomeCount: number;
  /** Mean official-quiz % for outcomes whose preceding study window included
   *  this modality. OBSERVATIONAL — not evidence this modality caused it. */
  averageScorePercent: number | null;
  evidenceState: EvidenceState;
};

export type AdaptationMetrics = {
  totalMeaningfulEngagements: number;
  meaningfulEngagementsByModality: Record<LessonModality, number>;
  totalOfficialOutcomes: number;
  /** From logged interaction rows — the recommendation source actually SHOWN
   *  at event time (persisted). */
  loggedRecommendationSourceCounts: { vark: number; adaptive: number };
  /** (student, topic) pairs with any meaningful engagement or official
   *  outcome — the population the A7 reconstruction runs over. */
  adaptationUnits: number;
  /** Units whose linked-outcome count clears the A7 global evidence gate. */
  evaluableUnits: number;
  reconstruction: {
    reasonCodeCounts: Record<AdaptiveReasonCode, number>;
    sourceCounts: { vark: number; adaptive: number };
    adaptiveOverrideCount: number;
    varkFallbackCount: number;
    /** adaptive overrides / evaluable units, 0–100. null when 0 evaluable. */
    adaptiveOverrideRatePercent: number | null;
    currentlyRecommendedModalityDistribution: Record<LessonModality, number>;
  };
  outcomeAssociationByModality: ModalityOutcomeAssociation[];
  outcomeAssociationDisclaimer: string;
};

const OUTCOME_ASSOCIATION_DISCLAIMER =
  "Observational association only. Each figure is the average official module-quiz " +
  "score among linked study windows that included that modality — it is NOT evidence " +
  "the modality caused the score, and low-sample modalities are flagged.";

type Grouped = Map<string, InteractionEvalRow[]>;

function groupByStudentTopic(rows: readonly InteractionEvalRow[]): Grouped {
  const g: Grouped = new Map();
  for (const r of rows) {
    if (!r.topicId) continue;
    const key = `${r.userId} ${r.topicId}`;
    const list = g.get(key);
    if (list) list.push(r);
    else g.set(key, [r]);
  }
  return g;
}

/**
 * Same time-windowing as buildModalityEvidence, but keeps the RAW official
 * score for each (modality, outcome) link instead of collapsing to a reward.
 * Used only for the observational association metric.
 */
export function linkModalityOutcomes(
  outcomes: readonly { score_percent: number; created_at: string }[],
  engagements: readonly { modality: LessonModality; created_at: string }[],
): { modality: LessonModality; scorePercent: number }[] {
  const byTime = (a: { created_at: string }, b: { created_at: string }) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  const sortedOutcomes = [...outcomes].sort(byTime);
  const sortedEng = [...engagements].sort(byTime);
  const links: { modality: LessonModality; scorePercent: number }[] = [];

  for (let i = 0; i < sortedOutcomes.length; i++) {
    const start = i === 0 ? "" : sortedOutcomes[i - 1].created_at;
    const end = sortedOutcomes[i].created_at;
    const mods = new Set<LessonModality>();
    for (const e of sortedEng) {
      if (e.created_at > start && e.created_at < end) mods.add(e.modality);
    }
    for (const m of mods)
      links.push({ modality: m, scorePercent: sortedOutcomes[i].score_percent });
  }
  return links;
}

const isModality = (v: string | null): v is LessonModality =>
  v != null && (MODALITIES as readonly string[]).includes(v);

export function aggregateAdaptation(input: {
  interactions: readonly InteractionEvalRow[];
  /** topicId -> the modalities that topic actually has lessons for. */
  topicModalities: ReadonlyMap<string, readonly LessonModality[]>;
  /** userId -> effective VARK category (ml first, else questionnaire, else null). */
  effectiveVarkCategoryByUser: ReadonlyMap<string, VarkCategory | null>;
}): AdaptationMetrics {
  const { interactions, topicModalities, effectiveVarkCategoryByUser } = input;

  const engagements = interactions.filter((r) => r.eventType === "meaningful_engagement");
  const outcomes = interactions.filter((r) => r.eventType === "official_quiz_completed");

  const engByModality: Record<LessonModality, number> = { text: 0, video: 0, audio: 0, slides: 0 };
  for (const e of engagements) if (isModality(e.modality)) engByModality[e.modality] += 1;

  const loggedSource = { vark: 0, adaptive: 0 };
  for (const r of interactions) {
    if (r.recommendationSource === "vark") loggedSource.vark += 1;
    else if (r.recommendationSource === "adaptive") loggedSource.adaptive += 1;
  }

  const reasonCodeCounts = Object.fromEntries(REASON_CODES.map((c) => [c, 0])) as Record<
    AdaptiveReasonCode,
    number
  >;
  const sourceCounts = { vark: 0, adaptive: 0 };
  const recModalityDist: Record<LessonModality, number> = {
    text: 0,
    video: 0,
    audio: 0,
    slides: 0,
  };
  const assocSum: Record<LessonModality, number> = { text: 0, video: 0, audio: 0, slides: 0 };
  const assocCount: Record<LessonModality, number> = { text: 0, video: 0, audio: 0, slides: 0 };

  let adaptationUnits = 0;
  let evaluableUnits = 0;
  let adaptiveOverrideCount = 0;
  let varkFallbackCount = 0;

  const grouped = groupByStudentTopic(interactions);
  for (const [key, rows] of grouped) {
    const topicId = key.slice(key.indexOf(" ") + 1);
    const userId = key.slice(0, key.indexOf(" "));

    const unitEng = rows
      .filter((r) => r.eventType === "meaningful_engagement" && isModality(r.modality))
      .map((r) => ({
        topic_id: topicId,
        modality: r.modality as LessonModality,
        created_at: r.createdAt,
      }));
    const unitOut = rows
      .filter(
        (r) => r.eventType === "official_quiz_completed" && typeof r.scorePercent === "number",
      )
      .map((r) => ({
        topic_id: topicId,
        score_percent: r.scorePercent as number,
        created_at: r.createdAt,
      }));

    if (unitEng.length === 0 && unitOut.length === 0) continue;
    adaptationUnits += 1;

    const evidence = buildModalityEvidence(unitOut, unitEng);
    const available = [...(topicModalities.get(topicId) ?? [])];
    const category = effectiveVarkCategoryByUser.get(userId) ?? null;
    const varkRec = resolveVarkContentRecommendation(category, available);
    const decision = computeAdaptiveModalityRecommendation({
      varkRecommendation: varkRec,
      effectiveVarkCategory: category,
      availableModalities: available,
      evidence,
    });

    reasonCodeCounts[decision.reasonCode] += 1;
    sourceCounts[decision.source] += 1;
    if (decision.source === "adaptive") adaptiveOverrideCount += 1;
    else varkFallbackCount += 1;
    if (decision.modality && isModality(decision.modality)) recModalityDist[decision.modality] += 1;
    if (evidence.linkedOutcomeCount >= MIN_LINKED_OUTCOMES) evaluableUnits += 1;

    for (const link of linkModalityOutcomes(unitOut, unitEng)) {
      assocSum[link.modality] += link.scorePercent;
      assocCount[link.modality] += 1;
    }
  }

  const outcomeAssociationByModality: ModalityOutcomeAssociation[] = MODALITIES.map((m) => ({
    modality: m,
    linkedOutcomeCount: assocCount[m],
    averageScorePercent: assocCount[m] === 0 ? null : Math.round(assocSum[m] / assocCount[m]),
    evidenceState: classifyEvidenceState(assocCount[m], OUTCOME_ASSOCIATION_MIN_SAMPLES),
  }));

  return {
    totalMeaningfulEngagements: engagements.length,
    meaningfulEngagementsByModality: engByModality,
    totalOfficialOutcomes: outcomes.length,
    loggedRecommendationSourceCounts: loggedSource,
    adaptationUnits,
    evaluableUnits,
    reconstruction: {
      reasonCodeCounts,
      sourceCounts,
      adaptiveOverrideCount,
      varkFallbackCount,
      adaptiveOverrideRatePercent:
        evaluableUnits === 0 ? null : Math.round((adaptiveOverrideCount / evaluableUnits) * 100),
      currentlyRecommendedModalityDistribution: recModalityDist,
    },
    outcomeAssociationByModality,
    outcomeAssociationDisclaimer: OUTCOME_ASSOCIATION_DISCLAIMER,
  };
}

/** Build the userId -> effective category map the A7 reconstruction needs,
 *  from the same rows aggregateVarkUsage consumes. */
export function effectiveVarkCategoryByUser(
  rows: readonly VarkProfileEvalRow[],
): Map<string, VarkCategory | null> {
  const m = new Map<string, VarkCategory | null>();
  for (const r of rows) {
    m.set(
      r.userId,
      resolveEffectiveVarkCategory({
        ml_predicted_category: isVarkCategory(r.mlPredictedCategory) ? r.mlPredictedCategory : null,
        predicted_category: isVarkCategory(r.predictedCategory) ? r.predictedCategory : null,
      }),
    );
  }
  return m;
}

/* ===================== PART E — defense summary ========================== */

export const EVALUATION_NOTES: readonly string[] = [
  "The offline VARK classifier was trained and evaluated on SYNTHETIC prototype data — its metrics validate the training pipeline, not real-world classification accuracy.",
  "The deployed 4-feature model's performance is modest (held-out macro F1 ~0.39 on synthetic data). It is an integration candidate, not a validated production classifier.",
  "Per-input prediction confidence shown to a student is the model's own probability for that input — it is NOT the model's accuracy.",
  "All live interaction metrics here are observational aggregates. They describe what students did, not what any format causes.",
  "A7 is lightweight reinforcement-STYLE adaptation (VARK prior + meaningful-engagement windows + later official-quiz reward bands). It is not deep RL or Q-learning.",
  "Robust validation needs substantially more real student data than is available now.",
];

export type DefenseSummary = {
  generatedAt: string;
  deployedModel: {
    modelVersion: string;
    modelType: string;
    winner: string;
    featureSet: string;
    featureNames: readonly string[];
    trainingDataSource: string;
    deploymentStatus: string;
    syntheticDisclaimer: string;
  };
  offline: OfflineModelEvaluation;
  live: {
    vark: VarkUsageMetrics;
    adaptation: AdaptationMetrics;
  };
  evaluationNotes: readonly string[];
};

export function buildDefenseSummary(input: {
  generatedAt: string;
  vark: VarkUsageMetrics;
  adaptation: AdaptationMetrics;
}): DefenseSummary {
  const offline = getOfflineModelEvaluation();
  return {
    generatedAt: input.generatedAt,
    deployedModel: {
      modelVersion: offline.modelVersion,
      modelType: offline.deployedModelType,
      winner: offline.winner,
      featureSet: offline.featureSet,
      featureNames: offline.featureNames,
      trainingDataSource: offline.trainingDataSource,
      deploymentStatus: offline.deploymentStatus,
      syntheticDisclaimer: offline.syntheticDisclaimer,
    },
    offline,
    live: { vark: input.vark, adaptation: input.adaptation },
    evaluationNotes: EVALUATION_NOTES,
  };
}
