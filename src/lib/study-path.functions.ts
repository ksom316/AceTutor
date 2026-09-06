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
import {
  answeredCountOf,
  isSufficientAttempt,
  sufficientModuleAverage,
  WEAK_THRESHOLD,
  type PerfAttempt,
} from "@/lib/quiz-performance";

/**
 * Server-side AI "Personalized Study Path" generation.
 *
 * A study path is a SHORT, MODULE-specific remedial mini-course. For a module
 * quiz it is built from every question the student has missed across ALL their
 * usable attempts for that module (deduped), and framed by the module's average
 * score — so it represents the student's standing in that module, not one
 * sitting. For a General Course Quiz it is built from that one attempt. It
 * reuses the shared OpenRouter caller (`callAI`) — no second AI client.
 *
 * Security: the attempt id is the ONLY client input. Ownership + the module are
 * derived server-side from the caller's own quiz_attempts row (the RLS-scoped
 * `context.supabase` only ever returns the caller's attempts), and the write
 * goes through the SECURITY DEFINER `save_study_path` RPC which re-derives them
 * and enforces UNIQUE(attempt_id) — so the attempt stays the persistence anchor
 * (one path per anchor; a retake makes a new anchor, keeping the old path in
 * history). The AI never receives a user id, email, auth data, or another
 * module's questions — only this module's material and this module's incorrect
 * questions.
 *
 * Cost control: no weak answers → no AI call. An existing path for the anchor →
 * no AI call (returned as-is). Otherwise exactly one generation.
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
  | { status: "not-needed" }
  /** The attempt didn't cover enough of the quiz to be reliable evidence — no
   *  Study Path is generated. `answered` / `total` drive the UI message. */
  | { status: "insufficient-evidence"; answered: number; total: number };

/* ---- input ---- */

const inputSchema = z.object({ attemptId: z.string().uuid() });

/* ---- module material (same capability rule as the quiz generator) ---- */

export const MATERIAL_CHAR_CAP = 12_000;
const PER_LESSON_CHAR_CAP = 5_000;

/** Concatenate the analysable lecturer material for a set of lessons, capped.
 *  Exported so R1's remedial generator grounds on the exact same material as
 *  the Study Path it extends (no second material loader). */
export function buildModuleMaterial(lessons: LessonForCapability[]): string {
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
  /** The module's average score % (module scope only) — for the "why this
   *  path" framing. Never changes which concepts are covered. */
  moduleAverage: number | null;
  material: string;
  incorrectQuestions: AiIncorrectQuestion[];
  /** The student's saved `wrong_answer_help` preference, or null. Only shapes
   *  HOW each weak area is presented — never which areas are covered (that stays
   *  driven purely by the incorrect questions). */
  wrongAnswerHelp: string | null;
};

// How the `wrong_answer_help` preference tunes the remediation the AI writes.
// The study path always keeps the same shape (explanation + example + practice);
// the preference only shifts the emphasis and depth within it.
const WRONG_ANSWER_HELP_GUIDANCE: Record<string, string> = {
  simple:
    "PRESENTATION: keep each explanation short and plainly worded — a clear, simplified account of the misunderstanding. Keep the example brief and give one practice item per area.",
  detailed:
    "PRESENTATION: make each explanation thorough — why the likely answer is wrong AND the underlying concept it comes from, with the reasoning spelled out.",
  example:
    "PRESENTATION: lead each area with a concrete worked example and let the explanation lean on that example; keep the prose explanation secondary and short.",
  similar_practice:
    "PRESENTATION: keep each explanation brief, then provide 2 to 3 fresh practice questions per area that mirror the ones the student got wrong so they can attempt similar problems.",
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
    (payload.wrongAnswerHelp && WRONG_ANSWER_HELP_GUIDANCE[payload.wrongAnswerHelp]
      ? WRONG_ANSWER_HELP_GUIDANCE[payload.wrongAnswerHelp] +
        " This changes only how you present each area, not which areas you cover. " +
        "Never describe the student as a type of learner. "
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
    ...(payload.scope === "module" && payload.moduleAverage != null
      ? [
          `AVERAGE SCORE IN THIS MODULE: ${payload.moduleAverage}% — the student needs targeted review of the concepts the incorrect questions below reveal.`,
        ]
      : []),
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
    payload.wrongAnswerHelp === "similar_practice"
      ? "- At most 4 weakAreas; 2 to 3 practice items each."
      : payload.wrongAnswerHelp === "simple"
        ? "- At most 4 weakAreas; exactly 1 practice item each."
        : "- At most 4 weakAreas; 1 to 3 practice items each.",
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
      .select("id, user_id, topic_id, course_quiz_id, finished_at, answered_count, total")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr || !attempt) throw new Error("ATTEMPT_NOT_FOUND");
    if (attempt.user_id !== userId) throw new Error("ATTEMPT_NOT_OWNED"); // defense in depth
    if (!attempt.finished_at) throw new Error("ATTEMPT_NOT_FINISHED");
    // A blank submission (nothing answered) carries no evidence of weakness —
    // never fabricate weak areas from it. grade_quiz records no wrong
    // attempt_answers for it either, so this is also what the query below finds;
    // the explicit check just makes the contract obvious.
    if (attempt.answered_count === 0) return { status: "not-needed" };
    // The attempt must cover enough of the quiz to be reliable evidence. This is
    // the authoritative guard: the result page can call generation directly, so
    // a partial (e.g. 1/20) attempt must be rejected here, not only in the UI.
    const anchorShape: PerfAttempt = {
      id: attempt.id,
      topic_id: attempt.topic_id,
      score: null,
      total: attempt.total,
      finished_at: attempt.finished_at,
      answered_count: attempt.answered_count,
    };
    if (!isSufficientAttempt(anchorShape)) {
      return {
        status: "insufficient-evidence",
        answered: answeredCountOf(anchorShape),
        total: attempt.total ?? 0,
      };
    }
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

    // 7-8. The incorrect-question evidence + the module's average.
    //
    // MODULE quiz: gather every question the student has missed across their
    // SUFFICIENT attempts for this module (not just this one attempt, and never
    // a partial attempt) and dedupe by question — the Study Path represents the
    // module's standing. The module average uses the exact same
    // `sufficientModuleAverage` the UI shows.
    //
    // GENERAL COURSE QUIZ: the evidence is that one attempt (unchanged).
    let wrongAttemptIds: string[] = [attemptId];
    let moduleAverage: number | null = null;

    if (moduleTopicId) {
      const { data: moduleRows } = await supabase
        .from("quiz_attempts")
        .select("id, score, total, finished_at, answered_count, started_at")
        .eq("user_id", userId)
        .eq("topic_id", moduleTopicId)
        .not("finished_at", "is", null);
      const moduleAttempts = ((moduleRows ?? []) as unknown as PerfAttempt[]).map((a) => ({
        ...a,
        topic_id: moduleTopicId,
      }));
      moduleAverage = sufficientModuleAverage(moduleAttempts);

      // A retake can carry the module's average up to a strong level. Once it
      // is at or above par, there is no remediation to build — the adaptive
      // loop is closed. Any Study Path already created for an earlier attempt
      // stays in the student's history (the existing-path check above still
      // returns it); this only blocks generating a NEW remediation path.
      if (moduleAverage !== null && moduleAverage >= WEAK_THRESHOLD) {
        return { status: "not-needed" };
      }

      const sufficientIds = moduleAttempts.filter(isSufficientAttempt).map((a) => a.id);
      if (sufficientIds.length > 0) wrongAttemptIds = sufficientIds;
    }

    // The student's own wrong answers on their own (finished, verified) attempts
    // — `attempt_answers` reads are RLS-scoped to the caller. The question
    // details (correct answer + explanation) are then read with the service
    // client: students have no direct read on `questions` (SEC-01), and the
    // attempt ownership + `is_correct = false` filter above already bound the
    // id set to this student's own missed questions.
    const { data: wrongAnswerRows } = await supabase
      .from("attempt_answers")
      .select("question_id")
      .in("attempt_id", wrongAttemptIds)
      .eq("is_correct", false);
    const wrongQuestionIds = [
      ...new Set(((wrongAnswerRows ?? []) as { question_id: string }[]).map((r) => r.question_id)),
    ];

    type WrongRow = {
      question_id: string;
      questions: {
        prompt: string;
        choices: unknown;
        correct_index: number;
        explanation: string | null;
      } | null;
    };
    let incorrect: WrongRow[] = [];
    if (wrongQuestionIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: qRows } = await supabaseAdmin
        .from("questions")
        .select("id, prompt, choices, correct_index, explanation")
        .in("id", wrongQuestionIds.slice(0, 100));
      incorrect = ((qRows ?? []) as unknown as (WrongRow["questions"] & { id: string })[])
        .filter((q) => q && typeof q.prompt === "string" && q.prompt.trim())
        .map((q) => ({
          question_id: q.id,
          questions: {
            prompt: q.prompt,
            choices: q.choices,
            correct_index: q.correct_index,
            explanation: q.explanation,
          },
        }));
    }

    // 12. No weakness evidence (from DB facts, not the AI) → no AI call. Covers
    // the "weak by average but every answered question was correct" edge too.
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

    // The caller's saved "when I get something wrong" preference. RLS-scoped to
    // this user; the attempt id is still the only client input. A missing row /
    // value just means the default presentation. This preference only affects
    // HOW the study path is written, never which weak areas it covers.
    const { data: prefs } = await supabase
      .from("learning_preferences")
      .select("wrong_answer_help")
      .eq("user_id", userId)
      .maybeSingle();

    // 13-14. Compact structured payload — incorrect-question evidence only.
    const payload: AiPayload = {
      scope: moduleTopicId ? "module" : "course",
      moduleTitle: contextTitle,
      moduleSummary: contextSummary,
      moduleAverage,
      material,
      wrongAnswerHelp: prefs?.wrong_answer_help ?? null,
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
