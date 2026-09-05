/**
 * Phase A7 — lightweight reinforcement-style adaptive content recommendation.
 * Pure — no React, no Supabase, no AI. Deterministic and fully explainable:
 * VARK (A4) is the prior; the student's OWN history of module-quiz outcomes
 * paired with the modalities they used beforehand is a reward signal that can
 * shift the recommendation once there is enough real evidence. Framed as
 * ASSOCIATION, never causation. No RL agent, no Q-learning, no ML.
 *
 * The reward signal comes only from `official_quiz_completed` interaction
 * rows (module quizzes, server-written, one per attempt — General Course
 * Quiz and AI "Quiz Me" never produce them). The modality-USE signal comes
 * only from `meaningful_engagement` rows (Phase A7 — a modality's content
 * was actively visible for ~30s; a brief accidental tab click never
 * qualifies). `buildModalityEvidence` links each outcome to the distinct
 * modalities meaningfully engaged with since the previous outcome for that
 * same module, collapsing event volume so repeated engagement events can't
 * outweigh one genuine study session.
 */

import type { VarkCategory } from "@/lib/vark";
import type { LessonModality } from "@/lib/lesson-shared";
import type { VarkContentRecommendation } from "@/lib/vark-content-recommendation";

/** Global gate: at least this many module-quiz outcomes must have preceding
 *  modality use before the adaptive layer is allowed to override VARK. */
export const MIN_LINKED_OUTCOMES = 2;
/** Per-candidate gate: a modality can only WIN the adaptive recommendation
 *  if at least this many outcomes had it in their preceding study window. */
export const MIN_MODALITY_EVIDENCE = 2;

/** Deterministic tie-break order — matches MODALITY_ORDER in
 *  src/routes/_authenticated/topic.$topicId.tsx. */
const MODALITY_ORDER: readonly LessonModality[] = ["text", "video", "audio", "slides"];

/**
 * -1 weak / 0 medium / +1 strong. Same score bands as A5's adaptive Quiz Me
 * difficulty (`<50`, `50–<80`, `>=80`), for one consistent notion of a
 * "strong / medium / weak" official result across the app.
 */
export function outcomeReward(scorePercent: number): -1 | 0 | 1 {
  if (scorePercent < 50) return -1;
  if (scorePercent < 80) return 0;
  return 1;
}

export type ModalityEvidence = {
  /** Per modality: summed reward across the outcomes it was associated with,
   *  and the number of distinct outcomes (NOT events) backing it. */
  perModality: Partial<Record<LessonModality, { score: number; evidenceCount: number }>>;
  /** Distinct outcomes that had at least one preceding modality interaction. */
  linkedOutcomeCount: number;
};

type OutcomeRow = { topic_id: string; score_percent: number; created_at: string };
type InteractionRow = { topic_id: string; modality: LessonModality; created_at: string };

/**
 * Links `official_quiz_completed` outcomes to the modalities the student
 * MEANINGFULLY ENGAGED WITH beforehand (`meaningful_engagement` rows) and
 * collapses repeated events. Both inputs are ASSUMED already scoped to one
 * student (the server does that) and are sorted here defensively.
 *
 * For each module's outcomes in time order, the "study session" behind
 * outcome i is the engagement rows for that module strictly between the
 * previous outcome and outcome i — so a retake after re-studying counts as a
 * fresh, separate piece of evidence. Only the SET of distinct modalities in
 * that window matters; event count is ignored entirely.
 */
export function buildModalityEvidence(
  outcomes: readonly OutcomeRow[],
  interactions: readonly InteractionRow[],
): ModalityEvidence {
  const byTime = (a: { created_at: string }, b: { created_at: string }) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;

  const outcomesByTopic = new Map<string, OutcomeRow[]>();
  for (const o of outcomes) {
    const list = outcomesByTopic.get(o.topic_id) ?? [];
    list.push(o);
    outcomesByTopic.set(o.topic_id, list);
  }
  const interactionsByTopic = new Map<string, InteractionRow[]>();
  for (const it of interactions) {
    const list = interactionsByTopic.get(it.topic_id) ?? [];
    list.push(it);
    interactionsByTopic.set(it.topic_id, list);
  }

  const perModality: ModalityEvidence["perModality"] = {};
  let linkedOutcomeCount = 0;

  for (const [topicId, topicOutcomes] of outcomesByTopic) {
    const sortedOutcomes = [...topicOutcomes].sort(byTime);
    const topicInteractions = [...(interactionsByTopic.get(topicId) ?? [])].sort(byTime);

    for (let i = 0; i < sortedOutcomes.length; i++) {
      const windowStart = i === 0 ? "" : sortedOutcomes[i - 1].created_at;
      const windowEnd = sortedOutcomes[i].created_at;

      const modalitiesUsed = new Set<LessonModality>();
      for (const it of topicInteractions) {
        if (it.created_at > windowStart && it.created_at < windowEnd) {
          modalitiesUsed.add(it.modality);
        }
      }
      if (modalitiesUsed.size === 0) continue;

      linkedOutcomeCount += 1;
      const reward = outcomeReward(sortedOutcomes[i].score_percent);
      for (const m of modalitiesUsed) {
        const entry = perModality[m] ?? { score: 0, evidenceCount: 0 };
        entry.score += reward;
        entry.evidenceCount += 1;
        perModality[m] = entry;
      }
    }
  }

  return { perModality, linkedOutcomeCount };
}

export type AdaptiveModalitySource = "vark" | "adaptive";

export type AdaptiveReasonCode =
  | "no_evidence"
  | "insufficient_evidence"
  | "insufficient_modality_evidence"
  | "no_positive_evidence"
  | "tie"
  | "vark_confirmed"
  | "adaptive_override"
  | "adaptive_no_vark";

export type AdaptiveModalityRecommendation = {
  /** null = no recommendation at all (same state as A4's "nothing to
   *  recommend"). Always either null or a member of the topic's available
   *  modalities. */
  modality: LessonModality | null;
  category: VarkCategory | null;
  source: AdaptiveModalitySource;
  reasonCode: AdaptiveReasonCode;
  /** linkedOutcomeCount — a plain count of real quiz outcomes behind this,
   *  NOT a fabricated ML confidence. */
  evidenceCount: number;
  /** The winning modality's summed reward, only when source === "adaptive". */
  evidenceScore: number | null;
};

/**
 * VARK prior + observed evidence -> final recommendation. ~25 lines, one
 * decision per line, deterministic throughout.
 */
export function computeAdaptiveModalityRecommendation(input: {
  varkRecommendation: VarkContentRecommendation | null;
  effectiveVarkCategory: VarkCategory | null;
  availableModalities: readonly LessonModality[];
  evidence: ModalityEvidence;
}): AdaptiveModalityRecommendation {
  const { varkRecommendation, availableModalities, evidence } = input;
  const varkModality = varkRecommendation?.modality ?? null;
  const varkCategory = varkRecommendation?.category ?? null;

  const varkFallback = (reasonCode: AdaptiveReasonCode): AdaptiveModalityRecommendation => ({
    modality: varkModality,
    category: varkCategory,
    source: "vark",
    reasonCode,
    evidenceCount: evidence.linkedOutcomeCount,
    evidenceScore: null,
  });

  if (evidence.linkedOutcomeCount < MIN_LINKED_OUTCOMES) {
    return varkFallback(
      evidence.linkedOutcomeCount === 0 ? "no_evidence" : "insufficient_evidence",
    );
  }

  const candidates = availableModalities.filter(
    (m) => (evidence.perModality[m]?.evidenceCount ?? 0) >= MIN_MODALITY_EVIDENCE,
  );
  if (candidates.length === 0) return varkFallback("insufficient_modality_evidence");

  const scored = candidates.map((m) => ({ modality: m, score: evidence.perModality[m]!.score }));
  const bestScore = Math.max(...scored.map((s) => s.score));
  if (bestScore <= 0) return varkFallback("no_positive_evidence");

  const top = scored
    .filter((s) => s.score === bestScore)
    .sort((a, b) => MODALITY_ORDER.indexOf(a.modality) - MODALITY_ORDER.indexOf(b.modality));
  if (top.length > 1) return varkFallback("tie");

  const winner = top[0].modality;
  if (winner === varkModality) return varkFallback("vark_confirmed");

  return {
    modality: winner,
    category: varkCategory,
    source: "adaptive",
    reasonCode: varkModality ? "adaptive_override" : "adaptive_no_vark",
    evidenceCount: evidence.linkedOutcomeCount,
    evidenceScore: bestScore,
  };
}

/**
 * Development-only human-readable summary of an A7 decision — modality
 * names, integer counts/scores, the VARK-prior modality, the decision and
 * its reason code. Pure. Deliberately contains NO user id, topic id, raw
 * rows, PII, or secrets, so it is safe to log to the dev-server console (see
 * adaptive-modality.functions.ts, gated on NODE_ENV === "development").
 */
export function formatAdaptiveDiagnostic(input: {
  varkModality: LessonModality | null;
  evidence: ModalityEvidence;
  result: Pick<AdaptiveModalityRecommendation, "modality" | "source" | "reasonCode">;
}): string {
  const lines: string[] = [];
  lines.push(`[A7 adaptive-modality] VARK prior: ${input.varkModality ?? "(none)"}`);

  const mods = MODALITY_ORDER.filter((m) => input.evidence.perModality[m] != null);
  if (mods.length === 0) {
    lines.push("  (no meaningful-engagement evidence linked to any outcome yet)");
  } else {
    for (const m of mods) {
      const e = input.evidence.perModality[m]!;
      lines.push(`  ${m}: evidenceCount ${e.evidenceCount}  rewardScore ${e.score}`);
    }
  }
  lines.push(`  linkedOutcomes: ${input.evidence.linkedOutcomeCount}`);
  lines.push(
    input.result.source === "adaptive"
      ? `Decision: adaptive -> ${input.result.modality}`
      : "Decision: VARK fallback",
  );
  lines.push(`Reason: ${input.result.reasonCode}`);
  return lines.join("\n");
}
