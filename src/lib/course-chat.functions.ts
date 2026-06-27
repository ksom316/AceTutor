import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  courseTitle: z.string().min(1).max(200),
  courseSummary: z.string().max(2000).optional(),
  mode: z.enum(["general", "ask", "explain", "quiz", "quiz_json", "summarize", "test", "recommend"]),
  provider: z.enum(["gemini", "llama", "deepseek"]).default("gemini"),
  question: z.string().max(2000).optional(),
  moduleTitle: z.string().max(200).optional(),
  moduleSummary: z.string().max(2000).optional(),
  performanceSummary: z.string().max(2000).optional(),
});

export type AIProvider = "gemini" | "llama" | "deepseek";

// All three models are served — for free — through OpenRouter's single
// OpenAI-compatible /chat/completions endpoint. One free OPENROUTER_API_KEY
// covers every provider below; only the model id changes.
// Free-tier model ids shift over time, so each is overridable via env.
// Browse the current free roster at https://openrouter.ai/models?max_price=0
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const PROVIDERS: Record<AIProvider, { label: string; model: string }> = {
  gemini: {
    label: "Gemini",
    model: process.env.OPENROUTER_MODEL_GEMINI ?? "google/gemini-2.0-flash-exp:free",
  },
  llama: {
    label: "Llama 3.3",
    model: process.env.OPENROUTER_MODEL_LLAMA ?? "meta-llama/llama-3.3-70b-instruct:free",
  },
  deepseek: {
    label: "DeepSeek",
    model: process.env.OPENROUTER_MODEL_DEEPSEEK ?? "deepseek/deepseek-chat-v3-0324:free",
  },
};

export type AIQuizQuestion = {
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
};

async function callAI(
  provider: AIProvider,
  messages: { role: string; content: string }[],
  opts?: { jsonObject?: boolean },
) {
  const cfg = PROVIDERS[provider];
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI tutor is not configured. Add a free OPENROUTER_API_KEY (get one at https://openrouter.ai/keys) to your environment.",
    );
  }
  const body: Record<string, unknown> = { model: cfg.model, messages };
  if (opts?.jsonObject) body.response_format = { type: "json_object" };
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional OpenRouter attribution headers (safe to leave as defaults).
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://acetutor.app",
      "X-Title": "AceTutor",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${cfg.label} error (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "") as string;
}

export const askCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const system =
      "You are AceTutor, an AI course tutor embedded in a learning dashboard. You ONLY help with the specific course the student is currently studying. Always prioritize course materials and the student's performance context. Use Markdown with short paragraphs, bullet points, and concrete examples.";

    const courseCtx = `Course: "${data.courseTitle}"${data.courseSummary ? `\nCourse summary: ${data.courseSummary}` : ""}`;
    const moduleCtx = data.moduleTitle
      ? `\nFocused module: "${data.moduleTitle}"${data.moduleSummary ? ` — ${data.moduleSummary}` : ""}`
      : "";
    const perfCtx = data.performanceSummary ? `\nStudent performance:\n${data.performanceSummary}` : "";
    const fullCtx = `${courseCtx}${moduleCtx}${perfCtx}`;

    let userPrompt = "";
    switch (data.mode) {
      case "general":
        userPrompt = `${fullCtx}\n\nGive a clear, well-structured general overview of this course: what it is, key topics, why it matters, and how to approach learning it.`;
        break;
      case "explain":
        userPrompt = `${fullCtx}\n\nExplain the key concepts of ${data.moduleTitle ?? "this course"} clearly with examples a student can follow.`;
        break;
      case "quiz":
        userPrompt = `${fullCtx}\n\nGenerate a short practice quiz (5 multiple-choice questions) based on ${data.moduleTitle ?? "this course"}. After each question, on a new line, give the correct answer and a one-sentence explanation. Use Markdown.`;
        break;
      case "summarize":
        userPrompt = `${fullCtx}\n\nSummarize the lecture material for ${data.moduleTitle ?? "this course"} as concise bullet points a student can revise from.`;
        break;
      case "test":
        userPrompt = `${fullCtx}\n\nAsk the student 5 progressively harder open-ended questions to test their knowledge of ${data.moduleTitle ?? "this course"}. Do NOT give the answers — invite them to attempt first.`;
        break;
      case "recommend":
        userPrompt = `${fullCtx}\n\nBased ONLY on the student's performance data above, give 3-5 personalized study recommendations. For each: state the weak area, what to revise (reference a module if possible), and which quiz to attempt next. Be concrete and supportive. Use Markdown bullet points.`;
        break;
      case "ask":
      default:
        userPrompt = `${fullCtx}\n\nFirst, decide whether the learner's question below is reasonably related to this course. Be generous — adjacent concepts, prerequisites, applications, and tools commonly used in the course count as related.

If the question is NOT related to the course at all, respond EXACTLY with one line:
NOT_RELATED: <one short sentence telling the user the question isn't related to ${data.courseTitle} and to ask something about the course instead>

Otherwise, answer the question clearly. Prioritize this order: (1) the course materials/module above, (2) the student's performance context, (3) general knowledge only if needed. Use Markdown.

Learner's question:
${data.question}`;
        break;
    }

    if (data.mode === "quiz_json") {
      const prompt = `${fullCtx}\n\nGenerate exactly 5 multiple-choice quiz questions about ${data.moduleTitle ?? "this course"}. Each question must have exactly 4 choices. Respond ONLY with strict JSON in this shape, no prose:\n{ "questions": [ { "prompt": string, "choices": [string, string, string, string], "correctIndex": 0|1|2|3, "explanation": string } ] }`;
      const raw = await callAI(
        data.provider,
        [
          { role: "system", content: "You output ONLY valid JSON matching the requested schema. No markdown fences." },
          { role: "user", content: prompt },
        ],
        { jsonObject: true },
      );
      try {
        const parsed = JSON.parse(raw);
        const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
        const cleaned: AIQuizQuestion[] = qs
          .filter(
            (q: unknown): q is AIQuizQuestion =>
              !!q &&
              typeof (q as AIQuizQuestion).prompt === "string" &&
              Array.isArray((q as AIQuizQuestion).choices) &&
              (q as AIQuizQuestion).choices.length === 4 &&
              typeof (q as AIQuizQuestion).correctIndex === "number",
          )
          .slice(0, 5);
        if (cleaned.length === 0) throw new Error("empty");
        return { related: true as const, quiz: cleaned, answer: "" };
      } catch {
        throw new Error("Could not generate quiz. Please try again.");
      }
    }

    const answer = await callAI(data.provider, [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ]);
    const trimmed = answer.trim();
    if (trimmed.startsWith("NOT_RELATED:")) {
      return { answer: "", related: false as const, reason: trimmed.replace(/^NOT_RELATED:\s*/, "") };
    }
    return { answer, related: true as const };
  });
