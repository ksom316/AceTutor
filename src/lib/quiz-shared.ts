/** Shared quiz-builder constants, types and validation used by both the
 *  standalone quiz builder (/lecturer/quizzes/$topicId) and the "Create module"
 *  quiz step on the Materials page. Pure — no React, no server imports. */

export const MAX_QUESTIONS = 50;
export const PROMPT_MAX = 600;
export const CHOICE_MAX = 300;
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 6;
export const TITLE_MAX = 200;

export type QuizDraft = {
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  difficulty: number;
};
export type QuizQuestionRow = QuizDraft & { id: string; order_index: number };

export const DIFFICULTY_LABEL: Record<number, string> = {
  1: "1 — Easy",
  2: "2 — Light",
  3: "3 — Medium",
  4: "4 — Hard",
  5: "5 — Challenging",
};

export function blankDraft(): QuizDraft {
  return { prompt: "", choices: ["", "", "", ""], correctIndex: 0, explanation: "", difficulty: 3 };
}

/** Trim, drop empty options, remap correctIndex. Returns null when invalid. */
export function cleanDraft(d: QuizDraft): QuizDraft | null {
  const prompt = d.prompt.trim();
  const correctText = d.choices[d.correctIndex]?.trim() ?? "";
  const choices = d.choices.map((c) => c.trim()).filter(Boolean);
  if (!prompt || prompt.length > PROMPT_MAX) return null;
  if (choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) return null;
  if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) return null;
  const correctIndex = choices.indexOf(correctText);
  if (correctIndex < 0) return null;
  return {
    prompt,
    choices,
    explanation: d.explanation.trim(),
    correctIndex,
    difficulty: Math.min(5, Math.max(1, Math.round(d.difficulty) || 3)),
  };
}

/** Shape sent to create_module_with_quiz / replace_topic_quiz RPCs. */
export function draftToRow(d: QuizDraft, order_index: number) {
  return {
    prompt: d.prompt,
    choices: d.choices,
    correct_index: d.correctIndex,
    explanation: d.explanation || null,
    difficulty: d.difficulty,
    order_index,
  };
}
