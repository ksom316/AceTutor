import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LessonModality } from "@/lib/lesson-shared";
import {
  aggregateAdaptation,
  aggregateVarkUsage,
  buildDefenseSummary,
  effectiveVarkCategoryByUser,
  scopeEvaluationInputs,
  type DefenseSummary,
  type InteractionEvalRow,
  type VarkProfileEvalRow,
} from "@/lib/model-evaluation";

/**
 * Phase A8 — the one aggregate feed behind /lecturer/evaluation.
 *
 * TWO independent boundaries, because supabaseAdmin bypasses RLS:
 *   1. AUTHORISATION — current_lecturer_course() must return a course id.
 *   2. DATA SCOPING — every service-role read is explicitly filtered to that
 *      course's enrolled students and its own topics (resolved server-side
 *      from `enrollments` / `topics`), then re-filtered by the pure
 *      `scopeEvaluationInputs` before aggregation. A lecturer never sees
 *      another course's students, assessments, ML predictions, interactions,
 *      or linked outcomes.
 *
 * EVERYTHING returned is an aggregate: counts, sums, averages, distributions.
 * No user id, email, name, quiz text, per-student row, or raw interaction
 * history ever leaves this function — see model-evaluation.test.ts.
 *
 * It never retrains, never alters A7 rewards/thresholds, and reconstructs A7
 * decisions with the unchanged pure functions in adaptive-modality.ts.
 */

const ROW_CAP = 50_000; // generous; a real deployment has far fewer

const MODALITIES: readonly LessonModality[] = ["text", "video", "audio", "slides"];
const isModality = (v: string | null): v is LessonModality =>
  v != null && (MODALITIES as readonly string[]).includes(v);

export const EVALUATION_ERRORS: Record<string, string> = {
  NOT_A_LECTURER: "Only a lecturer can view the model & adaptation evaluation.",
  LOAD_FAILED: "Couldn't load the evaluation metrics right now. Please try again in a moment.",
};

export function evaluationErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return EVALUATION_ERRORS[raw] ?? EVALUATION_ERRORS.LOAD_FAILED;
}

export const getModelEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DefenseSummary> => {
    const { supabase } = context;

    // 1. Authorisation: course id derived server-side, never trusted from the client.
    const { data: lecturerCourseId } = await supabase.rpc("current_lecturer_course");
    if (!lecturerCourseId) throw new Error("NOT_A_LECTURER");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 2. Data scoping: this course's enrolled students + this course's topics.
    const [enrollRes, topicRes] = await Promise.all([
      supabaseAdmin.from("enrollments").select("user_id").eq("course_id", lecturerCourseId),
      supabaseAdmin.from("topics").select("id").eq("course_id", lecturerCourseId),
    ]);
    if (enrollRes.error || topicRes.error) {
      console.error(
        `[getModelEvaluation] scope load failed: enrollments=${enrollRes.error?.code ?? "ok"} ` +
          `topics=${topicRes.error?.code ?? "ok"}`,
      );
      throw new Error("LOAD_FAILED");
    }
    const studentIds = [...new Set((enrollRes.data ?? []).map((r) => r.user_id))];
    const courseTopicIds = [...new Set((topicRes.data ?? []).map((r) => r.id))];

    // No enrolled students or no modules yet — an all-empty summary, no reads.
    if (studentIds.length === 0 || courseTopicIds.length === 0) {
      return buildDefenseSummary({
        generatedAt: new Date().toISOString(),
        vark: aggregateVarkUsage([]),
        adaptation: aggregateAdaptation({
          interactions: [],
          topicModalities: new Map(),
          effectiveVarkCategoryByUser: new Map(),
        }),
      });
    }

    const [profilesRes, interactionsRes, lessonsRes] = await Promise.all([
      supabaseAdmin
        .from("vark_profiles")
        .select(
          "user_id, assessment_completed_at, ml_predicted_category, ml_prediction_confidence, ml_model_version, predicted_category",
        )
        .in("user_id", studentIds)
        .limit(ROW_CAP),
      supabaseAdmin
        .from("learning_interactions")
        .select(
          "user_id, topic_id, event_type, modality, recommendation_source, score_percent, created_at",
        )
        .in("user_id", studentIds)
        .in("topic_id", courseTopicIds)
        .limit(ROW_CAP),
      supabaseAdmin
        .from("lessons")
        .select("topic_id, modality")
        .in("topic_id", courseTopicIds)
        .limit(ROW_CAP),
    ]);

    if (profilesRes.error || interactionsRes.error || lessonsRes.error) {
      console.error(
        `[getModelEvaluation] load failed: profiles=${profilesRes.error?.code ?? "ok"} ` +
          `interactions=${interactionsRes.error?.code ?? "ok"} lessons=${lessonsRes.error?.code ?? "ok"}`,
      );
      throw new Error("LOAD_FAILED");
    }

    const profiles: VarkProfileEvalRow[] = (profilesRes.data ?? []).map((r) => ({
      userId: r.user_id,
      assessmentCompletedAt: r.assessment_completed_at,
      mlPredictedCategory: r.ml_predicted_category,
      mlPredictionConfidence: r.ml_prediction_confidence,
      mlModelVersion: r.ml_model_version,
      predictedCategory: r.predicted_category,
    }));

    const interactions: InteractionEvalRow[] = (interactionsRes.data ?? []).map((r) => ({
      userId: r.user_id,
      topicId: r.topic_id,
      eventType: r.event_type,
      modality: r.modality,
      recommendationSource: r.recommendation_source,
      scorePercent: r.score_percent,
      createdAt: r.created_at,
    }));

    const topicModalities = new Map<string, LessonModality[]>();
    for (const l of lessonsRes.data ?? []) {
      if (!l.topic_id || !isModality(l.modality)) continue;
      const list = topicModalities.get(l.topic_id) ?? [];
      if (!list.includes(l.modality)) list.push(l.modality);
      topicModalities.set(l.topic_id, list);
    }

    // Belt-and-braces: re-assert the course scope on the pure side before any
    // aggregation runs (supabaseAdmin bypassed RLS, so nothing implicit filters).
    const scoped = scopeEvaluationInputs({
      studentIds,
      courseTopicIds,
      varkRows: profiles,
      interactionRows: interactions,
    });

    const vark = aggregateVarkUsage(scoped.varkRows);
    const adaptation = aggregateAdaptation({
      interactions: scoped.interactionRows,
      topicModalities,
      effectiveVarkCategoryByUser: effectiveVarkCategoryByUser(scoped.varkRows),
    });

    return buildDefenseSummary({
      generatedAt: new Date().toISOString(),
      vark,
      adaptation,
    });
  });
