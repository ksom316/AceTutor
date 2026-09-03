import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/course-chat.functions";
import { extractJson, pickCorrectIndex } from "@/lib/lecturer-quiz.functions";

/**
 * Quiz Me — AI-generated FORMATIVE PRACTICE quizzes.
 *
 * Completely separate from official assessment: nothing here reads or writes
 * `quiz_attempts` / `attempt_answers`, touches Mastery, or records anything in
 * the database. A practice quiz lives only for the duration of the dialog.
 *
 *  - `generatePracticeQuiz` grounds one AI request in the selected course + topic
 *    + that topic's lesson material + difficulty, validates the JSON, and returns
 *    the questions WITHOUT the answer key. The answer key + explanations are
 *    sealed into an opaque AES-GCM token that only this server can open.
 *  - `gradePracticeQuiz` opens the token, grades the student's answers, and
 *    returns the review + strong/weak concepts. It never contacts the database.
 *
 * The OpenRouter key never reaches the browser; AI runs server-side via callAI.
 */

const DIFFICULTY = z.enum(["easy", "medium", "hard"]);
type Difficulty = z.infer<typeof DIFFICULTY>;

const genSchema = z.object({
  courseId: z.string().uuid(),
  topicId: z.string().uuid(),
  difficulty: DIFFICULTY,
  count: z
    .number()
    .int()
    .refine((n) => [5, 10, 15, 20, 25, 30].includes(n), "unsupported count"),
});

const gradeSchema = z.object({
  quizToken: z.string().min(1).max(200_000),
  answers: z.array(z.number().int().min(0).max(9).nullable()).max(30),
});

export type PracticeQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  concept: string;
};

export type PracticeQuizResult = {
  quizToken: string;
  topicId: string;
  topicTitle: string;
  difficulty: Difficulty;
  /** True when the module has a published OFFICIAL quiz (drives the "Retake
   *  Official Module Quiz" CTA). */
  officialQuizExists: boolean;
  questions: PracticeQuestion[];
};

export type PracticeReviewItem = {
  index: number;
  chosenIndex: number | null;
  correctIndex: number;
  isCorrect: boolean;
  explanation: string;
  concept: string;
};

export type PracticeGradeResult = {
  correct: number;
  incorrect: number;
  total: number;
  pct: number;
  review: PracticeReviewItem[];
  strongConcepts: string[];
  weakConcepts: string[];
  conceptBreakdown: { name: string; correct: number; total: number; pct: number }[];
};

/** Predictable conditions → a code the dialog maps to friendly text. */
export const PRACTICE_ERRORS: Record<string, string> = {
  NOT_ENROLLED: "Enroll in this course to use practice quizzes.",
  TOPIC_NOT_IN_COURSE: "That module isn't part of this course.",
  INSUFFICIENT_MATERIAL:
    "There isn't enough published material for this module yet to build a reliable practice quiz. Try another module.",
  AI_GENERATION_FAILED:
    "AceTutor couldn't generate a solid practice quiz right now. Please try again.",
  PRACTICE_UNAVAILABLE:
    "Practice quizzes aren't configured on this deployment (missing PRACTICE_QUIZ_SECRET).",
  PRACTICE_TOKEN_INVALID: "This practice quiz has expired or is invalid — generate a new one.",
  PRACTICE_TOKEN_EXPIRED: "This practice quiz has expired — generate a new one.",
  PRACTICE_ANSWER_COUNT: "Your answers didn't match the quiz — generate a new one.",
};

export function practiceErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return PRACTICE_ERRORS[raw] ?? PRACTICE_ERRORS.AI_GENERATION_FAILED;
}

// ---- Answer-key token (AES-GCM, server-only) --------------------------------

const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

/** A fresh ArrayBuffer-backed byte view for a UTF-8 string. */
function utf8(s: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(s));
}
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function tokenKey(): Promise<CryptoKey> {
  // Server-only. This is the ONLY key material for the practice-quiz answer-key
  // token — no fallback to OpenRouter / Supabase / anon credentials. `process.env`
  // is never inlined into the client bundle (only `import.meta.env.VITE_*` is),
  // so this secret cannot reach the browser.
  const secret = (process.env.PRACTICE_QUIZ_SECRET ?? "").trim();
  if (secret.length < 16) throw new Error("PRACTICE_UNAVAILABLE");
  const material = await crypto.subtle.digest(
    "SHA-256",
    utf8(`acetutor:practice-quiz:v1:${secret}`) as BufferSource,
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

type TokenPayload = {
  v: 1;
  uid: string;
  courseId: string;
  topicId: string;
  difficulty: Difficulty;
  iat: number;
  key: { correctIndex: number; explanation: string; concept: string }[];
};

async function sealToken(payload: TokenPayload): Promise<string> {
  const key = await tokenKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = utf8(JSON.stringify(payload));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      data as BufferSource,
    ),
  );
  return `${b64url(iv)}.${b64url(ct)}`;
}
async function openToken(token: string): Promise<TokenPayload> {
  const [ivB, ctB] = token.split(".");
  if (!ivB || !ctB) throw new Error("PRACTICE_TOKEN_INVALID");
  const key = await tokenKey();
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(ivB) as BufferSource },
      key,
      fromB64url(ctB) as BufferSource,
    );
  } catch {
    throw new Error("PRACTICE_TOKEN_INVALID");
  }
  return JSON.parse(new TextDecoder().decode(pt)) as TokenPayload;
}

// ---- Generation ------------------------------------------------------------

const MATERIAL_TOTAL_CAP = 12_000;
const MATERIAL_PER_LESSON_CAP = 4_000;
/** Below this much grounding text we refuse rather than invent a quiz. */
const MIN_MATERIAL = 220;

function buildMaterial(lessons: { title: string; body_md: string | null }[]): string {
  const parts: string[] = [];
  for (const l of lessons) {
    const body = (l.body_md ?? "").trim().slice(0, MATERIAL_PER_LESSON_CAP);
    if (!body) continue;
    parts.push(`## ${l.title}\n\n${body}`);
  }
  return parts.join("\n\n---\n\n").slice(0, MATERIAL_TOTAL_CAP);
}

const DIFFICULTY_INSTRUCTION: Record<Difficulty, string> = {
  easy: "Test recall and recognition of core definitions and stated facts. Single-step reasoning only; distractors clearly wrong.",
  medium:
    "Test applying a concept to a short scenario or connecting two related ideas. Light multi-step reasoning; distractors plausible.",
  hard: "Test analysis, comparison, or applying concepts to less obvious cases. Multi-step reasoning; distractors subtle but unambiguously wrong.",
};

const EXPLANATION_STYLE: Record<string, string> = {
  concise: "Keep each explanation to one short sentence.",
  detailed: "Give each explanation two or three sentences with the underlying reasoning.",
  step_by_step: "Write each explanation as a short ordered sequence of steps.",
  example_first: "Open each explanation with a tiny concrete example, then the rule.",
};

type ParsedQ = {
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  concept: string;
};

function parsePractice(raw: string, limit: number, fallbackConcept: string): ParsedQ[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return [];
  }
  const p = parsed as Record<string, unknown>;
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(p.questions)
      ? (p.questions as unknown[])
      : Array.isArray(p.quiz)
        ? (p.quiz as unknown[])
        : Array.isArray(p.items)
          ? (p.items as unknown[])
          : [];

  const seen = new Set<string>();
  const out: ParsedQ[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const prompt = [q.prompt, q.question, q.text]
      .find((x): x is string => typeof x === "string" && !!x.trim())
      ?.trim();
    const rawChoices = [q.choices, q.options, q.answers].find(Array.isArray) as
      | unknown[]
      | undefined;
    const choices = (rawChoices ?? [])
      .map((c) => (typeof c === "string" ? c : String(c ?? "")).trim())
      .filter(Boolean);
    const correctIndex = pickCorrectIndex(q, choices);
    const explanation = typeof q.explanation === "string" ? q.explanation.trim() : "";
    const concept =
      [q.concept, q.topic, q.label, q.category]
        .find((x): x is string => typeof x === "string" && !!x.trim())
        ?.trim() || fallbackConcept;

    if (!prompt) continue;
    if (choices.length < 2 || choices.length > 6) continue;
    if (correctIndex < 0 || correctIndex >= choices.length) continue;
    if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) continue;

    const dedupe = prompt.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    out.push({ prompt, choices, correctIndex, explanation, concept });
    if (out.length >= limit) break;
  }
  return out;
}

async function generate(
  courseTitle: string,
  courseSummary: string | null,
  topicTitle: string,
  topicSummary: string | null,
  material: string,
  difficulty: Difficulty,
  count: number,
  explanationStyle: string | null,
): Promise<ParsedQ[]> {
  const styleLine =
    (explanationStyle && EXPLANATION_STYLE[explanationStyle]) ||
    "Keep each explanation short and beginner-friendly.";

  const system =
    "You write multiple-choice PRACTICE quiz questions for a university student, grounded ONLY in the SOURCE MATERIAL provided. " +
    "Do not invent facts, terms, definitions or numbers that are not supported by the material or by uncontroversial general knowledge of the subject. " +
    "Every question, its correct answer and every distractor must be defensible. No 'All of the above' / 'None of the above'. No two questions may test the same fact. " +
    `${DIFFICULTY_INSTRUCTION[difficulty]} ` +
    "Explanations shape only HOW the reason is written, never which answer is correct. " +
    "Respond with strict JSON only — no prose, no code fences.";

  const user = `COURSE: ${courseTitle}${courseSummary ? `\n${courseSummary}` : ""}
MODULE: ${topicTitle}${topicSummary ? `\n${topicSummary}` : ""}

SOURCE MATERIAL (the module's own lessons — the only course-specific source you may use):
<<<
${material || "(no lesson text — base questions on the module title/description and standard subject knowledge)"}
>>>

Write up to ${count} multiple-choice questions at ${difficulty} difficulty.
- Each: exactly 4 options, exactly one correct.
- "correctIndex" is the 0-based index of the correct option.
- "explanation": a short, beginner-friendly reason the answer is right. ${styleLine}
- "concept": 2–4 words naming the sub-topic the question tests.
If the material can't support ${count} good questions, return fewer rather than padding with weak or invented ones.

Respond ONLY with JSON of exactly this shape:
{ "questions": [ { "prompt": string, "choices": [string, string, string, string], "correctIndex": 0, "explanation": string, "concept": string } ] }`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const maxTokens = Math.min(700 + count * 175, 8000);

  const attempt = async (jsonMode: boolean): Promise<ParsedQ[]> => {
    const raw = await callAI(messages, jsonMode ? { jsonObject: true, maxTokens } : { maxTokens });
    return parsePractice(raw, count, topicTitle);
  };

  let questions: ParsedQ[] = [];
  try {
    questions = await attempt(true);
  } catch (e) {
    console.error(
      `[generatePracticeQuiz] json-mode call errored: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (questions.length === 0) {
    // Free models frequently ignore response_format:json_object — retry plain.
    questions = await attempt(false);
  }
  return questions;
}

export const generatePracticeQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => genSchema.parse(input))
  .handler(async ({ data, context }): Promise<PracticeQuizResult> => {
    const { supabase, userId } = context;

    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", data.courseId)
      .maybeSingle();
    if (!enrollment) throw new Error("NOT_ENROLLED");

    // The topic MUST belong to the selected course — never trust the client id.
    const { data: topic } = await supabase
      .from("topics")
      .select("id, title, summary, course_id")
      .eq("id", data.topicId)
      .maybeSingle();
    if (!topic || topic.course_id !== data.courseId) throw new Error("TOPIC_NOT_IN_COURSE");

    const [{ data: course }, { data: lessons }, { data: prefs }, officialCount] = await Promise.all(
      [
        supabase.from("courses").select("title, summary").eq("id", data.courseId).maybeSingle(),
        supabase
          .from("lessons")
          .select("title, body_md, order_index")
          .eq("topic_id", data.topicId)
          .order("order_index"),
        supabase
          .from("learning_preferences")
          .select("explanation_style")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("questions")
          .select("id", { count: "exact", head: true })
          .eq("topic_id", data.topicId),
      ],
    );

    const material = buildMaterial((lessons ?? []) as { title: string; body_md: string | null }[]);
    if (material.length + (topic.summary?.length ?? 0) < MIN_MATERIAL) {
      throw new Error("INSUFFICIENT_MATERIAL");
    }

    const questions = await generate(
      course?.title ?? data.courseId,
      course?.summary ?? null,
      topic.title,
      topic.summary,
      material,
      data.difficulty,
      data.count,
      prefs?.explanation_style ?? null,
    );

    // Accept a shorter quiz (better than padded/invented questions) but not a
    // near-empty one — under half the request is a generation failure.
    const minAcceptable = Math.max(4, Math.floor(data.count / 2));
    if (questions.length < Math.min(minAcceptable, data.count)) {
      throw new Error("AI_GENERATION_FAILED");
    }

    const quizToken = await sealToken({
      v: 1,
      uid: userId,
      courseId: data.courseId,
      topicId: data.topicId,
      difficulty: data.difficulty,
      iat: Date.now(),
      key: questions.map((q) => ({
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        concept: q.concept,
      })),
    });

    return {
      quizToken,
      topicId: data.topicId,
      topicTitle: topic.title,
      difficulty: data.difficulty,
      officialQuizExists: (officialCount.count ?? 0) > 0,
      questions: questions.map((q, i) => ({
        id: `q${i}`,
        prompt: q.prompt,
        choices: q.choices,
        concept: q.concept,
      })),
    };
  });

export const gradePracticeQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => gradeSchema.parse(input))
  .handler(async ({ data, context }): Promise<PracticeGradeResult> => {
    const { userId } = context;

    const payload = await openToken(data.quizToken);
    if (payload.v !== 1 || payload.uid !== userId) throw new Error("PRACTICE_TOKEN_INVALID");
    if (Date.now() - payload.iat > TOKEN_TTL_MS) throw new Error("PRACTICE_TOKEN_EXPIRED");
    if (data.answers.length !== payload.key.length) throw new Error("PRACTICE_ANSWER_COUNT");

    const review: PracticeReviewItem[] = payload.key.map((k, i) => {
      const chosen = data.answers[i];
      return {
        index: i,
        chosenIndex: typeof chosen === "number" ? chosen : null,
        correctIndex: k.correctIndex,
        isCorrect: typeof chosen === "number" && chosen === k.correctIndex,
        explanation: k.explanation,
        concept: k.concept,
      };
    });

    const correct = review.filter((r) => r.isCorrect).length;
    const total = review.length;

    const byConcept = new Map<string, { c: number; t: number }>();
    for (const r of review) {
      const e = byConcept.get(r.concept) ?? { c: 0, t: 0 };
      e.t += 1;
      if (r.isCorrect) e.c += 1;
      byConcept.set(r.concept, e);
    }
    const conceptBreakdown = [...byConcept.entries()].map(([name, s]) => ({
      name,
      correct: s.c,
      total: s.t,
      pct: Math.round((s.c / s.t) * 100),
    }));

    return {
      correct,
      incorrect: total - correct,
      total,
      pct: total > 0 ? Math.round((correct / total) * 100) : 0,
      review,
      strongConcepts: conceptBreakdown
        .filter((c) => c.pct >= 75)
        .sort((a, b) => b.pct - a.pct)
        .map((c) => c.name),
      weakConcepts: conceptBreakdown
        .filter((c) => c.pct < 50)
        .sort((a, b) => a.pct - b.pct)
        .map((c) => c.name),
      conceptBreakdown,
    };
  });
