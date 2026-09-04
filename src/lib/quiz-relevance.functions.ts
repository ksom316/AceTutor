import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/course-chat.functions";
import { extractJson } from "@/lib/lecturer-quiz.functions";
import { classifyLessonSource, type LessonForCapability } from "@/lib/quiz-capability";
import { MAX_QUESTIONS } from "@/lib/quiz-shared";
import { checkQuestionRelevance } from "@/lib/quiz-relevance";

/**
 * Server-side, authoritative relevance validation for OFFICIAL MODULE QUIZZES —
 * the "save-finalization point" gate. Runs only when the lecturer commits a
 * question (Save / Add / Replace), never per keystroke.
 *
 * Two passes, cheapest-first:
 *  1. STRUCTURAL (deterministic, no AI, reused from src/lib/quiz-relevance.ts —
 *     the same heuristic that already runs client-side as an early warning).
 *     A question with ZERO shared wording with the module is conclusively
 *     "unrelated" here — no AI call needed, and this verdict never depends on
 *     AI availability.
 *  2. SEMANTIC (AI, one batched request for everything structural couldn't
 *     already rule out) — classifies relevant / questionable / unrelated with
 *     a short reason. Never rewrites question text; only ever returns a verdict.
 *
 * Fail-safe: if the AI call throws, times out, or returns something
 * unparseable, every question that was waiting on it falls back to
 * "questionable" (never "unrelated" purely from a missing AI pass) with a
 * reason explaining verification did not complete, and `aiAvailable: false` is
 * reported so the UI can say so plainly.
 */

const schema = z.object({
  topicId: z.string().uuid(),
  prompts: z.array(z.string().trim().min(1).max(2000)).min(1).max(MAX_QUESTIONS),
});

export type RelevanceVerdict = "relevant" | "questionable" | "unrelated";
export type QuestionRelevanceResult = { verdict: RelevanceVerdict; reason: string | null };
export type ModuleQuizRelevanceResult = {
  /** Same order as the submitted `prompts`. */
  results: QuestionRelevanceResult[];
  /** false when the semantic (AI) pass could not run / complete at all. */
  aiAvailable: boolean;
};

const PER_LESSON_CHARS = 600;
const MAX_SOURCE_CHARS = 4000;

function buildModuleContext(lessons: LessonForCapability[]) {
  const lessonTitles = lessons.map((l) => l.title).filter((t): t is string => !!t);
  const parts: string[] = [];
  for (const l of lessons) {
    const info = classifyLessonSource(l);
    if (info.status !== "analysed" && info.status !== "summary") continue;
    const body = (l.body_md ?? "").trim().slice(0, PER_LESSON_CHARS);
    if (body) parts.push(`${info.title}: ${body}`);
  }
  let content = parts.join("\n\n");
  if (content.length > MAX_SOURCE_CHARS) content = content.slice(0, MAX_SOURCE_CHARS);
  return { lessonTitles, content };
}

export const validateModuleQuizQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<ModuleQuizRelevanceResult> => {
    const { supabase } = context;

    const { data: lecturerCourseId } = await supabase.rpc("current_lecturer_course");
    if (!lecturerCourseId) throw new Error("NOT_A_LECTURER");

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
    const lessonRows = (lessons ?? []) as LessonForCapability[];
    const { lessonTitles, content } = buildModuleContext(lessonRows);

    // 1. Structural pass — always runs, never depends on AI.
    const structural = data.prompts.map((prompt) =>
      checkQuestionRelevance(
        { prompt },
        { title: topic.title, summary: topic.summary, lessonTitles },
      ),
    );
    const results: QuestionRelevanceResult[] = structural.map((s) =>
      s.relevant
        ? { verdict: "relevant" as const, reason: null }
        : { verdict: "unrelated" as const, reason: s.reason },
    );

    // 2. Semantic pass — only for what structural couldn't already rule out.
    const pendingIdx = structural.map((s, i) => (s.relevant ? i : -1)).filter((i) => i >= 0);
    if (pendingIdx.length === 0) {
      return { results, aiAvailable: true };
    }

    const system =
      "You verify whether quiz questions genuinely belong in ONE specific university course module. " +
      'Classify EACH question as exactly one of: "relevant" (clearly assesses this module\'s material), ' +
      '"questionable" (uncertain — too generic, tangential, or only loosely tied to this module), or ' +
      '"unrelated" (clearly about a different subject entirely). Be conservative: prefer "questionable" ' +
      'over "unrelated" unless you are confident the question has nothing to do with this module. ' +
      "Respond with strict JSON only, no prose, no code fences.";

    const list = pendingIdx.map((i, k) => `${k}. ${data.prompts[i]}`).join("\n");
    const user =
      `MODULE\nTitle: ${topic.title}\nDescription: ${topic.summary || "(none)"}\n` +
      (content ? `\nMODULE MATERIAL (excerpt):\n<<<\n${content}\n>>>\n` : "") +
      `\nQUESTIONS TO CLASSIFY (0-indexed):\n${list}\n\n` +
      "Respond ONLY with JSON of this exact shape:\n" +
      '{ "results": [ { "index": 0, "verdict": "relevant" | "questionable" | "unrelated", "reason": "short reason" } ] }';

    let aiAvailable = true;
    const written = new Set<number>();
    try {
      const raw = await callAI(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { jsonObject: true, maxTokens: Math.min(300 + pendingIdx.length * 120, 4000) },
      );
      const parsed = JSON.parse(extractJson(raw)) as { results?: unknown };
      const arr = Array.isArray(parsed.results) ? parsed.results : [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        const k = typeof r.index === "number" ? Math.trunc(r.index) : -1;
        if (k < 0 || k >= pendingIdx.length) continue;
        const verdictRaw = typeof r.verdict === "string" ? r.verdict.toLowerCase().trim() : "";
        const verdict: RelevanceVerdict =
          verdictRaw === "unrelated"
            ? "unrelated"
            : verdictRaw === "questionable"
              ? "questionable"
              : "relevant";
        const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 300) : null;
        const origIdx = pendingIdx[k];
        results[origIdx] = { verdict, reason };
        written.add(origIdx);
      }
      if (written.size === 0) aiAvailable = false;
    } catch (err) {
      console.error(
        `[validateModuleQuizQuestions] AI relevance pass failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      aiAvailable = false;
    }

    // Anything the AI pass was supposed to classify but didn't (whole call
    // failed, or it silently omitted an item) falls back to "questionable" —
    // reviewable, never a false "unrelated" purely from a missing AI verdict.
    for (const i of pendingIdx) {
      if (!written.has(i)) {
        results[i] = {
          verdict: "questionable",
          reason:
            "AI relevance verification was unavailable — only basic checks were run. Please review this question yourself.",
        };
      }
    }

    return { results, aiAvailable };
  });
