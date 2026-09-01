import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { callAI } from "@/lib/course-chat.functions";
import {
  classifyLessonSource,
  type LessonForCapability,
  MIN_ANALYSABLE_CHARS,
} from "@/lib/quiz-capability";

/**
 * Server-side AI "Personalized Study Path" generation (Phase 2 — backend only,
 * no UI yet).
 *
 * A study path is a SHORT, module-specific remedial mini-course built from the
 * exact questions a student got wrong on a finished module quiz. It reuses the
 * shared OpenRouter caller (`callAI` from course-chat.functions.ts) — no second
 * AI client, no duplicated key handling / model roster / hedging / timeouts.
 *
 * Security: the attempt id is the ONLY client input. Ownership + the module are
 * derived server-side from the caller's own quiz_attempts row (the RLS-scoped
 * `context.supabase` only ever returns the caller's attempts), and the write
 * goes through the SECURITY DEFINER `save_study_path` RPC which re-derives them
 * again and enforces UNIQUE(attempt_id). The AI never receives a user id, email,
 * auth data, or unrelated quiz history — only the module material and the
 * incorrect questions.
 *
 * Cost control: no weak answers → no AI call. An existing path for the attempt →
 * no AI call (returned as-is). A new weak attempt → exactly one generation.
 */

/* ---- error codes → friendly messages (mirrors PERF_ANALYSIS_ERRORS) ---- */

export const STUDY_PATH_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to generate a study path.",
  ATTEMPT_NOT_FOUND: "We couldn't find that quiz attempt.",
  ATTEMPT_NOT_OWNED: "That quiz attempt isn't yours.",
  ATTEMPT_NOT_LINKED: "That quiz attempt isn't linked to a quiz.",
  COURSE_NOT_FOUND: "We couldn't find the course for that quiz.",
  ATTEMPT_NOT_FINISHED: "Finish and submit the quiz before generating a study path.",
  NO_WEAK_AREAS: "You didn't miss any questions on this attempt — no study path is needed.",
  INSUFFICIENT_CONTENT: "There isn't enough written material yet to build a study path.",
  AI_GENERATION_FAILED:
    "AceTutor couldn't build your study path right now. Please try again in a moment.",
  INVALID_AI_RESPONSE: "AceTutor's study path came back unreadable. Please try again.",
  SAVE_FAILED: "Your study path was generated but couldn't be saved. Please try again.",
};

const CODES = new Set(Object.keys(STUDY_PATH_ERRORS));

/** Map a thrown server error to a friendly message; never leak raw errors. */
export function studyPathErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return CODES.has(raw) ? STUDY_PATH_ERRORS[raw] : STUDY_PATH_ERRORS.AI_GENERATION_FAILED;
}

/* ---- study path content contract (persisted as study_paths.content) ---- */

export const practiceItemSchema = z.object({
  question: z.string().trim().min(1).max(600),
  answer: z.string().trim().min(1).max(1500),
});

export const weakAreaSchema = z.object({
  title: z.string().trim().min(1).max(120),
  explanation: z.string().trim().min(1).max(2500),
  example: z.string().trim().min(1).max(2500),
  practice: z.array(practiceItemSchema).min(1).max(3),
});

export const studyPathContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  weakAreas: z.array(weakAreaSchema).min(1).max(4),
});

export type PracticeItem = z.infer<typeof practiceItemSchema>;
export type WeakArea = z.infer<typeof weakAreaSchema>;
export type StudyPathContent = z.infer<typeof studyPathContentSchema>;

export type StudyPathRow = {
  id: string;
  user_id: string;
  /** Null for a course-level (General Course Quiz) study path. */
  topic_id: string | null;
  course_id: string;
  attempt_id: string;
  weak_question_ids: string[];
  content: StudyPathContent;
  created_at: string;
  /** Non-null once the student has added it to "My Learning". */
  saved_at: string | null;
  completed_at: string | null;
};

export type GenerateStudyPathResult =
  | { status: "created"; studyPath: StudyPathRow }
  | { status: "existing"; studyPath: StudyPathRow }
  | { status: "not-needed" };

/* ---- input ---- */

const inputSchema = z.object({ attemptId: z.string().uuid() });

/* ---- module material (same capability rule as the quiz generator) ---- */

const MATERIAL_CHAR_CAP = 12_000;
const PER_LESSON_CHAR_CAP = 5_000;

function buildModuleMaterial(lessons: LessonForCapability[]): string {
  const parts: string[] = [];
  for (const l of lessons) {
    const info = classifyLessonSource(l);
    if (info.status !== "analysed" && info.status !== "summary") continue;
    const body = (l.body_md ?? "").trim().slice(0, PER_LESSON_CHAR_CAP);
    if (!body) continue;
    parts.push(`## ${info.title}\n\n${body}`);
  }
  return parts.join("\n\n---\n\n").slice(0, MATERIAL_CHAR_CAP);
}

/* ---- defensive JSON extraction + validation ---- */

function extractJsonObject(raw: string): string {
  const s = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}

/** Parse a model reply into validated content, or null if nothing usable
 *  survives. Individually-malformed weak areas are dropped, like the quiz
 *  generator's parseQuestions(). */
function parseStudyPath(
  raw: string,
  defaultTitle = "Personalized Study Path",
): StudyPathContent | null {
  if (!raw || !raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const rawAreas = Array.isArray(obj.weakAreas)
    ? obj.weakAreas
    : Array.isArray(obj.weak_areas)
      ? obj.weak_areas
      : [];

  const areas: WeakArea[] = [];
  for (const a of rawAreas) {
    if (areas.length >= 4) break;
    if (a && typeof a === "object" && !Array.isArray(a)) {
      const rec = a as Record<string, unknown>;
      if (Array.isArray(rec.practice)) rec.practice = rec.practice.slice(0, 3);
    }
    const r = weakAreaSchema.safeParse(a);
    if (r.success) areas.push(r.data);
  }
  if (areas.length === 0) return null;

  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim().slice(0, 120)
      : defaultTitle;

  const final = studyPathContentSchema.safeParse({ title, weakAreas: areas });
  return final.success ? final.data : null;
}

/* ---- AI generation ---- */

const STUDY_PATH_MAX_TOKENS = 1800;

type AiIncorrectQuestion = {
  question: string;
  choices: string[];
  correctAnswer: string;
  explanation: string;
};

type AiPayload = {
  /** "module" for a single-module quiz, "course" for a General Course Quiz. */
  scope: "module" | "course";
  moduleTitle: string;
  moduleSummary: string | null;
  material: string;
  incorrectQuestions: AiIncorrectQuestion[];
};

async function runGeneration(payload: AiPayload): Promise<StudyPathContent> {
  const unit = payload.scope === "course" ? "course" : "module";
  const system =
    `You build a SHORT, targeted remedial study path for ONE university ${unit}. You are given the ` +
    `EXACT questions a student answered incorrectly, plus the ${unit}'s own material. Group the ` +
    "incorrect questions into at most 4 concepts; name each concept; and for each write a brief " +
    "explanation, one worked example, and 1 to 3 short self-check practice questions with answers. " +
    (payload.scope === "course"
      ? "Spread the concepts across the different modules the incorrect questions touch rather than one. "
      : "") +
    "Rules: only cover concepts that are directly evidenced by the supplied incorrect questions — " +
    "never invent a weakness they do not show, and never claim the student is weak in an area not " +
    `shown by those questions. Do not write a full replacement ${unit}. Prefer the supplied ` +
    "material; use general knowledge of the subject only to fill gaps. Keep every section concise. " +
    "Respond with strict JSON only — no prose, no code fences.";

  const defaultTitle =
    payload.scope === "course" ? "General Quiz Review" : "Personalized Study Path";

  const user = [
    `${payload.scope === "course" ? "COURSE" : "MODULE"}: ${payload.moduleTitle}`,
    `DESCRIPTION: ${payload.moduleSummary || "(none)"}`,
    "",
    `${payload.scope === "course" ? "COURSE" : "MODULE"} MATERIAL (prefer this; may be empty):`,
    "<<<",
    payload.material ||
      "(no written material available — rely on your own knowledge of the subject)",
    ">>>",
    "",
    "INCORRECT QUESTIONS (the ONLY evidence of weakness — do not go beyond these):",
    JSON.stringify(payload.incorrectQuestions, null, 2),
    "",
    "Respond ONLY with JSON of exactly this shape:",
    `{ "title": "${defaultTitle}", "weakAreas": [ { "title": string, "explanation": string, "example": string, "practice": [ { "question": string, "answer": string } ] } ] }`,
    "- At most 4 weakAreas; 1 to 3 practice items each.",
    "- Keep each explanation and example under about 120 words.",
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const attempt = async (jsonMode: boolean): Promise<StudyPathContent | null> => {
    const raw = await callAI(
      messages,
      jsonMode
        ? { jsonObject: true, maxTokens: STUDY_PATH_MAX_TOKENS }
        : { maxTokens: STUDY_PATH_MAX_TOKENS },
    );
    return parseStudyPath(raw, defaultTitle);
  };

  let content: StudyPathContent | null = null;
  try {
    content = await attempt(true);
  } catch (e) {
    console.error(
      `[generateStudyPath] AI call (json mode) failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!content) {
    // Free models often ignore response_format:json_object — retry once plain.
    try {
      content = await attempt(false);
    } catch (e) {
      console.error(
        `[generateStudyPath] AI call (plain mode) failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw new Error("AI_GENERATION_FAILED");
    }
  }

  if (!content) throw new Error("INVALID_AI_RESPONSE");
  return content;
}

/* ---- server function ---- */

export const generateStudyPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateStudyPathResult> => {
    const { supabase, userId } = context;
    const { attemptId } = data;

    // 1-5. Load + verify the attempt. `supabase` here is RLS-scoped to the
    // caller, so another student's attempt id simply returns nothing. A module
    // attempt carries topic_id; a General Course Quiz attempt carries
    // course_quiz_id — both are supported.
    const { data: attempt, error: aErr } = await supabase
      .from("quiz_attempts")
      .select("id, user_id, topic_id, course_quiz_id, finished_at")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr || !attempt) throw new Error("ATTEMPT_NOT_FOUND");
    if (attempt.user_id !== userId) throw new Error("ATTEMPT_NOT_OWNED"); // defense in depth
    if (!attempt.finished_at) throw new Error("ATTEMPT_NOT_FINISHED");
    const moduleTopicId: string | null = attempt.topic_id;
    const generalQuizId: string | null = moduleTopicId ? null : attempt.course_quiz_id;
    if (!moduleTopicId && !generalQuizId) throw new Error("ATTEMPT_NOT_LINKED");

    // 6. Existing study path for this attempt → return it, no AI call.
    const { data: existing } = await supabase
      .from("study_paths")
      .select(
        "id, user_id, topic_id, course_id, attempt_id, weak_question_ids, content, created_at, saved_at, completed_at",
      )
      .eq("attempt_id", attemptId)
      .maybeSingle();
    if (existing) {
      return { status: "existing", studyPath: existing as unknown as StudyPathRow };
    }

    // 7-8. Incorrect answers for this attempt, joined to their questions. Only
    // the fields the AI actually needs — no student / private data.
    const { data: wrongRows } = await supabase
      .from("attempt_answers")
      .select("question_id, questions(prompt, choices, correct_index, explanation)")
      .eq("attempt_id", attemptId)
      .eq("is_correct", false);

    type WrongRow = {
      question_id: string;
      questions: {
        prompt: string;
        choices: unknown;
        correct_index: number;
        explanation: string | null;
      } | null;
    };
    const incorrect = ((wrongRows ?? []) as unknown as WrongRow[]).filter(
      (r) => r.questions && typeof r.questions.prompt === "string" && r.questions.prompt.trim(),
    );

    // 12. No weakness (determined from DB facts, not the AI) → no AI call.
    if (incorrect.length === 0) {
      return { status: "not-needed" };
    }

    // 9. Context + analysable material. Module → that topic's lessons; General
    //    Course Quiz → every module's lessons in the quiz's course (same rule
    //    as the lecturer course-wide quiz generator).
    let contextTitle = "This module";
    let contextSummary: string | null = null;
    let material = "";

    if (moduleTopicId) {
      const { data: topic } = await supabase
        .from("topics")
        .select("title, summary")
        .eq("id", moduleTopicId)
        .maybeSingle();
      const { data: lessons } = await supabase
        .from("lessons")
        .select("modality, title, body_md, order_index")
        .eq("topic_id", moduleTopicId)
        .order("order_index");
      contextTitle = topic?.title ?? "This module";
      contextSummary = (topic?.summary ?? "").trim() || null;
      material = buildModuleMaterial((lessons ?? []) as LessonForCapability[]);
    } else if (generalQuizId) {
      const { data: cq } = await supabase
        .from("course_quizzes")
        .select("title, course_id")
        .eq("id", generalQuizId)
        .maybeSingle();
      const courseId = cq?.course_id ?? null;
      contextTitle = cq?.title ?? "This course";

      if (courseId) {
        const { data: course } = await supabase
          .from("courses")
          .select("title, summary")
          .eq("id", courseId)
          .maybeSingle();
        // Course-wide: every module's lessons in this course (same capability
        // rule as the lecturer course-wide quiz generator).
        const { data: lessons } = await supabase
          .from("lessons")
          .select("modality, title, body_md, order_index, topics!inner(course_id)")
          .eq("topics.course_id", courseId)
          .order("order_index");
        contextTitle = course?.title ?? contextTitle;
        contextSummary = (course?.summary ?? "").trim() || null;
        material = buildModuleMaterial((lessons ?? []) as unknown as LessonForCapability[]);
      }
    }

    const hasExplanations = incorrect.some(
      (r) => (r.questions?.explanation ?? "").trim().length > 0,
    );

    // Genuinely empty context (no analysable material, no summary, and no
    // question explanations) has nothing to teach from beyond raw prompts.
    if (material.length < MIN_ANALYSABLE_CHARS && !contextSummary && !hasExplanations) {
      throw new Error("INSUFFICIENT_CONTENT");
    }

    // 13-14. Compact structured payload — incorrect-question evidence only.
    const payload: AiPayload = {
      scope: moduleTopicId ? "module" : "course",
      moduleTitle: contextTitle,
      moduleSummary: contextSummary,
      material,
      incorrectQuestions: incorrect.slice(0, 20).map((r) => {
        const q = r.questions!;
        const choices = Array.isArray(q.choices)
          ? (q.choices as string[]).map((c) => String(c))
          : [];
        return {
          question: q.prompt,
          choices,
          correctAnswer: choices[q.correct_index] ?? "",
          explanation: (q.explanation ?? "").trim(),
        };
      }),
    };

    const content = await runGeneration(payload);

    // Save via the SECURITY DEFINER RPC (idempotent; re-derives ownership +
    // topic from the attempt; UNIQUE(attempt_id) is the final guard).
    const { data: saved, error: sErr } = await supabase.rpc("save_study_path", {
      _attempt_id: attemptId,
      _content: content as unknown as Json,
      _weak_question_ids: incorrect.map((r) => r.question_id),
    });

    if (sErr) {
      const code = (sErr.message || "").trim();
      throw new Error(CODES.has(code) ? code : "SAVE_FAILED");
    }
    if (!saved) throw new Error("SAVE_FAILED");

    return { status: "created", studyPath: saved as unknown as StudyPathRow };
  });
