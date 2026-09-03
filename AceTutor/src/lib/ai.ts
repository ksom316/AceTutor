/**
 * Mobile AI client. The web app calls OpenRouter through a TanStack Start server
 * function (course-chat.functions.ts); that can't run in Expo, so here we call
 * the same free OpenRouter endpoint directly. The key is inlined at build time
 * from EXPO_PUBLIC_OPENROUTER_API_KEY (same convention as the Supabase anon key).
 *
 * Get a free key at https://openrouter.ai/keys.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Free-tier model id — overridable via env, matching the web default.
const MODEL = process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? "google/gemini-2.0-flash-exp:free";

const API_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;

export type AIQuizQuestion = {
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
};

type QuizContext = {
  courseTitle: string;
  courseSummary?: string | null;
  moduleTitle?: string | null;
  moduleSummary?: string | null;
};

/**
 * Generate a 5-question multiple-choice quiz for a topic. Mirrors the web
 * `quiz_json` mode: strict JSON, exactly 4 choices per question, answer key
 * included so the client can grade locally.
 */
export async function generateQuizJson(ctx: QuizContext): Promise<AIQuizQuestion[]> {
  if (!API_KEY) {
    throw new Error(
      "AI quiz is not configured. Add a free EXPO_PUBLIC_OPENROUTER_API_KEY (https://openrouter.ai/keys) to AceTutor/.env.",
    );
  }

  const courseCtx = `Course: "${ctx.courseTitle}"${ctx.courseSummary ? `\nCourse summary: ${ctx.courseSummary}` : ""}`;
  const moduleCtx = ctx.moduleTitle
    ? `\nFocused module: "${ctx.moduleTitle}"${ctx.moduleSummary ? ` — ${ctx.moduleSummary}` : ""}`
    : "";
  const prompt = `${courseCtx}${moduleCtx}\n\nGenerate exactly 5 multiple-choice quiz questions about ${
    ctx.moduleTitle ?? "this course"
  }. Each question must have exactly 4 choices. Respond ONLY with strict JSON in this shape, no prose:\n{ "questions": [ { "prompt": string, "choices": [string, string, string, string], "correctIndex": 0|1|2|3, "explanation": string } ] }`;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://acetutor.app",
      "X-Title": "AceTutor",
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You output ONLY valid JSON matching the requested schema. No markdown fences.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI quiz error (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const raw: string = json?.choices?.[0]?.message?.content ?? "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not generate a quiz. Please try again.");
  }

  const list =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { questions?: unknown }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];

  const cleaned = list
    .filter(
      (q): q is AIQuizQuestion =>
        !!q &&
        typeof (q as AIQuizQuestion).prompt === "string" &&
        Array.isArray((q as AIQuizQuestion).choices) &&
        (q as AIQuizQuestion).choices.length === 4 &&
        typeof (q as AIQuizQuestion).correctIndex === "number",
    )
    .slice(0, 5);

  if (cleaned.length === 0) throw new Error("Could not generate a quiz. Please try again.");
  return cleaned;
}
