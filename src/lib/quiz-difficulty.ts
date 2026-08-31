/**
 * Lecturer-controlled question difficulty for AI quiz generation.
 *
 * Pure module — imported by the browser (the "Question difficulty" control + the
 * "How does difficulty work?" popover) and by the server function (to steer the
 * AI prompt and to normalise the difficulty of every generated question). One
 * source of truth so the UI copy and the prompt instructions never drift.
 *
 * The database representation is unchanged: `questions.difficulty` stays a
 * single 1–5 integer (`check (difficulty between 1 and 5)`). A difficulty MODE
 * is only a generation-time choice; it is never stored on a row.
 *
 *   Easy   -> 1–2      Medium -> 3      Hard -> 4–5
 *   Mixed  -> deliberately spread across 1–5
 *   AI     -> the model picks each 1–5 from the material
 */

export type DifficultyMode = "ai" | "easy" | "medium" | "hard" | "mixed";

export const DIFFICULTY_MODES: DifficultyMode[] = ["ai", "easy", "medium", "hard", "mixed"];

export const DEFAULT_DIFFICULTY_MODE: DifficultyMode = "ai";

export const DIFFICULTY_MODE_LABEL: Record<DifficultyMode, string> = {
  ai: "Let AI decide",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  mixed: "Mixed",
};

/** Content of the "How does difficulty work?" popover. */
export const DIFFICULTY_HELP: { term: string; body: string }[] = [
  {
    term: "Easy",
    body: "Tests basic recall, definitions, recognition, and straightforward concepts directly covered in the material.",
  },
  {
    term: "Medium",
    body: "Requires understanding, interpretation, comparison, or applying concepts to familiar situations.",
  },
  {
    term: "Hard",
    body: "Requires deeper reasoning, combining concepts, analyzing scenarios, or applying knowledge in less obvious situations.",
  },
  {
    term: "Mixed",
    body: "A deliberate, balanced mixture of easy, medium, and hard questions.",
  },
  {
    term: "Let AI decide",
    body: "The AI independently picks the appropriate difficulty for each question based on the complexity and learning objectives of the material.",
  },
];

export const DIFFICULTY_HELP_NOTE =
  "Difficulty measures the cognitive challenge of the question, not how complicated the wording is. A question is not difficult simply because it uses technical vocabulary.";

/**
 * The instruction spliced into the AI system/user prompt. It only steers the
 * cognitive level and the numeric `difficulty` field — it never relaxes the
 * strict-grounding rules.
 */
export function difficultyModePromptInstruction(mode: DifficultyMode): string {
  const grounding =
    'Difficulty controls the cognitive challenge of a question only. Never invent facts, terms, numbers, or scenarios that the SOURCE MATERIAL does not state, and never make a question "harder" by adding unsupported detail or obscure wording. Every question must still be fully answerable from the material.';

  switch (mode) {
    case "easy":
      return `DIFFICULTY: Easy. Generate questions that primarily test recall, definitions, recognition, and straightforward concepts stated directly in the material. Every question's "difficulty" value must be 1 or 2. ${grounding}`;
    case "medium":
      return `DIFFICULTY: Medium. Generate questions that require understanding, interpretation, comparison, or applying concepts from the material to familiar situations. Every question's "difficulty" value must be 3. ${grounding}`;
    case "hard":
      return `DIFFICULTY: Hard. Generate questions that require deeper reasoning, combining multiple concepts, analyzing scenarios, or applying knowledge in less obvious situations that are still supported by the material. Every question's "difficulty" value must be 4 or 5. ${grounding}`;
    case "mixed":
      return `DIFFICULTY: Mixed. Deliberately distribute the questions across easy (difficulty 1-2), medium (difficulty 3), and hard (difficulty 4-5) levels as evenly as practical for the number of questions requested — do not cluster them all at one level. Set each question's "difficulty" value to match its actual cognitive demand. ${grounding}`;
    case "ai":
    default:
      return `DIFFICULTY: Let the AI decide. Determine the appropriate difficulty of each question from the complexity and learning objectives of the supplied material, and set each question's "difficulty" value (1 = easy recall, 5 = hard reasoning) accordingly. ${grounding}`;
  }
}

/**
 * Clamp / snap a model-supplied difficulty to the band the lecturer chose, so a
 * stored `questions.difficulty` value always matches the selected mode.
 *   easy -> 1..2, medium -> 3, hard -> 4..5, mixed/ai -> keep the model's 1..5
 */
export function normaliseDifficultyForMode(value: unknown, mode: DifficultyMode): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 3;
  const n = Math.min(5, Math.max(1, raw || 3));
  switch (mode) {
    case "easy":
      return Math.min(2, n);
    case "medium":
      return 3;
    case "hard":
      return Math.max(4, n);
    case "mixed":
    case "ai":
    default:
      return n;
  }
}
