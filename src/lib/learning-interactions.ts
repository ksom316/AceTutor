/**
 * Phase A6 — a small, typed logging helper for genuine learning interactions.
 * Deliberately NOT a general analytics library: exactly the 4 CLIENT-loggable
 * event shapes below, nothing else. (A 5th event type, official_quiz_
 * completed, exists in the schema but is deliberately NOT client-loggable —
 * see the note on LearningInteractionEventType below.) See supabase/
 * migrations/20260905190000_learning_interactions.sql for the schema and
 * full rationale (why no "lesson_completed", why recommendation_matched is
 * null-not-false when there's no recommendation, why there's no metadata
 * jsonb escape hatch).
 *
 * `buildRecommendationContext` is pure (no I/O) and directly testable — see
 * learning-interactions.test.ts. `logInteraction` is the only I/O: a
 * fire-and-forget insert that NEVER throws, so no call site needs its own
 * try/catch — a logging failure must never block lesson access, Quiz Me, or
 * quiz submission.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { VarkCategory } from "@/lib/vark";
import type { LessonModality } from "@/lib/lesson-shared";

type InteractionRow = Database["public"]["Tables"]["learning_interactions"]["Insert"];

/** Which layer produced the modality recommendation actually shown to the
 *  student: the VARK prior (A4) or the adaptive override (A7). */
export type RecommendationSource = "vark" | "adaptive";

export type LearningInteractionEventType =
  | "lesson_opened"
  | "modality_selected"
  | "practice_quiz_started"
  | "practice_quiz_completed"
  | "official_quiz_completed";

/** official_quiz_completed is deliberately NOT one of the client-loggable
 *  event types below — see the reliability correction in
 *  20260905190000_learning_interactions.sql. It is logged exclusively,
 *  server-side, inside grade_quiz() (SECURITY DEFINER), in the same
 *  transaction as grading, with score_percent derived from the just-written
 *  quiz_attempts row — never from anything the client could supply. RLS's
 *  learning_interactions_insert_own policy also structurally rejects a
 *  direct client insert of this event type, independent of this file. */

export type PracticeDifficulty = "easy" | "medium" | "hard";

export type RecommendationContext = {
  recommended_modality: LessonModality | null;
  effective_vark_category: VarkCategory | null;
  recommendation_matched: boolean | null;
  recommendation_source: RecommendationSource | null;
};

/**
 * Records the recommendation the student was ACTUALLY SHOWN at interaction
 * time — which since A7 may be the adaptive override, not the VARK prior.
 *
 * - `recommendedModality` / `recommendationSource` come from the DISPLAYED
 *   recommendation (adaptive when A7 overrode, else VARK, else null).
 * - `effectiveCategory` is the student's real resolved VARK category — the
 *   adaptive layer never changes their VARK classification, so this is
 *   passed through independently of which source drove the recommendation.
 * - When no recommendation was shown (`recommendedModality` is null), every
 *   field here is null — same "only populated when a recommendation actually
 *   ran" contract as A6. `recommendation_matched` is never fabricated to
 *   false.
 */
export function buildRecommendationContext(input: {
  recommendedModality: LessonModality | null;
  recommendationSource: RecommendationSource | null;
  effectiveCategory: VarkCategory | null;
  actualModality: LessonModality;
}): RecommendationContext {
  if (input.recommendedModality == null) {
    return {
      recommended_modality: null,
      effective_vark_category: null,
      recommendation_matched: null,
      recommendation_source: null,
    };
  }
  return {
    recommended_modality: input.recommendedModality,
    effective_vark_category: input.effectiveCategory,
    recommendation_matched: input.recommendedModality === input.actualModality,
    recommendation_source: input.recommendationSource,
  };
}

type BaseFields = {
  course_id?: string | null;
  topic_id?: string | null;
};

export type LearningInteractionInput =
  | (BaseFields & {
      event_type: "lesson_opened";
      lesson_id: string;
      modality: LessonModality;
      recommendationContext: RecommendationContext;
    })
  | (BaseFields & {
      event_type: "modality_selected";
      modality: LessonModality;
      recommendationContext: RecommendationContext;
    })
  | (BaseFields & {
      event_type: "practice_quiz_started";
      difficulty: PracticeDifficulty;
    })
  | (BaseFields & {
      event_type: "practice_quiz_completed";
      difficulty: PracticeDifficulty;
      score_percent: number;
    });

/**
 * Fire-and-forget: never throws, never awaited by callers. A failure here
 * (network, RLS, transient error) is logged to the console only — it must
 * never block the learning flow that triggered it.
 *
 * `userId` is required explicitly (this is a plain function, not a hook —
 * callers already have it from `useAuth()`) rather than looked up
 * internally, matching how vark_profiles/learning_preferences submits
 * already pass `user.id` explicitly. RLS still independently enforces that
 * it can only ever be the caller's own id.
 */
export function logInteraction(userId: string, input: LearningInteractionInput): void {
  const { event_type, course_id = null, topic_id = null } = input;

  const row: InteractionRow = {
    user_id: userId,
    event_type,
    course_id,
    topic_id,
    lesson_id: null,
    modality: null,
    recommended_modality: null,
    effective_vark_category: null,
    recommendation_matched: null,
    recommendation_source: null,
    quiz_attempt_id: null,
    score_percent: null,
    difficulty: null,
  };

  switch (input.event_type) {
    case "lesson_opened":
      row.lesson_id = input.lesson_id;
      row.modality = input.modality;
      row.recommended_modality = input.recommendationContext.recommended_modality;
      row.effective_vark_category = input.recommendationContext.effective_vark_category;
      row.recommendation_matched = input.recommendationContext.recommendation_matched;
      row.recommendation_source = input.recommendationContext.recommendation_source;
      break;
    case "modality_selected":
      row.modality = input.modality;
      row.recommended_modality = input.recommendationContext.recommended_modality;
      row.effective_vark_category = input.recommendationContext.effective_vark_category;
      row.recommendation_matched = input.recommendationContext.recommendation_matched;
      row.recommendation_source = input.recommendationContext.recommendation_source;
      break;
    case "practice_quiz_started":
      row.difficulty = input.difficulty;
      break;
    case "practice_quiz_completed":
      row.difficulty = input.difficulty;
      row.score_percent = input.score_percent;
      break;
  }

  void supabase
    .from("learning_interactions")
    .insert(row)
    .then(({ error }) => {
      if (error) {
        console.error(`[logInteraction] ${event_type} insert failed: ${error.message}`);
      }
    });
}
