/**
 * Phase A5 — resolves an AI-generated "Quiz Me" PRACTICE quiz's difficulty
 * from the student's OFFICIAL module-quiz performance. Pure — no React, no
 * Supabase, no AI.
 *
 * Reuses `computeModuleMastery` (src/lib/mastery.ts) rather than duplicating
 * its filter/sort/percentage logic: that function already computes exactly
 * "the % of the student's most recent completed official module-quiz
 * attempt, never averaged," already excludes General Course Quiz attempts
 * (which use `course_quiz_id`, never `topic_id`), already excludes unfinished
 * attempts, and already handles total<=0/null safely (via
 * `isSufficientAttempt`/`isUsableAttempt` in quiz-performance.ts). This file
 * only adds the three difficulty bands on top of that score.
 */

import { computeModuleMastery } from "@/lib/mastery";
import type { PerfAttempt } from "@/lib/quiz-performance";

export type PracticeDifficulty = "easy" | "medium" | "hard";

/** Lets the UI distinguish "no official attempt yet, starting at Medium" from
 *  "computed from a real completed-attempt score" without exposing the raw
 *  percentage. */
export type DifficultyBasis = "no_official_attempt" | "official_attempt";

export type PracticeDifficultyResolution = {
  difficulty: PracticeDifficulty;
  basis: DifficultyBasis;
};

/**
 * no completed official attempt -> medium
 * latest official score < 50%   -> easy
 * 50% <= score < 80%            -> medium
 * score >= 80%                  -> hard
 */
export function resolvePracticeQuizDifficulty(
  topicId: string,
  attempts: PerfAttempt[],
): PracticeDifficultyResolution {
  const { score } = computeModuleMastery({ id: topicId, title: "" }, attempts);
  if (score === null) return { difficulty: "medium", basis: "no_official_attempt" };
  if (score < 50) return { difficulty: "easy", basis: "official_attempt" };
  if (score < 80) return { difficulty: "medium", basis: "official_attempt" };
  return { difficulty: "hard", basis: "official_attempt" };
}
