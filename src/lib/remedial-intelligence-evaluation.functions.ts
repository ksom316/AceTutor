import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PerfAttempt } from "@/lib/quiz-performance";
import {
  REMEDIAL_INTERACTION_EVENT_TYPES,
  type RemedialIntelligenceFormat,
} from "@/lib/remedial-intelligence";
import { deriveRemedialFormatRecommendation } from "@/lib/remedial-adaptation";
import {
  buildRemedialIntelligenceEvaluation,
  toRemedialInterventionRecords,
  type RemedialIntelligenceEvaluation,
  type RemedialInteractionScopeRow,
  type StudyPathScopeRow,
} from "@/lib/remedial-intelligence-evaluation";

/**
 * R8.4 — the one aggregate feed behind /lecturer/remedial-evaluation.
 *
 * Same two boundaries as A8 (getModelEvaluation), because supabaseAdmin
 * bypasses RLS:
 *   1. AUTHORISATION — current_lecturer_course() must return a course id.
 *   2. DATA SCOPING — every service-role read is filtered to that course's
 *      enrolled students AND its own topics.
 *
 * EVERYTHING returned is aggregate: counts, sums, averages, evidence states,
 * format names. No user id, email, name, study-path id, attempt id, topic id,
 * quiz text, or UUID leaves this function — see
 * remedial-intelligence-evaluation.test.ts.
 *
 * It never retrains R8, never alters A7 / VARK / Mastery / grading / R4, and
 * reconstructs "who would currently get a history recommendation" with the
 * UNCHANGED pure R8.1 engine (deriveRemedialFormatRecommendation).
 */

const ROW_CAP = 50_000;

export const REMEDIAL_EVALUATION_ERRORS: Record<string, string> = {
  NOT_A_LECTURER: "Only a lecturer can view the remedial intelligence evaluation.",
  LOAD_FAILED: "Couldn't load the remedial evaluation right now. Please try again in a moment.",
};

export function remedialEvaluationErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return REMEDIAL_EVALUATION_ERRORS[raw] ?? REMEDIAL_EVALUATION_ERRORS.LOAD_FAILED;
}

type StudyPathRow = {
  id: string;
  user_id: string;
  topic_id: string | null;
  attempt_id: string | null;
  remedial_generated_at: string | null;
  remedial_video: unknown;
};

type AttemptRow = PerfAttempt & { user_id: string };

type InteractionRow = {
  user_id: string;
  study_path_id: string | null;
  event_type: string;
  remedial_format: string | null;
  recommended_remedial_format: string | null;
  recommendation_source: string | null;
  remedial_content_version: string | null;
  created_at: string;
};

function emptyEvaluation(generatedAt: string): RemedialIntelligenceEvaluation {
  return buildRemedialIntelligenceEvaluation({
    records: [],
    generatedAt,
    studyPathsWithRemedialContent: 0,
    studyPathsWithVideoRecommendation: 0,
    studentsWithHistoryRecommendation: 0,
    currentHistoryLeanings: [],
  });
}

export const getRemedialIntelligenceEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RemedialIntelligenceEvaluation> => {
    const { supabase } = context;
    const generatedAt = new Date().toISOString();

    // 1. Authorisation — course id derived server-side, never from the client.
    const { data: lecturerCourseId } = await supabase.rpc("current_lecturer_course");
    if (!lecturerCourseId) throw new Error("NOT_A_LECTURER");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 2. Data scoping — this course's enrolled students + this course's topics.
    const [enrollRes, topicRes] = await Promise.all([
      supabaseAdmin.from("enrollments").select("user_id").eq("course_id", lecturerCourseId),
      supabaseAdmin.from("topics").select("id").eq("course_id", lecturerCourseId),
    ]);
    if (enrollRes.error || topicRes.error) {
      console.error(
        `[getRemedialIntelligenceEvaluation] scope load failed: enrollments=${
          enrollRes.error?.code ?? "ok"
        } topics=${topicRes.error?.code ?? "ok"}`,
      );
      throw new Error("LOAD_FAILED");
    }
    const studentIds = [...new Set((enrollRes.data ?? []).map((r) => r.user_id))];
    const courseTopicIds = [...new Set((topicRes.data ?? []).map((r) => r.id))];

    if (studentIds.length === 0 || courseTopicIds.length === 0) {
      return emptyEvaluation(generatedAt);
    }

    const [pathRes, attemptRes, interactionRes] = await Promise.all([
      supabaseAdmin
        .from("study_paths")
        .select("id, user_id, topic_id, attempt_id, remedial_generated_at, remedial_video")
        .in("user_id", studentIds)
        .in("topic_id", courseTopicIds)
        .limit(ROW_CAP),
      supabaseAdmin
        .from("quiz_attempts")
        .select("id, user_id, topic_id, score, total, finished_at, answered_count, started_at")
        .in("user_id", studentIds)
        .in("topic_id", courseTopicIds)
        .limit(ROW_CAP),
      supabaseAdmin
        .from("learning_interactions")
        .select(
          "user_id, study_path_id, event_type, remedial_format, recommended_remedial_format, recommendation_source, remedial_content_version, created_at",
        )
        .in("user_id", studentIds)
        .in("topic_id", courseTopicIds)
        .in("event_type", REMEDIAL_INTERACTION_EVENT_TYPES as unknown as string[])
        .limit(ROW_CAP),
    ]);

    if (pathRes.error || attemptRes.error || interactionRes.error) {
      console.error(
        `[getRemedialIntelligenceEvaluation] load failed: paths=${
          pathRes.error?.code ?? "ok"
        } attempts=${attemptRes.error?.code ?? "ok"} interactions=${
          interactionRes.error?.code ?? "ok"
        }`,
      );
      throw new Error("LOAD_FAILED");
    }

    const pathRows = (pathRes.data ?? []) as unknown as StudyPathRow[];
    const attemptRows = (attemptRes.data ?? []) as unknown as AttemptRow[];
    const interactionRows = (interactionRes.data ?? []) as unknown as InteractionRow[];

    // Belt-and-braces: re-assert the course scope on the pure side (supabaseAdmin
    // bypassed RLS, so nothing implicit filters).
    const students = new Set(studentIds);
    const topics = new Set(courseTopicIds);
    const scopedPaths = pathRows.filter(
      (p) => students.has(p.user_id) && p.topic_id != null && topics.has(p.topic_id),
    );
    const scopedAttempts = attemptRows.filter(
      (a) => students.has(a.user_id) && a.topic_id != null && topics.has(a.topic_id),
    );
    const scopedInteractions = interactionRows.filter((r) => students.has(r.user_id));

    const toScopeStudyPaths = (rows: StudyPathRow[]): StudyPathScopeRow[] =>
      rows.map((p) => ({ id: p.id, topicId: p.topic_id, attemptId: p.attempt_id }));
    const toScopeInteractions = (rows: InteractionRow[]): RemedialInteractionScopeRow[] =>
      rows.map((r) => ({
        studyPathId: r.study_path_id,
        eventType: r.event_type,
        remedialFormat: r.remedial_format,
        recommendedFormat: r.recommended_remedial_format,
        recommendationSource: r.recommendation_source,
        contentVersion: r.remedial_content_version,
        createdAt: r.created_at,
      }));

    // Course-wide records for every aggregate.
    const records = toRemedialInterventionRecords({
      studyPaths: toScopeStudyPaths(scopedPaths),
      moduleAttempts: scopedAttempts,
      interactions: toScopeInteractions(scopedInteractions),
    });

    // Distinct students whose logged events already include a history-sourced
    // recommendation.
    const studentsWithHistoryRecommendation = new Set(
      scopedInteractions.filter((r) => r.recommendation_source === "history").map((r) => r.user_id),
    ).size;

    // "Who WOULD currently get a history recommendation" — re-run the unchanged
    // R8.1 engine per student. Only the confidence + format leave the loop.
    const leanings: { confidence: "medium" | "high"; format: RemedialIntelligenceFormat }[] = [];
    for (const uid of studentIds) {
      const perStudent = toRemedialInterventionRecords({
        studyPaths: toScopeStudyPaths(scopedPaths.filter((p) => p.user_id === uid)),
        moduleAttempts: scopedAttempts.filter((a) => a.user_id === uid),
        interactions: toScopeInteractions(scopedInteractions.filter((r) => r.user_id === uid)),
      });
      const lean = deriveRemedialFormatRecommendation(perStudent);
      if (
        (lean.confidence === "medium" || lean.confidence === "high") &&
        lean.preferredFormat != null
      ) {
        leanings.push({ confidence: lean.confidence, format: lean.preferredFormat });
      }
    }

    const studyPathsWithRemedialContent = scopedPaths.filter(
      (p) => p.remedial_generated_at != null,
    ).length;
    const studyPathsWithVideoRecommendation = scopedPaths.filter(
      (p) => p.remedial_video != null,
    ).length;

    return buildRemedialIntelligenceEvaluation({
      records,
      generatedAt,
      studyPathsWithRemedialContent,
      studyPathsWithVideoRecommendation,
      studentsWithHistoryRecommendation,
      currentHistoryLeanings: leanings,
    });
  });
