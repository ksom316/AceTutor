import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  courseTitle: z.string().min(1).max(200),
  courseSummary: z.string().max(2000).optional(),
  mode: z.enum([
    "general",
    "ask",
    "explain",
    "quiz",
    "quiz_json",
    "summarize",
    "test",
    "recommend",
  ]),
  question: z.string().max(2000).optional(),
  moduleTitle: z.string().max(200).optional(),
  moduleSummary: z.string().max(2000).optional(),
  performanceSummary: z.string().max(2000).optional(),
});

// The tutor is served — for free — through OpenRouter's OpenAI-compatible
// /chat/completions endpoint with a single free OPENROUTER_API_KEY.
// Free-tier model ids shift over time, so the roster is overridable via env.
// Browse the current free roster at https://openrouter.ai/models?max_price=0
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Models are tried in order: Google's Gemini-family model first, then GPT,
// then OpenRouter's auto-router as a catch-all. If one is down, rate-limited,
// or delisted, the next takes over — quiz generation and chat keep working.
const MODELS = [
  process.env.OPENROUTER_MODEL_GEMINI ?? "google/gemma-4-31b-it:free",
  process.env.OPENROUTER_MODEL_GPT ?? "openai/gpt-oss-20b:free",
  process.env.OPENROUTER_MODEL ?? "openrouter/free",
];

// Wikipedia supplements the tutor's knowledge: we search the MediaWiki API
// for relevant articles and pass plain-text extracts as reference material.
// The model may also draw on its own knowledge for anything course-related,
// so a thin or missing extract never blocks an answer or a quiz.
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

async function wikiGet(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(`${WIKIPEDIA_API}?${qs}`, {
    headers: { "User-Agent": "AceTutor/1.0 (course tutor)" },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchWikipediaContext(query: string): Promise<string> {
  try {
    // 1) Find the most relevant article titles for the query.
    const search = await wikiGet({ action: "query", list: "search", srsearch: query, srlimit: "3" });
    const titles: string[] = (search?.query?.search ?? [])
      .map((r: { title?: string }) => r?.title)
      .filter((t: unknown): t is string => typeof t === "string");
    if (titles.length === 0) return "";

    // 2) Pull plain-text intro extracts for those articles. (exintro +
    // exlimit=max returns all pages; exchars would only fill the first.)
    const extracts = await wikiGet({
      action: "query",
      prop: "extracts",
      titles: titles.join("|"),
      explaintext: "1",
      exintro: "1",
      exlimit: "max",
    });
    const pages = Object.values(extracts?.query?.pages ?? {}) as {
      title?: string;
      extract?: string;
    }[];
    return pages
      .filter((p) => p.title && p.extract)
      .map((p) => `### Reference: "${p.title}"\n${p.extract}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

export type AIQuizQuestion = {
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
};

// Randomize a generated quiz so repeat attempts differ: shuffle question
// order and shuffle each question's choices (remapping correctIndex).
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomizeQuiz(questions: AIQuizQuestion[]): AIQuizQuestion[] {
  return shuffleInPlace(
    questions.map((q) => {
      const order = shuffleInPlace(q.choices.map((_, i) => i));
      return {
        ...q,
        choices: order.map((i) => q.choices[i]),
        correctIndex: order.indexOf(q.correctIndex),
      };
    }),
  );
}

// A random angle is injected into the quiz prompt so the model doesn't
// regenerate the same 5 questions for the same module every time.
const QUIZ_ANGLES = [
  "core definitions and terminology",
  "practical, real-world applications",
  "comparisons and differences between related concepts",
  "common misconceptions and tricky details",
  "cause-and-effect relationships and why things work the way they do",
  "examples and scenario-based reasoning",
];

async function callAI(
  messages: { role: string; content: string }[],
  opts?: { jsonObject?: boolean },
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI tutor is not configured. Add a free OPENROUTER_API_KEY (get one at https://openrouter.ai/keys) to your environment.",
    );
  }

  let lastError = "";
  for (const model of MODELS) {
    const body: Record<string, unknown> = { model, messages };
    if (opts?.jsonObject) body.response_format = { type: "json_object" };
    try {
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
        lastError = `(${res.status}) ${text.slice(0, 300)}`;
        continue; // model unavailable / rate-limited — try the next one
      }
      const json = await res.json();
      const content = (json.choices?.[0]?.message?.content ?? "") as string;
      if (content.trim()) return content;
      lastError = `model ${model} returned an empty response`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`AI tutor error: all models failed. Last error: ${lastError}`);
}

export const askCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const system =
      "You are AceTutor, an AI course tutor embedded in a learning dashboard. You help with the specific course the student is currently studying — including its modules, prerequisites, adjacent concepts, tools, and real-world applications. Prefer the REFERENCE MATERIAL in the prompt when it covers the topic, but when it is thin or missing, answer confidently from your own knowledge of the subject — a student should always get a tangible, useful answer to a course-related question. NEVER mention, cite, name, or hint at where any material comes from; present everything as course knowledge in your own words, with no citations, source names, or article titles. Use Markdown with short paragraphs, bullet points, and concrete examples.";

    const courseCtx = `Course: "${data.courseTitle}"${data.courseSummary ? `\nCourse summary: ${data.courseSummary}` : ""}`;
    const moduleCtx = data.moduleTitle
      ? `\nFocused module: "${data.moduleTitle}"${data.moduleSummary ? ` — ${data.moduleSummary}` : ""}`
      : "";
    const perfCtx = data.performanceSummary
      ? `\nStudent performance:\n${data.performanceSummary}`
      : "";

    // Retrieve reference material from Wikipedia only.
    const wikiQuery = [
      data.moduleTitle ?? data.courseTitle,
      data.mode === "ask" ? data.question : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);
    const wikiCtx = await fetchWikipediaContext(wikiQuery);
    const sourceCtx = wikiCtx
      ? `\n\n--- REFERENCE MATERIAL (prefer this when it covers the topic; supplement freely with your own knowledge of the subject — never reveal or name where it comes from) ---\n${wikiCtx}\n--- END OF REFERENCE MATERIAL ---`
      : `\n\n(No reference material could be retrieved for this topic. Answer from your own knowledge of the subject instead — do NOT mention any external source or the absence of material.)`;
    const fullCtx = `${courseCtx}${moduleCtx}${perfCtx}${sourceCtx}`;

    if (data.mode === "quiz_json") {
      const angle = QUIZ_ANGLES[Math.floor(Math.random() * QUIZ_ANGLES.length)];
      const prompt = `${fullCtx}\n\nGenerate exactly 10 multiple-choice quiz questions about ${data.moduleTitle ?? "this course"}. Draw on the reference material above where it helps, and on your own solid knowledge of the subject for anything it doesn't cover — every question must stay on-topic for this course/module. This round, emphasize ${angle}. Vary difficulty across the questions. Never mention or hint at the source of the material in any question or explanation. Each question must have exactly 4 choices. Respond ONLY with strict JSON in this shape, no prose:\n{ "questions": [ { "prompt": string, "choices": [string, string, string, string], "correctIndex": 0|1|2|3, "explanation": string } ] }`;
      const raw = await callAI(
        [
          {
            role: "system",
            content:
              "You output ONLY valid JSON matching the requested schema. No markdown fences.",
          },
          { role: "user", content: prompt },
        ],
        { jsonObject: true },
      );
      try {
        // Models sometimes wrap the JSON in ```json fences or add stray prose
        // despite instructions — extract the outermost {...} block first.
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        const jsonText = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
        const parsed = JSON.parse(jsonText);
        const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
        const cleaned: AIQuizQuestion[] = qs
          .filter((q: unknown): q is AIQuizQuestion => {
            if (!q || typeof q !== "object") return false;
            const c = q as AIQuizQuestion;
            return (
              typeof c.prompt === "string" &&
              Array.isArray(c.choices) &&
              c.choices.length === 4 &&
              c.choices.every((ch) => typeof ch === "string") &&
              Number.isInteger(c.correctIndex) &&
              // Out-of-range correctIndex would make randomizeQuiz map it to -1
              // and grade every answer wrong — reject the question instead.
              c.correctIndex >= 0 &&
              c.correctIndex < 4
            );
          })
          .slice(0, 10);
        if (cleaned.length === 0) throw new Error("empty");
        return { related: true as const, quiz: randomizeQuiz(cleaned), answer: "" };
      } catch {
        throw new Error("Could not generate quiz. Please try again.");
      }
    }

    let userPrompt = "";
    switch (data.mode) {
      case "general":
        userPrompt = `${fullCtx}\n\nGive a clear, well-structured general overview of this course: what it is, key topics, why it matters, and how to approach learning it.`;
        break;
      case "explain":
        userPrompt = `${fullCtx}\n\nExplain the key concepts of ${data.moduleTitle ?? "this course"} clearly with examples a student can follow.`;
        break;
      case "quiz":
        userPrompt = `${fullCtx}\n\nGenerate a practice quiz (10 multiple-choice questions) based on ${data.moduleTitle ?? "this course"}. After each question, on a new line, give the correct answer and a one-sentence explanation. Use Markdown.`;
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

Otherwise, give a clear, tangible answer. Use the reference material above where it covers the question, and your own knowledge of the subject where it doesn't — rewritten in your own words as course knowledge. Do NOT cite, name, or hint at any source. Use Markdown.

Learner's question:
${data.question}`;
        break;
    }

    const answer = await callAI([
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ]);
    const trimmed = answer.trim();
    if (trimmed.startsWith("NOT_RELATED:")) {
      return {
        answer: "",
        related: false as const,
        reason: trimmed.replace(/^NOT_RELATED:\s*/, ""),
      };
    }
    return { answer, related: true as const };
  });
