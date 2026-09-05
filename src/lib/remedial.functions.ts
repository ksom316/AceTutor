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
import {
  resolveRecommendedRemedialModality,
  type RemedialModalityResolution,
} from "@/lib/remedial-modality";
import {
  parseRemedialContent,
  remedialContentSchema,
  type RemedialContent,
} from "@/lib/remedial-content";

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

async function resolveRemedialModalityForStudyPath(
  supabase: SupabaseClient<Database>,
  userId: string,
  topicId: string | null,
): Promise<RemedialModalityResolution> {
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

  return resolveRecommendedRemedialModality({
    adaptive,
    varkModality,
    lessonFormatPreference: prefs?.lesson_format ?? null,
  });
}

/* ---------------- load + validate the Study Path ---------------- */

type StudyPathRemedialRow = {
  id: string;
  user_id: string;
  topic_id: string | null;
  course_id: string;
  weak_question_ids: string[] | null;
  content: unknown;
  remedial_content: unknown;
  remedial_modality: string | null;
  remedial_generated_at: string | null;
};

async function loadOwnStudyPath(
  supabase: SupabaseClient<Database>,
  userId: string,
  studyPathId: string,
) {
  const { data, error } = await supabase
    .from("study_paths")
    .select(
      "id, user_id, topic_id, course_id, weak_question_ids, content, remedial_content, remedial_modality, remedial_generated_at",
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

const REMEDIAL_MAX_TOKENS = 1400;

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
    `stay correct. Be concise; avoid filler. Respond with strict JSON only — no prose, no code fences.`;

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
    `{ "title": string, "weakConcepts": string[], "summary": string, "explanation": string, "workedExample": string, "keyPoints": string[], "practicePrompt": string }`,
    "- weakConcepts: echo the concept names you are teaching.",
    "- summary: 1–2 sentences naming the misunderstanding.",
    "- explanation: the core teaching, ~120–250 words, focused on the weak concepts.",
    "- workedExample: optional; include only if it aids understanding.",
    "- keyPoints: 3–6 short bullet takeaways.",
    "- practicePrompt: optional; one open reflection/practice question (NOT a quiz answer).",
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

export type RemedialRecommendationResult = RemedialModalityResolution;

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
  modality: RemedialModalityResolution["modality"];
  modalitySource: RemedialModalityResolution["source"];
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
            (row.remedial_modality as RemedialModalityResolution["modality"] | null) ??
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
    let missedQuestionPrompts: string[] = [];
    const weakIds = (row.weak_question_ids ?? []).filter((x): x is string => typeof x === "string");
    if (weakIds.length > 0) {
      const { data: qs } = await supabase
        .from("questions")
        .select("id, prompt")
        .in("id", weakIds.slice(0, 20));
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
