import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/course-chat.functions";
import {
  analyseModuleCapability,
  classifyLessonSource,
  type LessonForCapability,
  MIN_ANALYSABLE_CHARS,
  type QuizSourceInfo,
} from "@/lib/quiz-capability";
import {
  type DifficultyMode,
  difficultyModePromptInstruction,
  normaliseDifficultyForMode,
} from "@/lib/quiz-difficulty";

/**
 * Server-side AI quiz generation. The OpenRouter key never reaches the browser.
 *
 * Grounding is ONLY lecturer-authored text: text-lesson bodies and written
 * summaries on video / audio / slides lessons (see quiz-capability.ts, shared
 * with the UI so the pre-generation check and the server agree). The pipeline
 * has no video / audio transcription and no PDF text extraction, so those
 * media files are never sent to the model and never reported as "analysed".
 *
 * Predictable conditions return a structured error code (see
 * QUIZ_GEN_ERROR_MESSAGES); the UI maps codes to friendly text.
 */

/** Lecturer-chosen difficulty mode for AI generation. Optional; defaults to
 *  "ai" (the model decides per question) so existing callers are unchanged. */
const difficultyModeSchema = z
  .enum(["ai", "easy", "medium", "hard", "mixed"])
  .optional()
  .default("ai");

const schema = z.union([
  z.object({
    topicId: z.string().uuid(),
    questionCount: z.number().int().min(1).max(50),
    difficulty: difficultyModeSchema,
  }),
  z.object({
    draftModule: z.object({
      title: z.string().min(1).max(200),
      summary: z.string().max(4000).optional(),
      /** Concatenated text of the draft lessons, when the module is being
       *  created with content already added. */
      content: z.string().max(30_000).optional(),
    }),
    questionCount: z.number().int().min(1).max(50),
    difficulty: difficultyModeSchema,
  }),
  z.object({
    /** A specific General Course Quiz — questions cover the whole course. The
     *  course is ALWAYS derived server-side from current_lecturer_course();
     *  `courseQuizId` only identifies which of the lecturer's course quizzes is
     *  being filled and is verified to belong to that course. */
    courseWide: z.literal(true),
    courseQuizId: z.string().uuid(),
    questionCount: z.number().int().min(1).max(50),
    difficulty: difficultyModeSchema,
  }),
]);

export type GeneratedQuestion = {
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  difficulty: number;
};

export type { QuizSourceInfo } from "@/lib/quiz-capability";

export type QuizGenResult = {
  questions: GeneratedQuestion[];
  requested: number;
  generated: number;
  sources: QuizSourceInfo[];
};

const MAX_SOURCE_CHARS = 26_000;
const PER_LESSON_CHARS = 9_000;

type LessonRow = LessonForCapability;
/** A lesson plus (for course-wide generation) the module it belongs to. */
type SourceLesson = LessonForCapability & { moduleTitle?: string };

/** Build the model's SOURCE MATERIAL from analysable lessons only. */
function buildSourceText(lessons: SourceLesson[]): string {
  const parts: string[] = [];
  for (const l of lessons) {
    const info = classifyLessonSource(l);
    if (info.status !== "analysed" && info.status !== "summary") continue;
    const body = (l.body_md ?? "").trim().slice(0, PER_LESSON_CHARS);
    const label = l.moduleTitle ? `${l.moduleTitle} — ${info.title}` : info.title;
    const heading =
      info.status === "analysed" ? `## ${label}` : `## ${label} — lecturer's written summary`;
    parts.push(`${heading}\n\n${body}`);
  }
  let text = parts.join("\n\n---\n\n");
  if (text.length > MAX_SOURCE_CHARS) text = text.slice(0, MAX_SOURCE_CHARS);
  return text;
}

/** Pull the JSON payload out of a model reply — tolerant of ``` fences and of
 *  a bare top-level array. */
function extractJson(raw: string): string {
  // A leading BOM / stray whitespace / ``` fence is handled by slicing from the
  // first bracket to the last matching one.
  const s = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const objStart = s.indexOf("{");
  const arrStart = s.indexOf("[");
  const objEnd = s.lastIndexOf("}");
  const arrEnd = s.lastIndexOf("]");
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart) && arrEnd > arrStart) {
    return s.slice(arrStart, arrEnd + 1);
  }
  if (objStart >= 0 && objEnd > objStart) return s.slice(objStart, objEnd + 1);
  return s;
}

function coerceInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number.parseInt(v, 10);
  return null;
}

/** Models phrase the answer key many ways — accept the common ones. */
function pickCorrectIndex(q: Record<string, unknown>, choices: string[]): number {
  const numeric = [q.correctIndex, q.correct_index, q.answerIndex, q.answer_index, q.correct];
  for (const c of numeric) {
    const n = coerceInt(c);
    if (n !== null) return n;
  }
  const textual = [q.answer, q.correct, q.correctAnswer, q.correct_answer, q.correctIndex];
  for (const c of textual) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (/^[A-Za-z]$/.test(t)) return t.toUpperCase().charCodeAt(0) - 65;
    const idx = choices.findIndex((ch) => ch.toLowerCase() === t.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

/** @returns kept questions; `seenRaw` reports how many array items the model returned. */
function parseQuestions(
  raw: string,
  limit: number,
): { questions: GeneratedQuestion[]; rawCount: number } {
  if (!raw || !raw.trim()) return { questions: [], rawCount: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return { questions: [], rawCount: 0 };
  }

  const asArray = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
  const p = parsed as Record<string, unknown> | unknown[];
  const list =
    asArray(p) ??
    asArray((p as Record<string, unknown>).questions) ??
    asArray((p as Record<string, unknown>).quiz) ??
    asArray((p as Record<string, unknown>).items) ??
    [];

  const seen = new Set<string>();
  const out: GeneratedQuestion[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const prompt = (
      typeof q.prompt === "string"
        ? q.prompt
        : typeof q.question === "string"
          ? q.question
          : typeof q.text === "string"
            ? q.text
            : ""
    ).trim();
    const rawChoices = Array.isArray(q.choices)
      ? q.choices
      : Array.isArray(q.options)
        ? q.options
        : Array.isArray(q.answers)
          ? q.answers
          : [];
    const choices = rawChoices
      .map((c) => (typeof c === "string" ? c : String(c ?? "")).trim())
      .filter(Boolean);
    const correctIndex = pickCorrectIndex(q, choices);
    const explanation = typeof q.explanation === "string" ? q.explanation.trim() : "";
    const dn = coerceInt(q.difficulty);
    const difficulty = dn === null ? 3 : Math.min(5, Math.max(1, dn));

    if (!prompt) continue;
    if (choices.length < 2 || choices.length > 6) continue;
    if (correctIndex < 0 || correctIndex >= choices.length) continue;
    if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) continue;

    const key = prompt.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ prompt, choices, correctIndex, explanation, difficulty });
    if (out.length >= limit) break;
  }
  return { questions: out, rawCount: list.length };
}

/** Snap every generated question's `difficulty` into the band the lecturer
 *  chose, so the stored 1–5 value always matches the selected mode. */
function applyDifficultyMode(
  questions: GeneratedQuestion[],
  mode: DifficultyMode,
): GeneratedQuestion[] {
  return questions.map((q) => ({
    ...q,
    difficulty: normaliseDifficultyForMode(q.difficulty, mode),
  }));
}

async function generateFrom(
  moduleTitle: string,
  moduleSummary: string | null,
  sourceText: string,
  count: number,
  strictGrounding: boolean,
  scope: "module" | "course" = "module",
  difficultyMode: DifficultyMode = "ai",
): Promise<GeneratedQuestion[]> {
  const unit = scope === "course" ? "course" : "module";
  const difficultyInstruction = difficultyModePromptInstruction(difficultyMode);
  const system =
    (strictGrounding
      ? `You write multiple-choice quiz questions for a university ${unit}. Use ONLY the SOURCE MATERIAL supplied by the user. Do not use outside knowledge. Never invent facts, terms, names, numbers, or definitions that are not stated in the material. Every question, its correct answer, and every distractor must be checkable against the material.${
          scope === "course"
            ? " Spread the questions across the different modules represented in the material rather than focusing on one."
            : ""
        } If the material cannot support the number of questions requested, return fewer good questions rather than padding with weak or invented ones. Do not write 'All of the above' or 'None of the above' options. No two questions may test the same fact.`
      : "You write foundational multiple-choice quiz questions for a brand-new university module that has no learning materials yet. Base the questions on the module's stated topic and description. Keep them foundational, unambiguous, and widely agreed. Do not write 'All of the above' or 'None of the above'. No two questions may test the same fact.") +
    ` ${difficultyInstruction}` +
    " Respond with strict JSON only, no prose, no code fences.";

  const user = `${scope === "course" ? "COURSE" : "MODULE"}
Title: ${moduleTitle}
Description: ${moduleSummary || "(none)"}

${
  strictGrounding
    ? `SOURCE MATERIAL (the only thing you may use${
        scope === "course" ? "; each block is headed by its module" : ""
      }):\n<<<\n${sourceText}\n>>>`
    : "There are no learning materials yet — use the module topic and description above."
}

Write up to ${count} multiple-choice questions.
- Each question: exactly 4 options, exactly one correct.
- Distractors must be plausible but clearly wrong.
- ${difficultyInstruction}
- "difficulty" is an integer from 1 (easy) to 5 (hard).
Respond ONLY with JSON of this exact shape:
{ "questions": [ { "prompt": string, "choices": [string, string, string, string], "correctIndex": 0, "explanation": string, "difficulty": 3 } ] }`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const maxTokens = Math.min(1200 + count * 160, 8000);

  console.info(
    `[generateModuleQuiz] AI request — maxTokens=${maxTokens}, promptChars=${
      system.length + user.length
    }, sourceChars=${sourceText.length}, difficulty=${difficultyMode}`,
  );

  const attempt = async (jsonMode: boolean): Promise<GeneratedQuestion[]> => {
    const raw = await callAI(messages, jsonMode ? { jsonObject: true, maxTokens } : { maxTokens });
    const { questions, rawCount } = parseQuestions(raw, count);
    console.info(
      `[generateModuleQuiz] AI response (${jsonMode ? "json" : "plain"} mode) — chars=${
        raw.length
      }, items=${rawCount}, kept=${questions.length}, preview=${JSON.stringify(raw.slice(0, 200))}`,
    );
    return questions;
  };

  let questions: GeneratedQuestion[] = [];
  try {
    questions = await attempt(true);
  } catch (e) {
    console.error(
      `[generateModuleQuiz] AI call (json mode) errored: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  if (questions.length === 0) {
    // Free models often ignore or reject response_format:json_object. The prompt
    // already demands strict JSON, so retry once in plain mode.
    console.warn(
      "[generateModuleQuiz] json mode returned 0 usable questions — retrying plain mode",
    );
    questions = await attempt(false);
  }

  return questions;
}

export const generateModuleQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<QuizGenResult> => {
    const { supabase } = context;
    const count = data.questionCount;
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new Error("INVALID_QUESTION_COUNT");
    }

    const mode =
      "draftModule" in data
        ? "new-module"
        : "courseWide" in data
          ? "course-wide"
          : "existing-module";
    const difficultyMode: DifficultyMode = data.difficulty;
    console.info(
      `[generateModuleQuiz] start — mode=${mode}, count=${count}, difficulty=${difficultyMode}`,
    );

    const { data: lecturerCourseId } = await supabase.rpc("current_lecturer_course");
    if (!lecturerCourseId) throw new Error("NOT_A_LECTURER");

    // --- New module (not yet created): ground on the draft course content when
    //     the lecturer has already added some, else on title + description. ---
    if ("draftModule" in data) {
      const { title, summary } = data.draftModule;
      const content = (data.draftModule.content ?? "").trim();
      const grounded = content.length >= MIN_ANALYSABLE_CHARS;
      let questions: GeneratedQuestion[] = [];
      try {
        questions = await generateFrom(
          title,
          summary ?? null,
          grounded ? content : "",
          count,
          grounded,
          "module",
          difficultyMode,
        );
      } catch (err) {
        console.error(
          `[generateModuleQuiz] new-module generation threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      questions = applyDifficultyMode(questions, difficultyMode);
      console.info(
        `[generateModuleQuiz] new-module — grounded=${grounded}, final question count=${questions.length}`,
      );
      if (questions.length === 0) throw new Error("AI_GENERATION_FAILED");
      return {
        questions,
        requested: count,
        generated: questions.length,
        sources: [
          {
            title,
            modality: grounded ? "content" : "module",
            status: "analysed",
            note: grounded
              ? "generated from the draft course content"
              : "generated from the module title and description",
          },
        ],
      };
    }

    // --- General Course Quiz: analysable text across every module in the
    //     lecturer's own course. Course is from current_lecturer_course() only. ---
    if ("courseWide" in data) {
      // The target quiz must be one of this lecturer's own course quizzes.
      const { data: ownQuiz } = await supabase
        .from("course_quizzes")
        .select("id")
        .eq("id", data.courseQuizId)
        .eq("course_id", lecturerCourseId)
        .maybeSingle();
      if (!ownQuiz) throw new Error("WRONG_COURSE");

      const { data: course } = await supabase
        .from("courses")
        .select("title, summary")
        .eq("id", lecturerCourseId)
        .maybeSingle();

      const { data: courseLessons } = await supabase
        .from("lessons")
        .select("modality, title, body_md, order_index, topics!inner(title, course_id)")
        .eq("topics.course_id", lecturerCourseId)
        .order("order_index");

      const rows = (courseLessons ?? []) as unknown as (LessonRow & {
        topics: { title: string } | null;
      })[];
      const capabilityInput: LessonRow[] = rows.map((r) => ({
        modality: r.modality,
        title: r.title,
        body_md: r.body_md,
      }));
      const { sources, analysableCount } = analyseModuleCapability(capabilityInput);
      console.info(
        `[generateModuleQuiz] course-wide capability — lessons=${rows.length}, analysable=${analysableCount}`,
      );

      if (analysableCount === 0) {
        throw new Error(rows.length > 0 ? "UNSUPPORTED_MEDIA" : "NO_ANALYSABLE_CONTENT");
      }

      const text = buildSourceText(
        rows.map((r) => ({
          modality: r.modality,
          title: r.title,
          body_md: r.body_md,
          moduleTitle: r.topics?.title,
        })),
      );
      console.info(`[generateModuleQuiz] course-wide source text length=${text.trim().length}`);
      if (text.trim().length < MIN_ANALYSABLE_CHARS) {
        throw new Error("NO_ANALYSABLE_CONTENT");
      }

      let questions: GeneratedQuestion[] = [];
      try {
        questions = await generateFrom(
          course?.title ?? "This course",
          course?.summary ?? null,
          text,
          count,
          true,
          "course",
          difficultyMode,
        );
      } catch (err) {
        console.error(
          `[generateModuleQuiz] course-wide generation threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new Error("AI_GENERATION_FAILED");
      }
      questions = applyDifficultyMode(questions, difficultyMode);
      console.info(`[generateModuleQuiz] course-wide final question count: ${questions.length}`);
      if (questions.length === 0) throw new Error("AI_GENERATION_FAILED");
      return { questions, requested: count, generated: questions.length, sources };
    }

    // --- Existing module: text lessons + written summaries only. ---
    const { data: topic } = await supabase
      .from("topics")
      .select("id, title, summary, course_id")
      .eq("id", data.topicId)
      .maybeSingle();
    if (!topic) throw new Error("MODULE_NOT_FOUND");
    if (topic.course_id !== lecturerCourseId) throw new Error("WRONG_COURSE");

    const { data: lessons } = await supabase
      .from("lessons")
      .select("modality, title, body_md, order_index")
      .eq("topic_id", data.topicId)
      .order("order_index");

    const lessonRows = (lessons ?? []) as LessonRow[];
    const { sources, analysableCount } = analyseModuleCapability(lessonRows);
    console.info(
      `[generateModuleQuiz] capability — lessons=${lessonRows.length}, analysable=${analysableCount}, statuses=[${sources
        .map((s) => s.status)
        .join(",")}]`,
    );

    if (analysableCount === 0) {
      // Predictable — never a generic failure. Distinguish "has media but none
      // analysable" from "genuinely empty module".
      const hasAnyMedia = lessonRows.length > 0;
      throw new Error(hasAnyMedia ? "UNSUPPORTED_MEDIA" : "NO_ANALYSABLE_CONTENT");
    }

    const text = buildSourceText(lessonRows);
    console.info(`[generateModuleQuiz] source text length=${text.trim().length}`);
    if (text.trim().length < MIN_ANALYSABLE_CHARS) {
      throw new Error("NO_ANALYSABLE_CONTENT");
    }

    let questions: GeneratedQuestion[] = [];
    try {
      questions = await generateFrom(
        topic.title,
        topic.summary,
        text,
        count,
        true,
        "module",
        difficultyMode,
      );
    } catch (err) {
      console.error(
        `[generateModuleQuiz] generation threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error("AI_GENERATION_FAILED");
    }
    questions = applyDifficultyMode(questions, difficultyMode);
    console.info(`[generateModuleQuiz] final question count: ${questions.length}`);
    if (questions.length === 0) {
      console.error(
        "[generateModuleQuiz] 0 usable questions after all attempts — see the AI response previews above",
      );
      throw new Error("AI_GENERATION_FAILED");
    }

    return { questions, requested: count, generated: questions.length, sources };
  });
