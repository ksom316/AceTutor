import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { LessonModality } from "@/lib/lesson-shared";
import type { VarkCategory } from "@/lib/vark";
import { callAI } from "@/lib/course-chat.functions";
import { buildModuleMaterial, studyPathContentSchema } from "@/lib/study-path.functions";
import { type LessonForCapability, MIN_ANALYSABLE_CHARS } from "@/lib/quiz-capability";
import { resolveAdaptiveModalityRecommendation } from "@/lib/adaptive-modality.functions";
import {
  resolveEffectiveVarkCategory,
  resolveVarkContentRecommendation,
} from "@/lib/vark-content-recommendation";
import type { RemedialModality } from "@/lib/remedial-modality";
import { deriveRemedialFormatRecommendation } from "@/lib/remedial-adaptation";
import {
  REMEDIAL_INTERACTION_EVENT_TYPES,
  type RemedialInterventionRecord,
} from "@/lib/remedial-intelligence";
import { toRemedialInterventionRecords } from "@/lib/remedial-intelligence-evaluation";
import {
  resolveRemedialRecommendation,
  type RemedialRecommendation,
} from "@/lib/remedial-recommendation";
import type { PerfAttempt } from "@/lib/quiz-performance";
import {
  parseRemedialContent,
  remedialContentSchema,
  type RemedialContent,
} from "@/lib/remedial-content";
import { REMEDIAL_VISUAL_PROMPT_SHAPES } from "@/lib/remedial-visual-spec";

/**
 * R1 — Adaptive Remedial Content Core.
 *
 * Builds ON TOP OF the existing Study Path: for a Study Path that already
 * identified weak concepts, generate ONE short, personalized remedial
 * explanation of those concepts, grounded in the module material and the
 * Study Path's own weak areas. It NEVER changes VARK, Learning Preferences,
 * A7 rewards/thresholds, Mastery, grading, or official quiz state.
 *
 * Security: `studyPathId` is the only client input; the row is loaded through
 * the RLS-scoped `context.supabase` (a Study Path that isn't the caller's
 * simply isn't returned) with a `user_id` re-check for defense in depth. The
 * AI receives module material + weak concepts only — no user id, email, raw
 * analytics history, or official quiz answers.
 */

export const REMEDIAL_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to generate a personalized explanation.",
  STUDY_PATH_NOT_FOUND: "We couldn't find that Study Path.",
  STUDY_PATH_NOT_OWNED: "That Study Path isn't yours.",
  STUDY_PATH_INVALID: "That Study Path's content can't be read.",
  COURSE_MISMATCH: "That Study Path's course/module link is invalid.",
  AI_GENERATION_FAILED:
    "AceTutor couldn't build your explanation right now. Please try again in a moment.",
  INVALID_AI_RESPONSE: "AceTutor's explanation came back unreadable. Please try again.",
  SAVE_FAILED: "Your explanation was generated but couldn't be saved. Please try again.",
};

const CODES = new Set(Object.keys(REMEDIAL_ERRORS));

export function remedialErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return CODES.has(raw) ? REMEDIAL_ERRORS[raw] : REMEDIAL_ERRORS.AI_GENERATION_FAILED;
}

/* ---------------- shared: recommended remedial modality ---------------- */

const ALL_MODALITIES: readonly LessonModality[] = ["video", "slides", "audio", "text"];

/** Remedial formats the Study Path can always present (all three are generated
 *  from the same saved content — never a stocked lesson). */
const AVAILABLE_REMEDIAL_FORMATS: readonly RemedialModality[] = ["text", "audio", "visual"];

/**
 * R8.3 — assemble this student's OWN remedial-intervention history
 * (`RemedialInterventionRecord[]`) from data that already exists, for the R8.1
 * engine. READ-ONLY, RLS-scoped, and best-effort: any failure yields `[]`, so
 * the recommendation silently falls back to the existing A7 / VARK /
 * preference / default chain. It writes nothing and never throws.
 *
 * The row → record mapping (including the shared "sufficient attempt" bar) is
 * `toRemedialInterventionRecords` — the SAME mapper the lecturer R8.4 feed
 * uses, so the two can never drift.
 */
async function buildStudentRemedialHistory(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<RemedialInterventionRecord[]> {
  try {
    const [{ data: paths }, { data: attempts }, { data: events }] = await Promise.all([
      supabase.from("study_paths").select("id, topic_id, attempt_id").eq("user_id", userId),
      supabase
        .from("quiz_attempts")
        .select("id, topic_id, score, total, finished_at, answered_count, started_at")
        .eq("user_id", userId)
        .not("topic_id", "is", null)
        .not("finished_at", "is", null),
      supabase
        .from("learning_interactions")
        .select(
          "study_path_id, event_type, remedial_format, recommended_remedial_format, recommendation_source, remedial_content_version, created_at",
        )
        .eq("user_id", userId)
        .in("event_type", REMEDIAL_INTERACTION_EVENT_TYPES as unknown as string[]),
    ]);

    return toRemedialInterventionRecords({
      studyPaths: (
        (paths ?? []) as { id: string; topic_id: string | null; attempt_id: string | null }[]
      ).map((p) => ({ id: p.id, topicId: p.topic_id, attemptId: p.attempt_id })),
      moduleAttempts: (attempts ?? []) as unknown as PerfAttempt[],
      interactions: (
        (events ?? []) as {
          study_path_id: string | null;
          event_type: string;
          remedial_format: string | null;
          recommended_remedial_format: string | null;
          recommendation_source: string | null;
          remedial_content_version: string | null;
          created_at: string;
        }[]
      ).map((e) => ({
        studyPathId: e.study_path_id,
        eventType: e.event_type,
        remedialFormat: e.remedial_format,
        recommendedFormat: e.recommended_remedial_format,
        recommendationSource: e.recommendation_source,
        contentVersion: e.remedial_content_version,
        createdAt: e.created_at,
      })),
    });
  } catch (e) {
    console.error(
      `[buildStudentRemedialHistory] failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

async function resolveRemedialModalityForStudyPath(
  supabase: SupabaseClient<Database>,
  userId: string,
  topicId: string | null,
): Promise<RemedialRecommendation> {
  // A7 adaptive recommendation (topic-scoped; skipped for course-level paths).
  let adaptive: { modality: LessonModality | null; source: "vark" | "adaptive" } | null = null;
  if (topicId) {
    try {
      const a = await resolveAdaptiveModalityRecommendation(supabase, userId, topicId);
      adaptive = { modality: a.modality, source: a.source };
    } catch {
      adaptive = null; // A7 failure never blocks remedial content
    }
  }

  // A4 / VARK content modality, independent of what lesson formats the topic
  // happens to stock (remedial content is generated, not an existing lesson).
  const { data: profile } = await supabase
    .from("vark_profiles")
    .select("ml_predicted_category, predicted_category")
    .eq("user_id", userId)
    .maybeSingle();
  const effectiveCategory = resolveEffectiveVarkCategory(
    profile
      ? {
          ml_predicted_category: profile.ml_predicted_category as VarkCategory | null,
          predicted_category: profile.predicted_category as VarkCategory | null,
        }
      : null,
  );
  const varkModality =
    resolveVarkContentRecommendation(effectiveCategory, ALL_MODALITIES)?.modality ?? null;

  // Explicit Learning Preference — lesson_format is the only modality-bearing one.
  const { data: prefs } = await supabase
    .from("learning_preferences")
    .select("lesson_format")
    .eq("user_id", userId)
    .maybeSingle();

  // R8 — the student's own remedial-success history. Only overrides the chain
  // above at medium/high confidence (resolveRemedialRecommendation enforces
  // that); an empty / low-confidence history changes nothing.
  const remedialAdaptation = deriveRemedialFormatRecommendation(
    await buildStudentRemedialHistory(supabase, userId),
  );

  return resolveRemedialRecommendation({
    remedialAdaptation,
    adaptiveRecommendation: adaptive,
    varkRecommendation: varkModality,
    preferredModality: prefs?.lesson_format ?? null,
    availableModalities: AVAILABLE_REMEDIAL_FORMATS,
  });
}

/* ---------------- load + validate the Study Path ---------------- */

export type StudyPathRemedialRow = {
  id: string;
  user_id: string;
  topic_id: string | null;
  course_id: string;
  weak_question_ids: string[] | null;
  content: unknown;
  remedial_content: unknown;
  remedial_modality: string | null;
  remedial_generated_at: string | null;
  remedial_video: unknown;
  remedial_video_generated_at: string | null;
};

/** Load one Study Path the caller OWNS (RLS-scoped client + explicit user_id
 *  re-check) and validate its `content`. Shared by R1 and R6. */
export async function loadOwnStudyPath(
  supabase: SupabaseClient<Database>,
  userId: string,
  studyPathId: string,
) {
  const { data, error } = await supabase
    .from("study_paths")
    .select(
      "id, user_id, topic_id, course_id, weak_question_ids, content, remedial_content, remedial_modality, remedial_generated_at, remedial_video, remedial_video_generated_at",
    )
    .eq("id", studyPathId)
    .maybeSingle();

  if (error || !data) throw new Error("STUDY_PATH_NOT_FOUND");
  const row = data as unknown as StudyPathRemedialRow;
  if (row.user_id !== userId) throw new Error("STUDY_PATH_NOT_OWNED"); // defense in depth

  const parsedContent = studyPathContentSchema.safeParse(row.content);
  if (!parsedContent.success) throw new Error("STUDY_PATH_INVALID");

  return { row, content: parsedContent.data };
}

/* ---------------- AI generation ---------------- */

const REMEDIAL_MAX_TOKENS = 1800;

type RemedialPayload = {
  scope: "module" | "course";
  contextTitle: string;
  contextSummary: string | null;
  material: string;
  /** The Study Path's own distilled weak areas (title + short explanation). */
  weakAreas: { title: string; explanation: string }[];
  /** Prompts (NOT answers) of the officially-missed questions, for grounding. */
  missedQuestionPrompts: string[];
};

async function runRemedialGeneration(
  payload: RemedialPayload,
  fallbackConcepts: string[],
): Promise<RemedialContent> {
  const unit = payload.scope === "course" ? "course" : "module";
  const system =
    `You write ONE short remedial explanation for a university student who answered specific ` +
    `concepts incorrectly on a ${unit} quiz. Teach ONLY the listed weak concept(s) — do not ` +
    `summarise the whole ${unit}. Use plain, accurate university-level language and connect the ` +
    `explanation to this ${unit}. Include one worked example when it genuinely helps understanding. ` +
    `Do NOT restate or reveal the quiz's correct answers as a cheat sheet. Do NOT assert facts that ` +
    `the supplied material does not support — use general subject knowledge only to fill gaps, and ` +
    `stay correct. Be concise; avoid filler. You may also return ONE small "visual" structure that ` +
    `mirrors the concept's real shape (a sorting sequence, ordered process, layered hierarchy, ` +
    `side-by-side comparison, table, indexed array, or linked structure). Base it ONLY on what the ` +
    `material and weak concepts support; never invent technical relationships just to draw something; ` +
    `keep it short. If no specialised structure genuinely fits, use { "type": "concept-map" } or omit ` +
    `"visual". In the "explanation" and "workedExample" prose, use short bullet lists or ` +
    `step-by-step lines rather than Markdown pipe tables. Respond with strict JSON only — no prose, no code fences.`;

  const user = [
    `${payload.scope === "course" ? "COURSE" : "MODULE"}: ${payload.contextTitle}`,
    `DESCRIPTION: ${payload.contextSummary || "(none)"}`,
    "",
    `${payload.scope === "course" ? "COURSE" : "MODULE"} MATERIAL (prefer this; may be empty):`,
    "<<<",
    payload.material ||
      "(no written material available — rely on your own knowledge of the subject)",
    ">>>",
    "",
    "WEAK CONCEPTS TO TEACH (the ONLY things to explain):",
    JSON.stringify(payload.weakAreas, null, 2),
    "",
    ...(payload.missedQuestionPrompts.length
      ? [
          "The student missed questions on these topics (prompts only — no answers; for grounding):",
          JSON.stringify(payload.missedQuestionPrompts.slice(0, 12), null, 2),
          "",
        ]
      : []),
    "Respond ONLY with JSON of exactly this shape:",
    `{ "title": string, "weakConcepts": string[], "summary": string, "explanation": string, "workedExample": string, "keyPoints": string[], "practicePrompt": string, "visual": object }`,
    "- weakConcepts: echo the concept names you are teaching.",
    "- summary: 1–2 sentences naming the misunderstanding.",
    "- explanation: the core teaching, ~120–250 words, focused on the weak concepts.",
    "- workedExample: optional; include only if it aids understanding.",
    "- keyPoints: 3–6 short bullet takeaways.",
    "- practicePrompt: optional; one open reflection/practice question (NOT a quiz answer).",
    "- visual: optional; ONE of the following shapes, whichever fits the concept (or omit):",
    REMEDIAL_VISUAL_PROMPT_SHAPES,
    "  keep every list short (≤12 items), strings brief; only content the material supports.",
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const attempt = async (jsonMode: boolean) => {
    const raw = await callAI(
      messages,
      jsonMode
        ? { jsonObject: true, maxTokens: REMEDIAL_MAX_TOKENS }
        : { maxTokens: REMEDIAL_MAX_TOKENS },
    );
    return parseRemedialContent(raw, fallbackConcepts);
  };

  let content: RemedialContent | null = null;
  try {
    content = await attempt(true);
  } catch (e) {
    console.error(
      `[generateRemedialLesson] AI call (json mode) failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!content) {
    try {
      content = await attempt(false);
    } catch (e) {
      console.error(
        `[generateRemedialLesson] AI call (plain mode) failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw new Error("AI_GENERATION_FAILED");
    }
  }
  if (!content) throw new Error("INVALID_AI_RESPONSE");
  return content;
}

/* ---------------- server fns ---------------- */

const recommendationInput = z.object({ studyPathId: z.string().uuid() });

export type RemedialRecommendationResult = RemedialRecommendation;

/** The recommended remedial format for a Study Path — cheap, no AI. Used by the
 *  UI to show "Recommended for you: …" and to default the format toggle. */
export const getRemedialRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recommendationInput.parse(input))
  .handler(async ({ data, context }): Promise<RemedialRecommendationResult> => {
    const { supabase, userId } = context;
    const { row } = await loadOwnStudyPath(supabase, userId, data.studyPathId);
    return resolveRemedialModalityForStudyPath(supabase, userId, row.topic_id);
  });

const generateInput = z.object({
  studyPathId: z.string().uuid(),
  regenerate: z.boolean().optional(),
});

export type RemedialLessonResult = {
  status: "existing" | "created";
  content: RemedialContent;
  modality: RemedialRecommendation["modality"];
  modalitySource: RemedialRecommendation["source"];
  generatedAt: string;
};

export const generateRemedialLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateInput.parse(input))
  .handler(async ({ data, context }): Promise<RemedialLessonResult> => {
    const { supabase, userId } = context;
    const { row, content: studyPathContent } = await loadOwnStudyPath(
      supabase,
      userId,
      data.studyPathId,
    );

    const recommendation = await resolveRemedialModalityForStudyPath(
      supabase,
      userId,
      row.topic_id,
    );

    // Reuse cached content unless the student explicitly asked to regenerate.
    if (!data.regenerate && row.remedial_content && row.remedial_generated_at) {
      const cached = remedialContentSchema.safeParse(row.remedial_content);
      if (cached.success) {
        return {
          status: "existing",
          content: cached.data,
          modality:
            (row.remedial_modality as RemedialRecommendation["modality"] | null) ??
            recommendation.modality,
          modalitySource: recommendation.source,
          generatedAt: row.remedial_generated_at,
        };
      }
    }

    // --- grounding: module context + lecturer material ---
    const scope: "module" | "course" = row.topic_id ? "module" : "course";
    let contextTitle = studyPathContent.title;
    let contextSummary: string | null = null;
    let material = "";

    if (row.topic_id) {
      const [{ data: topic }, { data: lessons }] = await Promise.all([
        supabase
          .from("topics")
          .select("title, summary, course_id")
          .eq("id", row.topic_id)
          .maybeSingle(),
        supabase
          .from("lessons")
          .select("modality, title, body_md, order_index")
          .eq("topic_id", row.topic_id)
          .order("order_index"),
      ]);
      if (topic && topic.course_id !== row.course_id) throw new Error("COURSE_MISMATCH");
      contextTitle = topic?.title ?? contextTitle;
      contextSummary = (topic?.summary ?? "").trim() || null;
      material = buildModuleMaterial((lessons ?? []) as LessonForCapability[]);
    } else {
      const [{ data: course }, { data: lessons }] = await Promise.all([
        supabase.from("courses").select("title, summary").eq("id", row.course_id).maybeSingle(),
        supabase
          .from("lessons")
          .select("modality, title, body_md, order_index, topics!inner(course_id)")
          .eq("topics.course_id", row.course_id)
          .order("order_index"),
      ]);
      contextTitle = course?.title ?? contextTitle;
      contextSummary = (course?.summary ?? "").trim() || null;
      material = buildModuleMaterial((lessons ?? []) as unknown as LessonForCapability[]);
    }

    // Missed-question PROMPTS only (never choices or the correct answer).
    // Students have no direct read on `questions` (SEC-01); get_question_prompts()
    // is a SECURITY DEFINER RPC that returns ONLY prompts (same sensitivity as
    // get_quiz_questions()) — this function still touches no service-role client.
    let missedQuestionPrompts: string[] = [];
    const weakIds = (row.weak_question_ids ?? []).filter((x): x is string => typeof x === "string");
    if (weakIds.length > 0) {
      const { data: qs } = await supabase.rpc("get_question_prompts", {
        _question_ids: weakIds.slice(0, 20),
      });
      missedQuestionPrompts = ((qs ?? []) as { prompt: string | null }[])
        .map((q) => (q.prompt ?? "").trim())
        .filter((p) => p.length > 0);
    }

    const weakAreas = studyPathContent.weakAreas.map((a) => ({
      title: a.title,
      explanation: a.explanation.slice(0, 600),
    }));
    const fallbackConcepts = weakAreas.map((a) => a.title);

    if (material.length < MIN_ANALYSABLE_CHARS && !contextSummary && weakAreas.length === 0) {
      // Nothing to teach from — but a Study Path always has >=1 weak area, so
      // this only guards a corrupt row. Surface as a generation failure (retry).
      throw new Error("INVALID_AI_RESPONSE");
    }

    const content = await runRemedialGeneration(
      { scope, contextTitle, contextSummary, material, weakAreas, missedQuestionPrompts },
      fallbackConcepts,
    );

    const { data: saved, error: sErr } = await supabase.rpc("save_study_path_remedial", {
      _study_path_id: row.id,
      _content: content as unknown as Database["public"]["Tables"]["study_paths"]["Row"]["content"],
      _modality: recommendation.modality,
    });
    if (sErr || !saved) {
      const code = (sErr?.message || "").trim();
      throw new Error(CODES.has(code) ? code : "SAVE_FAILED");
    }

    return {
      status: "created",
      content,
      modality: recommendation.modality,
      modalitySource: recommendation.source,
      generatedAt: new Date().toISOString(),
    };
  });
