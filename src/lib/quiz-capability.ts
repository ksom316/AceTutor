/**
 * What AceTutor's AI quiz generator can actually use as input, right now.
 *
 * Pure module — imported by both the browser (to show a capability summary and
 * enable/disable "Generate with AI" BEFORE any request) and the server function
 * (to independently decide what is sent to the model). Keeping the rule in one
 * place means the two can never disagree.
 *
 * Current capability:
 *   - text lesson body_md            -> analysable text            ("Analysed")
 *   - a lecturer-written summary on a
 *     video / audio / slides lesson  -> analysable text            ("Summary used")
 *   - the video / audio / PDF file
 *     or link itself                 -> NOT analysable yet         ("Not analysed")
 *
 * There is no video transcription, audio transcription, or PDF/slide text
 * extraction in the pipeline. A source is only ever "Analysed" / "Summary used"
 * when real lecturer-authored text is sent to the model.
 */

/** Minimum trimmed length for a body / summary to count as usable content. */
export const MIN_ANALYSABLE_CHARS = 30;

export type QuizSourceStatus = "analysed" | "summary" | "unsupported" | "empty";

export type QuizSourceInfo = {
  title: string;
  modality: string;
  status: QuizSourceStatus;
  /** Friendly reason, shown after a ⚠ for unsupported / empty sources. */
  note: string;
};

export type LessonForCapability = {
  title: string | null;
  modality: string;
  body_md: string | null;
};

const UNSUPPORTED_NOTE: Record<string, string> = {
  video: "video analysis is not currently available",
  audio: "audio transcription is not currently available",
  slides: "PDF / slide extraction is not currently available",
};

/** Classify one lesson as an AI source. */
export function classifyLessonSource(lesson: LessonForCapability): QuizSourceInfo {
  const title = lesson.title?.trim() || "Untitled lesson";
  const body = (lesson.body_md ?? "").trim();
  const hasText = body.length >= MIN_ANALYSABLE_CHARS;

  if (lesson.modality === "text") {
    return hasText
      ? { title, modality: "text", status: "analysed", note: "" }
      : { title, modality: "text", status: "empty", note: "this text lesson has no content" };
  }

  if (hasText) {
    return {
      title,
      modality: lesson.modality,
      status: "summary",
      note: `the written summary will be used — the ${lesson.modality} itself isn't analysed`,
    };
  }
  return {
    title,
    modality: lesson.modality,
    status: "unsupported",
    note: UNSUPPORTED_NOTE[lesson.modality] ?? "this material cannot currently be analysed",
  };
}

export type CapabilityReport = {
  sources: QuizSourceInfo[];
  /** Sources whose text will actually be sent to the model. */
  analysable: QuizSourceInfo[];
  unsupported: QuizSourceInfo[];
  analysableCount: number;
};

export function analyseModuleCapability(lessons: LessonForCapability[]): CapabilityReport {
  const sources = lessons.map(classifyLessonSource);
  const analysable = sources.filter((s) => s.status === "analysed" || s.status === "summary");
  const unsupported = sources.filter((s) => s.status === "unsupported");
  return { sources, analysable, unsupported, analysableCount: analysable.length };
}

/* ---- structured errors shared between the server fn and the UI ---- */

export type QuizGenErrorCode =
  | "NO_ANALYSABLE_CONTENT"
  | "UNSUPPORTED_MEDIA"
  | "INVALID_QUESTION_COUNT"
  | "NOT_A_LECTURER"
  | "MODULE_NOT_FOUND"
  | "WRONG_COURSE"
  | "AI_GENERATION_FAILED";

export const QUIZ_GEN_ERROR_MESSAGES: Record<QuizGenErrorCode, string> = {
  NO_ANALYSABLE_CONTENT:
    "This module doesn't contain any learning material AceTutor's AI can analyse yet. AI quiz generation currently needs analysable text content — add a text lesson or a written summary, or build the quiz manually.",
  UNSUPPORTED_MEDIA:
    "This module only contains learning materials that AceTutor's current AI system cannot analyse yet (video, audio or slides). Please add a text lesson or a written summary, or create the quiz manually.",
  INVALID_QUESTION_COUNT: "Choose a whole number of questions between 1 and 50.",
  NOT_A_LECTURER: "Only a lecturer can generate a quiz.",
  MODULE_NOT_FOUND: "This module could not be found.",
  WRONG_COURSE: "You can only build quizzes for modules in your assigned course.",
  AI_GENERATION_FAILED:
    "AceTutor was unable to generate the quiz from the available learning material. Please try again, or create the questions manually.",
};

const CODES = new Set(Object.keys(QUIZ_GEN_ERROR_MESSAGES));

/** Map a thrown server error to a friendly message; never leak raw errors. */
export function quizGenErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (CODES.has(raw)) return QUIZ_GEN_ERROR_MESSAGES[raw as QuizGenErrorCode];
  return QUIZ_GEN_ERROR_MESSAGES.AI_GENERATION_FAILED;
}
