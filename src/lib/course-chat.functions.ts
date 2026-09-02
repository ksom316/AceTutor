import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeClues, type CrosswordClue } from "@/lib/crossword";

const schema = z.object({
  courseId: z.string().optional(), // Optional for backward compatibility, but should be provided
  courseTitle: z.string().min(1).max(200),
  courseSummary: z.string().max(2000).optional(),
  mode: z.enum([
    "general",
    "ask",
    "explain",
    "crossword_json",
    "summarize",
    "test",
    "recommend",
  ]),
  question: z.string().max(2000).optional(),
  moduleTitle: z.string().max(200).optional(),
  moduleSummary: z.string().max(2000).optional(),
  performanceSummary: z.string().max(2000).optional(),
  // crossword_json only: how many answer/clue pairs to generate, and the
  // course's real module titles so the vocabulary stays on-syllabus.
  wordCount: z.number().int().min(4).max(20).optional(),
  topicTitles: z.array(z.string().max(120)).max(30).optional(),
});

// The tutor is served — for free — through OpenRouter's OpenAI-compatible
// /chat/completions endpoint with a single free OPENROUTER_API_KEY.
// Free-tier model ids shift over time, so the roster is overridable via env.
// Browse the current free roster at https://openrouter.ai/models?max_price=0
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Models are tried in order; if one is down, rate-limited, or delisted, the
// next takes over. OpenRouter's free roster changes often, so the whole list
// can be overridden from the environment without a code change:
//
//   OPENROUTER_MODELS="id1:free,id2:free,openrouter/free"   (comma-separated, whole list)
//
// or per-slot via OPENROUTER_MODEL_GEMINI / OPENROUTER_MODEL_GPT / OPENROUTER_MODEL
// (kept for backward compat — they are just "slot 1/2/3" now).
//
// The defaults below were verified against OpenRouter's live catalogue and the
// project's own key on 2026-08-31: `minimax/minimax-m3:free` returns clean
// JSON in both response_format and plain mode. The previous defaults
// (`google/gemma-3-27b-it:free`, `openai/gpt-oss-20b:free`) had lost their free
// tier — OpenRouter answered 404 "unavailable for free" — and `openrouter/free`
// returns null content when response_format:json_object is set.
// Browse current free ids at https://openrouter.ai/models?max_price=0
const MODELS = (
  process.env.OPENROUTER_MODELS
    ? process.env.OPENROUTER_MODELS.split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : [
        process.env.OPENROUTER_MODEL_GEMINI ?? "minimax/minimax-m3:free",
        process.env.OPENROUTER_MODEL_GPT ?? "nvidia/nemotron-3-super-120b-a12b:free",
        process.env.OPENROUTER_MODEL ?? "openrouter/free",
      ]
).filter(Boolean);

/** Abort signal that trips after `ms`, so a stalled upstream can't hang a request. */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // Don't let a pending timer hold the process open once the work is done.
  (timer as unknown as { unref?: () => void }).unref?.();
  return controller.signal;
}

/** Cancellable sleep — used for the hedge timer, which usually gets torn down early. */
function delay(ms: number) {
  let cancel = () => {};
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    cancel = () => clearTimeout(timer);
  });
  return { promise, cancel };
}

/** Small TTL + LRU cache. Keeps repeat lookups off the network entirely. */
function createTtlCache<T>(ttlMs: number, max: number) {
  const entries = new Map<string, { value: T; expires: number }>();
  return {
    get(key: string): T | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key); // re-insert so this key counts as most recently used
      entries.set(key, hit);
      return hit.value;
    },
    set(key: string, value: T) {
      if (entries.size >= max) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}

// Wikipedia supplements the tutor's knowledge: we search the MediaWiki API
// for relevant articles and pass plain-text extracts as reference material.
// The model may also draw on its own knowledge for anything course-related,
// so a thin or missing extract never blocks an answer or a puzzle.
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

// This lookup sits in front of every AI call, so it is budgeted tightly: one
// round trip, a shared cache, and two separate deadlines. The soft deadline is
// how long a request will wait for the material before giving up on it; the
// hard one caps the fetch itself. Missing material costs nothing — the model
// just answers from its own knowledge instead.
const WIKI_SOFT_DEADLINE_MS = 1200;
const WIKI_TIMEOUT_MS = 5000;
const WIKI_TTL_MS = 6 * 60 * 60 * 1000;
/** Per-article and total caps — a long prompt costs prefill time on every call. */
const WIKI_EXTRACT_CHARS = 1200;
const WIKI_TOTAL_CHARS = 3600;

/** The slices of the MediaWiki response we actually read. */
type WikiResponse = {
  query?: { pages?: Record<string, { title?: string; extract?: string }> };
};

const wikiCache = createTtlCache<string>(WIKI_TTL_MS, 200);
const wikiInflight = new Map<string, Promise<string>>();

async function loadWikipediaContext(query: string): Promise<string> {
  // generator=search feeds the search hits straight into prop=extracts, so
  // this is a single request rather than the search-then-fetch pair it takes
  // to do the same thing in two steps.
  const qs = new URLSearchParams({
    format: "json",
    origin: "*",
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "3",
    prop: "extracts",
    explaintext: "1",
    exintro: "1",
    exlimit: "max",
  });
  const res = await fetch(`${WIKIPEDIA_API}?${qs}`, {
    headers: { "User-Agent": "AceTutor/1.0 (course tutor)" },
    signal: timeoutSignal(WIKI_TIMEOUT_MS),
  });
  if (!res.ok) return "";
  const json = (await res.json()) as WikiResponse;
  return Object.values(json?.query?.pages ?? {})
    .filter((p) => p.title && p.extract)
    .map((p) => `### Reference: "${p.title}"\n${p.extract!.slice(0, WIKI_EXTRACT_CHARS)}`)
    .join("\n\n")
    .slice(0, WIKI_TOTAL_CHARS);
}

function fetchWikipediaContext(query: string): Promise<string> {
  const key = query.trim().toLowerCase();
  if (!key) return Promise.resolve("");

  const cached = wikiCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  // Concurrent callers — the games page fires several generations at once —
  // share one lookup instead of each paying for its own round trip.
  let pending = wikiInflight.get(key);
  if (!pending) {
    pending = loadWikipediaContext(key)
      .catch(() => "")
      .then((text) => {
        wikiCache.set(key, text);
        wikiInflight.delete(key);
        return text;
      });
    wikiInflight.set(key, pending);
  }

  // Reference material is a bonus, never a blocker. A slow lookup is dropped
  // and the model starts without it, but the fetch is left running so the
  // result still lands in the cache for the next request on this topic.
  const soft = delay(WIKI_SOFT_DEADLINE_MS);
  return Promise.race([pending, soft.promise.then(() => "")]).finally(() => soft.cancel());
}

// Keeps repeat puzzles for one course from drawing the same handful of terms
// every time.
const CROSSWORD_ANGLES = [
  "core terminology and definitions",
  "tools, technologies, and techniques used in the field",
  "processes, methods, and workflows",
  "roles, artifacts, and deliverables",
  "principles, patterns, and best practices",
];

// Free-tier models are frequently slow or rate-limited, so attempts are hedged
// rather than run strictly one after another: the primary model gets a head
// start, and if it hasn't answered by the hedge deadline the next model is
// started alongside it. The first usable answer wins and the rest are aborted.
// A model that fails fast (a 429, say) hands over immediately — no waiting.
const REQUEST_TIMEOUT_MS = 25_000;
const HEDGE_AFTER_MS = 2_500;

/**
 * Race sentinel meaning "nobody has answered yet — widen the field". A real
 * answer is always a non-empty string, so null is unambiguous here.
 */
const HEDGE = null;

type CallOpts = { jsonObject?: boolean; maxTokens?: number };

async function callModel(
  model: string,
  messages: { role: string; content: string }[],
  apiKey: string,
  opts: CallOpts | undefined,
  signal: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = { model, messages };
  if (opts?.jsonObject) body.response_format = { type: "json_object" };
  // Capping the output is the single biggest lever on time-to-last-token.
  if (opts?.maxTokens) body.max_tokens = opts.maxTokens;

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
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`(${res.status}) ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const content = (json.choices?.[0]?.message?.content ?? "") as string;
  if (!content.trim()) throw new Error("returned an empty response");
  return content;
}

// Exported so the lecturer quiz generator (src/lib/lecturer-quiz.functions.ts)
// runs on the exact same server-side OpenRouter path — the API key never
// reaches the browser.
export async function callAI(
  messages: { role: string; content: string }[],
  opts?: CallOpts,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  // Safe diagnostic — boolean only, plus the model IDs being attempted. Never
  // logs the key or any auth header.
  console.info(
    `[callAI] OPENROUTER_API_KEY configured: ${Boolean(apiKey)} — roster: [${MODELS.join(", ")}]`,
  );
  if (!apiKey) {
    throw new Error(
      "AI tutor is not configured. Add a free OPENROUTER_API_KEY (get one at https://openrouter.ai/keys) to your environment.",
    );
  }

  const errors: string[] = [];
  const controllers: AbortController[] = [];
  const live: Promise<string>[] = [];

  const launch = (model: string) => {
    const controller = new AbortController();
    controllers.push(controller);
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const attempt = callModel(model, messages, apiKey, opts, controller.signal)
      .catch((e: unknown) => {
        errors.push(`${model} → ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      })
      .finally(() => clearTimeout(deadline));
    // Promise.any inspects this rejection later; mark it handled now so it
    // can't surface as an unhandled rejection while the hedge timer runs.
    attempt.catch(() => {});
    live.push(attempt);
  };

  try {
    for (let i = 0; i < MODELS.length; i++) {
      launch(MODELS[i]);

      // Last model: nothing left to hedge with, so just wait it out.
      if (i === MODELS.length - 1) return await Promise.any(live);

      const hedge = delay(HEDGE_AFTER_MS);
      // Widen the field when the hedge timer fires, or as soon as every
      // attempt so far has failed — whichever happens first.
      const exhausted = Promise.allSettled(live).then(() => HEDGE);
      try {
        const winner = await Promise.any([...live, hedge.promise.then(() => HEDGE), exhausted]);
        if (winner !== HEDGE) return winner;
      } finally {
        hedge.cancel();
      }
    }
  } catch {
    // Promise.any rejected — every model failed. Fall through to the throw.
  } finally {
    // Whether we won or lost, no attempt still in flight is of any use.
    for (const c of controllers) c.abort();
  }

  throw new Error(`AI tutor error: all models failed. ${errors.join(" | ")}`);
}

// Output caps per mode. Tutor answers are meant to be short and scannable, so
// these are set to what a good answer actually needs rather than left open.
const MAX_TOKENS: Record<string, number> = {
  general: 900,
  ask: 900,
  explain: 900,
  summarize: 700,
  test: 600,
  recommend: 700,
};
const CROSSWORD_JSON_MAX_TOKENS = 1800;

// Prose answers to the same question about the same course/module are stable
// enough to reuse for a while, so a repeat ask returns instantly. Crossword
// generation deliberately varies every run and is never cached.
const ANSWER_TTL_MS = 30 * 60 * 1000;
const CACHEABLE_MODES = new Set(["general", "ask", "explain", "summarize", "recommend"]);
const answerCache = createTtlCache<string>(ANSWER_TTL_MS, 300);
const answerInflight = new Map<string, Promise<string>>();

// The student's saved explanation-style preference (learning_preferences.
// explanation_style) shapes HOW an `ask` / `explain` answer is written — never
// what it says. Fetched server-side from the authenticated user's own row; a
// client-supplied value is never trusted. Missing preference → default voice.
const EXPLANATION_STYLE_GUIDANCE: Record<string, string> = {
  concise:
    "Lead with the key idea and keep the answer short — cut anything non-essential while staying accurate and genuinely useful.",
  detailed:
    "Explain thoroughly: include the useful context and break down the important reasoning rather than just stating conclusions.",
  step_by_step:
    "Structure the answer as a clear ordered sequence of steps, make each step explicit, and don't skip reasoning needed to follow it.",
  example_first:
    "Where it helps, open with a concrete worked example, then explain the underlying concept.",
};

/** Split a raw model answer into the shape the client expects. */
function formatAnswer(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("NOT_RELATED:")) {
    return {
      answer: "",
      related: false as const,
      reason: trimmed.replace(/^NOT_RELATED:\s*/, ""),
    };
  }
  return { answer: raw, related: true as const };
}

export const askCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    
    // Check enrollment if courseId is provided
    if (data.courseId) {
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", userId)
        .eq("course_id", data.courseId)
        .maybeSingle();
      
      if (!enrollment) {
        throw new Error("You must be enrolled in this course to use the AI tutor.");
      }
    }

    // How this student likes explanations written. Only `ask` / `explain`
    // consume it, and only when a row + value exist. Read from the caller's own
    // learning_preferences row (RLS-scoped) — never from client input.
    let explanationStyle: string | null = null;
    if (data.mode === "ask" || data.mode === "explain") {
      const { data: prefs } = await supabase
        .from("learning_preferences")
        .select("explanation_style")
        .eq("user_id", userId)
        .maybeSingle();
      explanationStyle = prefs?.explanation_style ?? null;
    }
    const styleGuidance =
      (explanationStyle && EXPLANATION_STYLE_GUIDANCE[explanationStyle]) || null;

    const system =
      "You are AceTutor, an AI course tutor embedded in a learning dashboard. You help with the specific course the student is currently studying — including its modules, prerequisites, adjacent concepts, tools, and real-world applications. Prefer the REFERENCE MATERIAL in the prompt when it covers the topic, but when it is thin or missing, answer confidently from your own knowledge of the subject — a student should always get a tangible, useful answer to a course-related question. NEVER mention, cite, name, or hint at where any material comes from; present everything as course knowledge in your own words, with no citations, source names, or article titles. Use Markdown with short paragraphs, bullet points, and concrete examples.";

    // Prevent recommendations when there is no quiz performance data.
    if (data.mode === "recommend" && !data.performanceSummary?.trim()) {
      return {
        related: true as const,
        answer: "",
      };
    }

    // Repeat asks short-circuit before the reference lookup and the model call.
    const cacheKey = CACHEABLE_MODES.has(data.mode)
      ? JSON.stringify([
          data.mode,
          data.courseTitle,
          data.moduleTitle ?? "",
          data.question ?? "",
          data.performanceSummary ?? "",
          explanationStyle ?? "",
        ])
      : null;
    if (cacheKey) {
      const cached = answerCache.get(cacheKey);
      if (cached !== undefined) return formatAnswer(cached);
      // An identical request is already running — ride along with it.
      const existing = answerInflight.get(cacheKey);
      if (existing) return formatAnswer(await existing);
    }

    const courseCtx = `Course: "${data.courseTitle}"${data.courseSummary ? `\nCourse summary: ${data.courseSummary}` : ""}`;
    const moduleCtx = data.moduleTitle
      ? `\nFocused module: "${data.moduleTitle}"${data.moduleSummary ? ` — ${data.moduleSummary}` : ""}`
      : "";
    const perfCtx = data.performanceSummary
      ? `\nStudent performance:\n${data.performanceSummary}`
      : "";

    // Retrieve reference material from Wikipedia only. Recommendations are
    // derived purely from the student's own performance data, so a lookup
    // there would be pure latency — skip it.
    const wikiQuery = [
      data.moduleTitle ?? data.courseTitle,
      data.mode === "ask" ? data.question : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);
    const wikiCtx = data.mode === "recommend" ? "" : await fetchWikipediaContext(wikiQuery);
    const sourceCtx = wikiCtx
      ? `\n\n--- REFERENCE MATERIAL (prefer this when it covers the topic; supplement freely with your own knowledge of the subject — never reveal or name where it comes from) ---\n${wikiCtx}\n--- END OF REFERENCE MATERIAL ---`
      : `\n\n(No reference material could be retrieved for this topic. Answer from your own knowledge of the subject instead — do NOT mention any external source or the absence of material.)`;
    const fullCtx = `${courseCtx}${moduleCtx}${perfCtx}${sourceCtx}`;

    if (data.mode === "crossword_json") {
      const wordCount = data.wordCount ?? 12;
      const angle = CROSSWORD_ANGLES[Math.floor(Math.random() * CROSSWORD_ANGLES.length)];
      const moduleList =
        data.topicTitles && data.topicTitles.length > 0
          ? `\n\nThe course covers these modules — draw vocabulary from them:\n${data.topicTitles.map((t) => `- ${t}`).join("\n")}`
          : "";
      // Ask for extras: sanitizing drops anything with spaces, digits, or a
      // bad length, so a bare `wordCount` request often comes back short.
      const requested = Math.min(wordCount + 6, 20);
      const prompt = `${fullCtx}${moduleList}\n\nGenerate ${requested} crossword entries for a vocabulary puzzle on this course. This round, emphasize ${angle}.

Rules for every entry:
- "answer": ONE single word, 3 to 12 letters, English letters only. No spaces, hyphens, digits, abbreviations, acronyms, or proper nouns. It must be a real term a student of this course would learn.
- "clue": a crossword-style clue for that answer — one short line, never containing the answer itself or any word sharing its root.
- "hint": a shorter, more direct nudge for a stuck student — mention the category and the first letter, but still never write the answer out.
- Vary answer lengths, and prefer terms that share common letters so they can interlock.
- Never mention or hint at where the material came from.

Respond ONLY with strict JSON in this shape, no prose:
{ "words": [ { "answer": string, "clue": string, "hint": string } ] }`;

      const raw = await callAI(
        [
          {
            role: "system",
            content:
              "You output ONLY valid JSON matching the requested schema. No markdown fences.",
          },
          { role: "user", content: prompt },
        ],
        { jsonObject: true, maxTokens: CROSSWORD_JSON_MAX_TOKENS },
      );

      let cleaned: CrosswordClue[] = [];
      try {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        const jsonText = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
        const parsed = JSON.parse(jsonText);
        cleaned = sanitizeClues(parsed?.words, wordCount);
      } catch {
        throw new Error("Could not generate a crossword. Please try again.");
      }
      // Too few words can't interlock into a puzzle worth solving; the caller
      // falls back to course-derived terms when this throws.
      if (cleaned.length < 4) throw new Error("Could not generate a crossword. Please try again.");
      return { related: true as const, crossword: cleaned, answer: "" };
    }

    let userPrompt = "";
    switch (data.mode) {
      case "general":
        userPrompt = `${fullCtx}\n\nGive a clear, well-structured general overview of this course: what it is, key topics, why it matters, and how to approach learning it.`;
        break;
      case "explain":
        userPrompt = `${fullCtx}\n\nExplain the key concepts of ${data.moduleTitle ?? "this course"} clearly with examples a student can follow.`;
        break;
      case "summarize":
        userPrompt = `${fullCtx}\n\nSummarize the lecture material for ${data.moduleTitle ?? "this course"} as concise bullet points a student can revise from.`;
        break;
      case "test":
        userPrompt = `${fullCtx}\n\nAsk the student 5 progressively harder open-ended questions to test their knowledge of ${data.moduleTitle ?? "this course"}. Do NOT give the answers — invite them to attempt first.`;
        break;
      case "recommend":
        userPrompt = `${fullCtx}

      Based on the student's performance data, give 3-5 personalized study recommendations.

      - Prioritize the student's weakest modules.
      - Only recommend modules listed above; never invent modules or quizzes.
      - Explain why each module needs attention and what the student should review.
      - After recommending a weak module, tell the student to retake its quiz after studying to check their improvement.
      - If a module has not been attempted, do not call it weak; it can be recommended as the next module to study.
      - If the student is performing well, recommend an appropriate next module or continued practice.
      - Be concrete, concise, and supportive.
      - Use Markdown bullet points.`;
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

    // Explanation-style preference only reshapes the two explanatory modes.
    if (styleGuidance && (data.mode === "ask" || data.mode === "explain")) {
      userPrompt += `\n\n(Presentation preference — apply this to how you write the answer; never mention or reveal it: ${styleGuidance})`;
    }

    const running = callAI(
      [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: MAX_TOKENS[data.mode] ?? 900 },
    );

    if (!cacheKey) return formatAnswer(await running);

    const pending = running
      .then((value) => {
        answerCache.set(cacheKey, value);
        return value;
      })
      .finally(() => answerInflight.delete(cacheKey));
    // A failure is surfaced to this caller below; keep it off the global
    // unhandled-rejection path for any caller that rode along and left.
    pending.catch(() => {});
    answerInflight.set(cacheKey, pending);
    return formatAnswer(await pending);
  });
