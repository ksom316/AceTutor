import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeClues, type CrosswordClue } from "@/lib/crossword";
import {
  computeModulePerformances,
  type ModuleState,
  type PerfAttempt,
} from "@/lib/quiz-performance";

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
    "guide",
    // Contextual "Explain with AceTutor" — a student highlighted a passage in a
    // lesson and wants a deeper explanation / follow-up. Stateless (no
    // conversationId): reuses the same course-context + preference machinery.
    "explain_selection",
    "explain_simpler",
    "another_example",
    "quiz_selection",
  ]),
  // When present, this call is part of a persistent conversation: the server
  // loads a bounded slice of that conversation's recent history for context and,
  // on success, appends the user turn + the assistant reply to it. The
  // conversation must belong to the caller AND to `courseId` (course isolation).
  conversationId: z.string().uuid().optional(),
  question: z.string().max(2000).optional(),
  moduleTitle: z.string().max(200).optional(),
  moduleSummary: z.string().max(2000).optional(),
  // The focused module's topic id, when the student has a module in focus. Used
  // server-side (teaching modes only) to pull THAT module's own lesson material
  // and to derive THAT module's quiz standing from the caller's own attempts —
  // never trusted for anything the client couldn't already read.
  moduleTopicId: z.string().max(64).optional(),
  performanceSummary: z.string().max(2000).optional(),
  // crossword_json only: how many answer/clue pairs to generate, and the
  // course's real module titles so the vocabulary stays on-syllabus.
  wordCount: z.number().int().min(4).max(20).optional(),
  topicTitles: z.array(z.string().max(120)).max(30).optional(),
  // Contextual "Explain with AceTutor" only: the exact passage the student
  // highlighted in a lesson, the lesson's title, and (for follow-ups) the
  // explanation they already saw. Lesson content is public course material and
  // none of this carries a secret or personal identifier.
  selectedText: z.string().trim().min(1).max(1200).optional(),
  lessonTitle: z.string().max(200).optional(),
  priorExplanation: z.string().max(4000).optional(),
});

// The tutor is served through OpenRouter's OpenAI-compatible /chat/completions
// endpoint with a single OPENROUTER_API_KEY. The roster below is a paid,
// production/presentation-ready set of models; ids shift over time, so the
// whole roster stays overridable via env.
// Browse the current catalogue at https://openrouter.ai/models
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Read a server-side env var, tolerating a value that was accidentally pasted
 * WITH surrounding quotes or padding — e.g. `OPENROUTER_API_KEY="sk-or-…"` in a
 * .env file or a hosting dashboard. A quoted key reaches OpenRouter as
 * `Bearer "sk-or-…"` and is rejected with 401 "Missing Authentication header",
 * which is indistinguishable at the UI from any other AI outage. Trimming here
 * removes that whole failure class. Returns undefined for missing/blank.
 */
export function cleanEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw == null) return undefined;
  let v = raw.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}

// Models are tried STRICTLY in order — try primary, then secondary, then the
// emergency fallback; if one is down, rate-limited, or delisted, the next takes
// over. The whole list can be overridden from the environment without a code
// change:
//
//   OPENROUTER_MODELS="id1,id2,id3"   (comma-separated, whole list)
//
// or per-slot via OPENROUTER_MODEL_GEMINI / OPENROUTER_MODEL_GPT / OPENROUTER_MODEL
// (kept for backward compat — they are just "slot 1/2/3" now).
//
// Paid production/presentation roster, verified against OpenRouter's live
// catalogue (https://openrouter.ai/api/v1/models) on 2026-09-08. Three
// providers on purpose, so an outage at one does not take the tutor down:
//   1. anthropic/claude-sonnet-5   — PRIMARY: strong reasoning model for
//      tutoring, explanations, Study Paths and Guide Me.
//   2. openai/gpt-4.1              — SECONDARY: reliable general-purpose fallback.
//   3. google/gemini-2.5-flash     — EMERGENCY: reliable lower-cost fallback.
// All three support response_format:json_object; the per-caller plain-mode
// retry still covers any model that ignores json mode.
const MODELS = (
  cleanEnv("OPENROUTER_MODELS")
    ? cleanEnv("OPENROUTER_MODELS")!
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : [
        cleanEnv("OPENROUTER_MODEL_GEMINI") ?? "anthropic/claude-sonnet-5",
        cleanEnv("OPENROUTER_MODEL_GPT") ?? "openai/gpt-4.1",
        cleanEnv("OPENROUTER_MODEL") ?? "google/gemini-2.5-flash",
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

/** Cancellable sleep — used as the Wikipedia lookup's soft deadline, which
 *  usually gets torn down early. */
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

// Models are tried STRICTLY ONE AT A TIME: the primary model runs to completion
// (success or failure) before any fallback is contacted. There is never more
// than one OpenRouter request in flight for a single user action, and a
// successful action makes exactly one model request — this is what keeps the
// free-tier daily request budget from draining several models deep per action.
// Each individual attempt is still capped by REQUEST_TIMEOUT_MS.
const REQUEST_TIMEOUT_MS = 25_000;

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
      "HTTP-Referer": cleanEnv("OPENROUTER_SITE_URL") ?? "https://acetutor.app",
      "X-Title": "AceTutor",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    // Diagnostic only: the HTTP status plus the provider's OWN short error
    // message when the body is JSON (e.g. "User not found." for a dead key,
    // "Rate limit exceeded"). A non-JSON body is dropped — it can echo the
    // request, which carries course material and the student's question.
    const bodyText = await res.text().catch(() => "");
    let providerMsg = "";
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } };
      if (typeof parsed?.error?.message === "string") providerMsg = parsed.error.message;
    } catch {
      /* non-JSON — omit */
    }
    throw new Error(`HTTP ${res.status}${providerMsg ? ` — ${providerMsg.slice(0, 140)}` : ""}`);
  }
  const json = await res.json();
  const choice = json.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const rawContent = typeof message.content === "string" ? message.content : "";
  // Reasoning-tuned models (several are on OpenRouter's current free roster)
  // return their chain-of-thought either inline in `content` wrapped in
  // <think>…</think>, or in a separate `reasoning` field. Callers want only the
  // final answer / JSON — never the thinking.
  const reasoning = typeof message.reasoning === "string" ? message.reasoning : "";
  const answer = stripModelReasoning(rawContent, reasoning);

  // Diagnostic (model output only — no user data): what came back and why a
  // downstream JSON parse might choke.
  console.info(
    `[callModel] ${model} finish=${choice.finish_reason ?? "?"} contentLen=${rawContent.length} reasoningLen=${reasoning.length} answerLen=${answer.length} head=${JSON.stringify(answer.slice(0, 200))}`,
  );

  if (!answer.trim()) throw new Error("returned an empty response");
  return answer;
}

/**
 * Strip a reasoning model's chain-of-thought so callers see only the final
 * answer. Removes complete <think>/<thinking>/<reasoning> blocks plus a
 * dangling opener (a response truncated mid-thought) and any stray closing
 * tag. If that leaves nothing but the model streamed its whole answer into the
 * separate `reasoning` channel instead, fall back to that.
 */
export function stripModelReasoning(content: string, reasoning = ""): string {
  const out = content
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(think|thinking|reasoning)>[\s\S]*$/i, "")
    .replace(/<\/?(think|thinking|reasoning)>/gi, "")
    .trim();
  return out || reasoning.trim();
}

// Exported so the lecturer quiz generator (src/lib/lecturer-quiz.functions.ts)
// runs on the exact same server-side OpenRouter path — the API key never
// reaches the browser.
export async function callAI(
  messages: { role: string; content: string }[],
  opts?: CallOpts,
): Promise<string> {
  const apiKey = cleanEnv("OPENROUTER_API_KEY");
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

  // Sequential fallback — one model at a time. The primary model is awaited to
  // completion; only if it fails (HTTP error, timeout, empty/invalid response)
  // is the next model contacted. No Promise racing, no hedging: a single user
  // action makes at most ONE successful model request, and never two requests
  // at once.
  const errors: string[] = [];

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await callModel(model, messages, apiKey, opts, controller.signal);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      // `reason` is only "HTTP <status> — <provider msg>" / "returned an empty
      // response" / an abort message — never the API key or user content.
      errors.push(`${model} → ${reason}`);
      const next = MODELS[i + 1];
      console.warn(
        `[callAI] model failed (${model}: ${reason})` +
          (next ? ` → trying fallback (${next})` : ""),
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  // Every model failed. Log the reasons ONCE at the source so it is diagnosable
  // from the server logs without shipping provider internals to the browser.
  console.error(
    `[callAI] all ${MODELS.length} models failed — ${errors.join(" | ") || "no attempts ran"}`,
  );
  // Stable, generic message for the caller (and the browser payload): the
  // chat UI already shows its own "Couldn't get a response" state.
  throw new Error("The AI service is temporarily unavailable. Please try again in a moment.");
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
  guide: 650,
  explain_selection: 750,
  explain_simpler: 650,
  another_example: 550,
  quiz_selection: 450,
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

// `wrong_answer_help` only applies when the student's message is about a mistake
// or misconception. It shapes HOW a correction is written, never the facts.
const WRONG_ANSWER_HELP_GUIDANCE: Record<string, string> = {
  simple: "keep the correction short and plainly worded.",
  detailed:
    "explain why the mistaken idea is wrong and the underlying concept it comes from, with the reasoning spelled out.",
  example: "lead the correction with a concrete example that makes the correct idea obvious.",
  similar_practice:
    "after correcting the mistake, add one or two short practice questions (with their answers) similar to what tripped them up.",
};

// Modes where the answer teaches a concept — these consume the student's
// explanation-style preference and (for `ask` / `guide`) the wrong-answer-help
// preference, and these are the modes that pull the focused module's own lesson
// material.
const TEACHING_MODES = new Set([
  "ask",
  "explain",
  "summarize",
  "test",
  "guide",
  "explain_selection",
  "explain_simpler",
  "another_example",
  "quiz_selection",
]);

// ---- Guide Me (Socratic tutoring) --------------------------------------------
// Guide Me is NOT an answer generator. It coaches the student to the answer one
// step at a time. It stays a good tutor, not an obstruction: simple facts the
// student clearly needs are given directly; the Socratic method is applied to
// the reasoning, not to trivia.
const GUIDE_SYSTEM =
  "GUIDED MODE IS ACTIVE. You are tutoring Socratically, not answering immediately.\n" +
  "- First work out what the student is actually trying to understand or solve from their message and the conversation so far.\n" +
  "- Reply with only ONE thing per turn: a single guiding question, one hint, or one small reasoning step — then stop and wait for the student's reply. Keep it short.\n" +
  "- Use the student's last reply and recent Guide Me exchanges to choose the next move. If their reasoning is right, say so briefly and move them to the next thing they still need to understand. If it's wrong, normally give a useful nudge first, but do not keep nudging when recent replies show the student is not understanding.\n" +
  "- Treat concepts the student has correctly explained, applied, or demonstrated as understood. Do NOT keep asking questions about something the student has already shown they understand unless they later show confusion about it.\n" +
  "- Keep track of the student's progress from the recent conversation: what they understand, what they are still confused about, and what the next missing step is. Focus each new question or hint only on that next missing piece.\n" +
  "- Do not make the student repeatedly prove the same understanding. Once they clearly understand a step, acknowledge it briefly and advance.\n" +
  "- Escalate help gradually. If the student's replies show they are still confused, repeatedly incorrect, or not understanding the same point after two or three guided exchanges, stop the Socratic questioning and give the correct answer directly.\n" +
  "- If you have already given the student a hint or guiding question and they respond that they do not know, cannot figure it out, are still confused, or are stuck, STOP guiding and give the answer directly with a simple beginner-friendly explanation. Do not give another hint or ask another question about the same point. Also give the answer immediately whenever the student explicitly asks for it." +
  "- When giving a direct explanation, assume the student is a complete beginner. Break the idea into the smallest and easiest pieces possible, use simple everyday language, avoid unnecessary technical terms, and explain any technical term you must use.\n" +
  "- Explain the idea from the foundation first. Do not assume the student already understands prerequisite concepts unless the conversation clearly shows that they do.\n" +
  "- Prefer a simple real-world analogy, tiny example, or step-by-step example when it would make the concept easier to understand.\n" +
  "- When revealing the answer, explain WHY it is correct, not just what the final answer is.\n" +
  "- Never hide a simple fact the student obviously needs to proceed, such as a definition or formula name; state it plainly and keep guiding the reasoning around it.\n" +
  "- Do NOT dump the full solution up front, do NOT list all the steps at once, and do NOT ask more than one question at a time unless the escalation rule above says it is time to explain the answer.\n" +
  "- Stay grounded in this course's material and context above.";
// explanation_style shapes HOW Guide Me hints — never the correct content.

const GUIDE_STYLE_GUIDANCE: Record<string, string> = {
  concise: "Keep each hint to one or two sentences.",
  detailed:
    "Add a sentence of intuition or context around each hint, but still only advance one step per turn.",
  step_by_step:
    "Break the path into the smallest sensible sub-steps and reveal only the very next one each turn.",
  example_first:
    "When a hint would help, first give a short analogous worked example with different numbers/context, then ask the student to apply the same idea to their own problem.",
};

// lesson_format is a light touch in a text chat.
const GUIDE_FORMAT_GUIDANCE: Record<string, string> = {
  visual:
    "This student learns visually — where it would help, suggest sketching or drawing the structure, or describe it spatially.",
  written: "",
  audio: "",
};

// The focused module's own lessons are the authoritative source for anything
// course-specific. Capped so a long module can't blow up prefill latency.
const TUTOR_MATERIAL_TOTAL_CAP = 6000;
const TUTOR_MATERIAL_PER_LESSON_CAP = 2500;

function buildLessonMaterial(lessons: { title: string; body_md: string | null }[]): string {
  const parts: string[] = [];
  for (const l of lessons) {
    const body = (l.body_md ?? "").trim().slice(0, TUTOR_MATERIAL_PER_LESSON_CAP);
    if (!body) continue;
    parts.push(`## ${l.title}\n\n${body}`);
  }
  const material = parts.join("\n\n---\n\n").slice(0, TUTOR_MATERIAL_TOTAL_CAP);
  // Diagnostic (no content, no PII): rules out "missing content / broken
  // extraction" vs. an OpenRouter-side failure.
  console.info(
    `[buildLessonMaterial] lessons=${lessons.length} withText=${parts.length} chars=${material.length}`,
  );
  return material;
}

/**
 * One line of learning context for the focused module — tone and depth only,
 * never facts. Empty for "no-data" so a student with no quiz history gets no
 * invented performance talk.
 */
function moduleContextLine(state: ModuleState, average: number | null): string {
  switch (state) {
    case "weak":
      return `The student has found this module challenging so far (recent quiz average around ${average ?? 0}%). Be especially clear, patient and thorough. Do NOT say or imply the student is "bad at" this; a brief, encouraging suggestion to review it is fine, but do not dwell on scores.`;
    case "strong":
      return `The student is doing well on this module (recent quiz average around ${average ?? 0}%). Keep the explanation efficient and feel free to go a little deeper where it helps.`;
    case "insufficient":
      return `The student has started this module's quiz but has not answered enough of it for a reliable picture — do NOT characterise their performance or suggest they did poorly.`;
    default:
      return "";
  }
}

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

    // --- Conversation: validate ownership + course isolation, load bounded
    //     recent history. RLS also scopes ai_conversations to the caller, but the
    //     explicit checks are the real boundary and give a clear message.
    //
    // History is bounded by whole USER→ASSISTANT turns, newest first, so a slice
    // never ends up with an orphan (a user message whose reply was dropped, or
    // vice versa): ~6 turns AND ~4000 characters. The current user message is
    // NOT part of this — it is appended once, after the history, further down.
    const HISTORY_MAX_TURNS = 6;
    const HISTORY_MAX_CHARS = 4000;
    let history: { role: "user" | "assistant"; content: string }[] = [];
    if (data.conversationId) {
      const { data: convo } = await supabase
        .from("ai_conversations")
        .select("id, user_id, course_id")
        .eq("id", data.conversationId)
        .maybeSingle();
      if (!convo || convo.user_id !== userId) {
        throw new Error("This conversation could not be found.");
      }
      if (data.courseId && convo.course_id !== data.courseId) {
        throw new Error("This conversation belongs to a different course.");
      }

      // Pull a little more than we'll keep, oldest→newest.
      const { data: rows } = await supabase
        .from("ai_messages")
        .select("role, content, created_at")
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: false })
        .limit((HISTORY_MAX_TURNS + 3) * 2);
      const msgs = (rows ?? [])
        .reverse()
        .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));

      // Group into complete turns. Every persisted turn is a user row directly
      // followed by an assistant row (append_ai_turn writes them as a pair), so a
      // lone leading assistant or a lone trailing user is treated as its own
      // group and dropped-with-its-partner as a unit.
      const turns: { role: "user" | "assistant"; content: string }[][] = [];
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === "user" && msgs[i + 1]?.role === "assistant") {
          turns.push([msgs[i], msgs[i + 1]]);
          i++;
        } else {
          turns.push([msgs[i]]); // orphan — kept only if it survives trimming as the newest
        }
      }

      // Keep the newest turns within both budgets; drop oldest whole turns first.
      const kept: (typeof turns)[number][] = [];
      let chars = 0;
      for (let i = turns.length - 1; i >= 0; i--) {
        const turnChars = turns[i].reduce((n, m) => n + m.content.length, 0);
        if (kept.length >= HISTORY_MAX_TURNS) break;
        if (kept.length > 0 && chars + turnChars > HISTORY_MAX_CHARS) break;
        kept.unshift(turns[i]);
        chars += turnChars;
      }
      history = kept.flat();
    }

    const isTeaching = TEACHING_MODES.has(data.mode);
    const hasFocusedModule = isTeaching && !!data.moduleTopicId && !!data.moduleTitle;

    // Optional learning context, gathered in parallel. EVERY piece is advisory —
    // it shapes focus, tone, depth and formatting, never the facts — and every
    // fetch is fault-tolerant: if analytics, preferences or material can't be
    // read, the tutor still answers normally (just without that context).
    //
    // Scoping: preferences and quiz attempts are read from the CALLER's own
    // rows (learning_preferences / quiz_attempts are both RLS `*_select_own`),
    // and lessons are already public course content. Nothing here can surface
    // another student's data.
    const loadPrefs = async (): Promise<{
      explanation_style: string | null;
      wrong_answer_help: string | null;
      lesson_format: string | null;
    } | null> => {
      if (!isTeaching) return null;
      try {
        const { data: row } = await supabase
          .from("learning_preferences")
          .select("explanation_style, wrong_answer_help, lesson_format")
          .eq("user_id", userId)
          .maybeSingle();
        return row ?? null;
      } catch {
        return null;
      }
    };
    const loadModuleAttempts = async (): Promise<PerfAttempt[]> => {
      if (!hasFocusedModule) return [];
      try {
        const { data: rows } = await supabase
          .from("quiz_attempts")
          .select("id, topic_id, score, total, finished_at, answered_count, started_at")
          .eq("user_id", userId)
          .eq("topic_id", data.moduleTopicId!);
        return (rows ?? []) as PerfAttempt[];
      } catch {
        return [];
      }
    };
    const loadModuleLessons = async (): Promise<{ title: string; body_md: string | null }[]> => {
      if (!hasFocusedModule) return [];
      try {
        const { data: rows } = await supabase
          .from("lessons")
          .select("title, body_md, order_index")
          .eq("topic_id", data.moduleTopicId!)
          .order("order_index");
        return (rows ?? []) as { title: string; body_md: string | null }[];
      } catch {
        return [];
      }
    };

    // Confirm the focused module actually belongs to THIS course before any of
    // its material / standing is used for grounding. (Lessons are public and
    // attempts are the caller's own, so a mismatched topic can't leak another
    // student's or another course's private data — but it should not silently
    // ground a course-A conversation in course-B material.)
    const checkModuleInCourse = async (): Promise<boolean> => {
      if (!hasFocusedModule || !data.courseId) return !!hasFocusedModule;
      try {
        const { data: t } = await supabase
          .from("topics")
          .select("id")
          .eq("id", data.moduleTopicId!)
          .eq("course_id", data.courseId)
          .maybeSingle();
        return !!t;
      } catch {
        return false;
      }
    };

    const [prefs, moduleAttemptsRaw, moduleLessonsRaw, moduleInCourse] = await Promise.all([
      loadPrefs(),
      loadModuleAttempts(),
      loadModuleLessons(),
      checkModuleInCourse(),
    ]);
    const moduleAttempts = moduleInCourse ? moduleAttemptsRaw : [];
    const moduleLessons = moduleInCourse ? moduleLessonsRaw : [];

    // How this student likes explanations written. Consumed by the teaching
    // modes only, and only when a value exists. Never from client input.
    const explanationStyle = isTeaching ? (prefs?.explanation_style ?? null) : null;
    const wrongAnswerHelp =
      data.mode === "ask" || data.mode === "guide" ? (prefs?.wrong_answer_help ?? null) : null;
    const lessonFormat = data.mode === "guide" ? (prefs?.lesson_format ?? null) : null;
    const styleGuidance =
      (explanationStyle && EXPLANATION_STYLE_GUIDANCE[explanationStyle]) || null;
    const wrongHelpGuidance =
      (wrongAnswerHelp && WRONG_ANSWER_HELP_GUIDANCE[wrongAnswerHelp]) || null;
    // Guide Me maps the same saved preferences to Socratic-specific behaviour.
    const guideStyleGuidance = (explanationStyle && GUIDE_STYLE_GUIDANCE[explanationStyle]) || null;
    const guideFormatGuidance = (lessonFormat && GUIDE_FORMAT_GUIDANCE[lessonFormat]) || null;

    // The focused module's standing, derived through the shared performance
    // model so it matches every other surface (course page, My Performance,
    // Study Path gateway). Partial / insufficient attempts never read as "weak"
    // — the model gates that. "no-data" → no performance talk at all.
    const modulePerf =
      hasFocusedModule && data.moduleTitle
        ? (computeModulePerformances(
            [{ id: data.moduleTopicId!, title: data.moduleTitle }],
            moduleAttempts,
          )[0] ?? null)
        : null;
    const moduleState: ModuleState | null = modulePerf?.state ?? null;
    const moduleCtxLine = moduleState
      ? moduleContextLine(moduleState, modulePerf?.averageScore ?? null)
      : "";

    const system =
      "You are AceTutor, an AI course tutor embedded in a learning dashboard. You help with the specific course the student is currently studying — its modules, prerequisites, adjacent concepts, tools, and real-world applications.\n\n" +
      "Use information in this priority order: (1) COURSE MATERIAL provided below (the student's own lessons) — authoritative for anything specific to this course; (2) SUPPLEMENTARY REFERENCE material below — to fill gaps; (3) your own knowledge of the subject — for anything the material doesn't cover. Never fabricate course-specific details (module names, the exact definitions the course uses, etc.); if the material doesn't say, answer from general subject knowledge and keep it general.\n\n" +
      "Any learning context or presentation preference below affects only HOW you respond — your focus, tone, depth and formatting — never the facts. Only mention quiz performance or scores when it genuinely helps the student right now; never repeat scores in every answer.\n\n" +
      "NEVER mention, cite, name, or hint at where any material comes from; present everything as course knowledge in your own words, with no citations, source names, or article titles.\n\n" +
      "FORMATTING: Use Markdown with short paragraphs, concrete examples, and step-by-step layouts. For comparisons, relationships, classifications, and processes, prefer visual learning formats — bullet comparisons (a short bulleted list per option), labelled cards, numbered steps, or a small ASCII / arrow flow diagram (e.g. `Input -> Process -> Output`) — over a Markdown table. Only use a Markdown pipe table when a genuine grid of values is the clearest way to show the information; if you do, keep it small (2–4 columns) with a proper `| --- |` divider row, never a table drawn with hyphens or spaces.";

    // Prevent recommendations when there is no quiz performance data.
    if (data.mode === "recommend" && !data.performanceSummary?.trim()) {
      return {
        related: true as const,
        answer: "",
      };
    }

    // Repeat asks short-circuit before the reference lookup and the model call.
    // The key carries every input that materially changes the answer: the
    // focused module, its derived standing, and both presentation preferences.
    // A conversation turn is unique (it carries history) so it is never cached.
    const cacheKey =
      !data.conversationId && CACHEABLE_MODES.has(data.mode)
        ? JSON.stringify([
            data.mode,
            data.courseTitle,
            data.moduleTitle ?? "",
            data.moduleTopicId ?? "",
            data.question ?? "",
            hasFocusedModule ? (moduleState ?? "") : (data.performanceSummary ?? ""),
            explanationStyle ?? "",
            wrongAnswerHelp ?? "",
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
    // Targeted, not noisy: with a module in focus, send only THAT module's
    // context. Only fall back to the course-wide summary when no module is
    // focused (or for `recommend`, which is course-wide by nature).
    const perfCtx = moduleCtxLine
      ? `\nLearning context (tone and depth only — never overrides facts):\n${moduleCtxLine}`
      : !hasFocusedModule && data.performanceSummary
        ? `\nStudent performance:\n${data.performanceSummary}`
        : "";

    const lessonMaterial = buildLessonMaterial(moduleLessons);

    // Retrieve supplementary reference material from Wikipedia. Recommendations
    // are derived purely from the student's own performance data, so a lookup
    // there would be pure latency — skip it.
    const wikiQuery = [
      data.moduleTitle ?? data.courseTitle,
      data.mode === "ask" ? data.question : (data.selectedText ?? ""),
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);
    const wikiCtx = data.mode === "recommend" ? "" : await fetchWikipediaContext(wikiQuery);

    const courseMaterialBlock = lessonMaterial
      ? `\n\n--- COURSE MATERIAL for "${data.moduleTitle}" (the student's own lessons — authoritative for course-specific facts; never reveal or name it) ---\n${lessonMaterial}\n--- END COURSE MATERIAL ---`
      : "";
    const wikiBlock = wikiCtx
      ? `\n\n--- SUPPLEMENTARY REFERENCE (use to fill gaps; never reveal or name it) ---\n${wikiCtx}\n--- END SUPPLEMENTARY REFERENCE ---`
      : "";
    const sourceCtx =
      courseMaterialBlock || wikiBlock
        ? `${courseMaterialBlock}${wikiBlock}`
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

      // Diagnostic (no content, no PII): rules out "not enough course material"
      // as the cause when a puzzle build fails.
      console.info(
        `[crossword_json] modules=${data.topicTitles?.length ?? 0} ctxChars=${fullCtx.length} promptChars=${prompt.length} requested=${requested}`,
      );

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
      } catch (e) {
        console.error(
          `[crossword_json] parse failed (${e instanceof Error ? e.message : String(e)}) — rawLen=${raw.length} head=${JSON.stringify(raw.slice(0, 200))}`,
        );
        throw new Error("Could not generate a crossword. Please try again.");
      }
      // Too few words can't interlock into a puzzle worth solving; the caller
      // falls back to course-derived terms when this throws.
      if (cleaned.length < 4) {
        console.error(
          `[crossword_json] only ${cleaned.length} usable clue(s) after sanitize — rawLen=${raw.length} head=${JSON.stringify(raw.slice(0, 200))}`,
        );
        throw new Error("Could not generate a crossword. Please try again.");
      }
      return { related: true as const, crossword: cleaned, answer: "" };
    }

    // --- Persistent conversation path -------------------------------------------
    // One coherent thread: the grounding + preferences live in the system
    // message; the transcript so far is replayed as real turns; the current
    // request is one lean turn. `mode` is per-message, so Guide Me and the other
    // actions share the same conversation. Persistence happens only AFTER a
    // successful model reply, so a failed request never leaves a fake answer.
    if (data.conversationId) {
      const moduleLabel = data.moduleTitle || "this course";

      // What the student's message says, in plain words — this is what gets
      // stored and shown in the transcript.
      const turnDisplay =
        data.mode === "ask" || data.mode === "guide"
          ? (data.question ?? "").trim()
          : data.mode === "explain"
            ? `Explain the key concepts of ${moduleLabel}.`
            : data.mode === "summarize"
              ? `Summarise the lecture material for ${moduleLabel} as revision bullet points.`
              : data.mode === "test"
                ? `Test my knowledge of ${moduleLabel} — ask me questions one topic at a time.`
                : `Give me a general overview of this course.`;

      if (!turnDisplay) throw new Error("Please type a message.");

      // The instruction the model actually acts on for this turn. The
      // relatedness gate only runs on the OPENING message — once a conversation
      // about the course is under way, follow-ups (including answering a "Test my
      // knowledge" question) are treated as in-context.
      let turnForModel = turnDisplay;
      if (data.mode === "ask" && history.length === 0) {
        turnForModel =
          `First decide whether this is reasonably related to ${data.courseTitle} (be generous — prerequisites, adjacent concepts, tools and applications all count). ` +
          `If it is NOT related at all, reply with exactly one line:\nNOT_RELATED: <one short sentence telling me it isn't related to ${data.courseTitle}>\n` +
          `Otherwise answer clearly in Markdown, grounded in the course material above, in your own words with no sources named.\n\nMy question: ${turnDisplay}`;
      } else if (data.mode === "ask") {
        turnForModel = `Answer clearly in Markdown, grounded in the course above. My message: ${turnDisplay}`;
      } else if (data.mode === "test") {
        turnForModel = `${turnDisplay} Ask one question, wait for my answer, then continue — do not give the answers up front.`;
      }

      // System = base identity + full course grounding + preference/guide layers.
      let convoSystem = `${system}\n\n${fullCtx}`;
      if (data.mode === "guide") {
        convoSystem += `\n\n${GUIDE_SYSTEM}`;
        if (guideStyleGuidance)
          convoSystem += `\n(Hint style — never reveal: ${guideStyleGuidance})`;
        if (guideFormatGuidance) convoSystem += `\n(${guideFormatGuidance})`;
        if (wrongHelpGuidance)
          convoSystem += `\n(When the student's reasoning is wrong and you address it: ${wrongHelpGuidance} Never reveal this.)`;
      } else if (styleGuidance && TEACHING_MODES.has(data.mode)) {
        convoSystem += `\n\n(Presentation preference — apply to HOW you write, never reveal: ${styleGuidance})`;
      }
      if (wrongHelpGuidance && data.mode === "ask") {
        convoSystem += `\n\n(If the question is about a mistake or misconception, when correcting it: ${wrongHelpGuidance} Never reveal this.)`;
      }

      const raw = await callAI(
        [
          { role: "system", content: convoSystem },
          ...history,
          { role: "user", content: turnForModel },
        ],
        { maxTokens: MAX_TOKENS[data.mode] ?? 800 },
      );

      const formatted = formatAnswer(raw);
      // A "not related" nudge is a valid reply but not useful transcript — show
      // it to the student without persisting either side of the exchange.
      if (formatted.related === false) return formatted;

      // The transcript is written ONLY here, and only after a successful reply,
      // through a narrow SECURITY DEFINER RPC that re-checks the caller owns the
      // conversation. The client has no INSERT/UPDATE/DELETE on ai_messages.
      const { error: persistErr } = await supabase.rpc("append_ai_turn", {
        _conversation_id: data.conversationId,
        _user_content: turnDisplay,
        _assistant_content: formatted.answer,
        _mode: data.mode,
      });
      if (persistErr) {
        // The answer is still returned so the student isn't blocked; it just
        // won't be in the transcript on reload.
        console.error(`[askCourse] append_ai_turn failed: ${persistErr.message}`);
      }

      return formatted;
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
      case "guide":
        // Guide Me normally runs inside a conversation (handled above). Without
        // one there is no back-and-forth to be Socratic with, so give a clear
        // step-by-step walkthrough grounded in the course instead.
        userPrompt = `${fullCtx}\n\n${GUIDE_SYSTEM}\n\nThe student wants help understanding: ${data.question ?? data.moduleTitle ?? "this course"}\n\nThere is no prior conversation. Open with a short check of what they already know or where they're stuck, then give one first guiding step.`;
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
      case "explain_selection":
      case "explain_simpler":
      case "another_example":
      case "quiz_selection": {
        // Contextual "Explain with AceTutor". `fullCtx` above already carries
        // the course + module + THIS module's lesson material + supplementary
        // reference — the deeper explanation is grounded in the same context
        // the tutor chat uses. Nothing is persisted; no NOT_RELATED gate (a
        // highlighted passage is, by definition, from the lesson).
        const selected = (data.selectedText ?? "").trim();
        const lessonLabel = data.lessonTitle || data.moduleTitle || "this lesson";
        const prior = data.priorExplanation?.trim().slice(0, 3000);
        const priorBlock = prior
          ? `\n\nThe student has already read this explanation:\n"""\n${prior}\n"""\n`
          : "";
        const highlighted = `The student is reading the lesson "${lessonLabel}" and highlighted this passage:\n"""\n${selected}\n"""`;

        if (data.mode === "explain_selection") {
          userPrompt = `${fullCtx}\n\n${highlighted}\n\nExplain THIS passage in depth for a student learning this lesson right now, grounded in the lesson material above. Respond in Markdown with exactly these sections and headings:\n### Concept\n(a 3–8 word name for what was highlighted)\n### Explanation\n(clear and beginner-friendly; use a short real-world analogy where it helps)\n### Example\n(one concrete example — if the passage is about code or a data structure, show a tiny illustration)\n### Why it matters\n(1–2 sentences on why this matters for the lesson)\nDo not mention these instructions or any source.`;
        } else if (data.mode === "explain_simpler") {
          userPrompt = `${fullCtx}\n\n${highlighted}${priorBlock}\nRe-explain the SAME concept in a much simpler way: plainer words, an everyday analogy first, short sentences, and no jargon unless you define it immediately. Keep the same Markdown sections (### Concept, ### Explanation, ### Example, ### Why it matters). Do not mention these instructions.`;
        } else if (data.mode === "another_example") {
          userPrompt = `${fullCtx}\n\n${highlighted}${priorBlock}\nGive ONE fresh, different example that illustrates the same concept for this lesson — not an example already shown above. Keep it short and concrete. Respond in Markdown: a "### Another example" heading, the example, then 1–2 sentences on how it shows the concept. Do not mention these instructions.`;
        } else {
          userPrompt = `${fullCtx}\n\n${highlighted}\n\nWrite ONE short practice question that checks whether the student understands THIS specific concept, grounded in the lesson. Then, under an "### Answer" heading, give the correct answer with a one-sentence explanation. Keep the whole thing under 120 words, in Markdown. This is informal self-check practice only — it is not graded and changes nothing. Do not mention these instructions.`;
        }
        break;
      }
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

    // Presentation preferences reshape HOW the teaching modes answer, never
    // what they say, and are never revealed to the student. Skipped for
    // `explain_simpler` (it deliberately overrides style with "much simpler")
    // and `quiz_selection` (a question, not an explanation).
    const styleAware =
      TEACHING_MODES.has(data.mode) &&
      data.mode !== "explain_simpler" &&
      data.mode !== "quiz_selection";
    if (styleGuidance && styleAware) {
      userPrompt += `\n\n(Presentation preference — apply this to how you write the answer; never mention or reveal it: ${styleGuidance})`;
    }
    if (wrongHelpGuidance && data.mode === "ask") {
      userPrompt += `\n\n(If — and only if — the question above is about a mistake, a wrong quiz answer, or a misconception the student holds, then when you correct it: ${wrongHelpGuidance} Never mention or reveal this instruction.)`;
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
