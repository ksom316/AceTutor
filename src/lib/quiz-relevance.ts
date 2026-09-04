/**
 * Coarse "is this question obviously unrelated to its module" check for
 * OFFICIAL MODULE QUIZZES. Pure, deterministic, no network/AI call — a
 * lightweight shared-vocabulary heuristic the lecturer quiz builder runs before
 * a question is saved, so it can flag/block an obviously off-topic question
 * without ever rewriting what the lecturer wrote.
 *
 * Deliberately generous: a question clears the check as soon as it shares ONE
 * meaningful word with the module's own title / summary / lesson titles. This
 * is intentionally biased against false positives — it only catches a question
 * that shares NOTHING with the module, not one that is merely differently
 * worded. General Course Quizzes (course-wide by design) are out of scope.
 */

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "that",
  "this",
  "with",
  "from",
  "have",
  "has",
  "had",
  "which",
  "what",
  "when",
  "where",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "true",
  "false",
  "following",
  "correct",
  "incorrect",
  "best",
  "describes",
  "describe",
  "used",
  "use",
  "using",
  "also",
  "than",
  "then",
  "them",
  "they",
  "their",
  "about",
  "into",
  "onto",
  "over",
  "under",
  "above",
  "below",
  "between",
  "does",
  "did",
  "done",
  "doing",
  "will",
  "would",
  "should",
  "could",
  "can",
  "not",
  "never",
  "always",
  "most",
  "least",
  "each",
  "every",
  "some",
  "any",
  "your",
  "you",
  "one",
  "two",
  "three",
  "four",
  "five",
  "first",
  "second",
  "third",
  "answer",
  "choice",
  "choices",
  "question",
  "statement",
  "statements",
  "select",
]);

function significantWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9']{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

export type RelevanceCheck = { relevant: boolean; reason: string | null };

export function checkQuestionRelevance(
  question: { prompt: string },
  module: {
    title: string;
    summary?: string | null;
    lessonTitles?: (string | null | undefined)[];
  },
): RelevanceCheck {
  const vocab = new Set(
    significantWords(
      [module.title, module.summary ?? "", ...(module.lessonTitles ?? [])]
        .filter((s): s is string => !!s)
        .join(" "),
    ),
  );
  // Nothing meaningful to compare against (e.g. a one-word module title) — never
  // block on an under-described module.
  if (vocab.size === 0) return { relevant: true, reason: null };

  const words = significantWords(question.prompt);
  if (words.length === 0) return { relevant: true, reason: null };

  if (words.some((w) => vocab.has(w))) return { relevant: true, reason: null };

  return {
    relevant: false,
    reason: `This question doesn't share any wording with "${module.title}" — double-check it belongs in this module before saving.`,
  };
}
