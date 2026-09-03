import { supabase } from "@/integrations/supabase/client";

/**
 * Quiz Recovery helpers shared by the module quiz (`/quiz/$topicId`) and the
 * General Course Quiz (`/course-quiz/$quizId`) runners. Both use the same
 * official `quiz_attempts` / `attempt_answers` architecture, so recovery is
 * identical for the two.
 *
 * The attempt row and its absolute `quiz_attempts.expires_at` are the single
 * source of truth for the deadline — nothing here touches time. These helpers
 * only move the *answers* to and from the server as the student progresses.
 */

/** Persist one selected answer for an in-progress attempt. Idempotent server-
 *  side (UPSERT on attempt+question), so calling it repeatedly — or for the same
 *  value — is safe. Returns `false` (never throws) when the save did not land, so
 *  the caller can surface a gentle warning; the final `grade_quiz` submit
 *  re-sends every answer, so a dropped save is not lost. */
export async function saveQuizAnswer(
  attemptId: string,
  questionId: string,
  selectedIndex: number,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("save_quiz_answer", {
      _attempt_id: attemptId,
      _question_id: questionId,
      _selected_index: selectedIndex,
    });
    return !error;
  } catch {
    return false;
  }
}

/** FNV-1a 32-bit string hash — small, stable, well-distributed. */
function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministically order a question set for one attempt. The question RPCs
 * shuffle (`order by random()`), so a plain reload re-orders the list; sorting
 * by `hash(questionId + attemptId)` makes the order STABLE for a given attempt —
 * a recovered quiz shows the same questions in the same order it started with.
 * (If a topic has more questions than the quiz length, the random `LIMIT` in the
 * RPC can still return a different subset across reloads — see the report.)
 */
export function orderQuestionsForAttempt<T extends { id: string }>(
  questions: T[],
  attemptId: string,
): T[] {
  return [...questions].sort((a, b) => {
    const ha = fnv1a(`${a.id}:${attemptId}`);
    const hb = fnv1a(`${b.id}:${attemptId}`);
    return ha - hb || a.id.localeCompare(b.id);
  });
}

/** The student's previously selected answers for their own attempt, as
 *  `{ [questionId]: selectedIndex }`. Server returns selected indices only —
 *  never `is_correct` / the answer key. */
export async function loadSavedAnswers(attemptId: string): Promise<Record<string, number>> {
  const { data } = await supabase.rpc("get_attempt_answers", {
    _attempt_id: attemptId,
  });
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { question_id: string; selected_index: number }[]) {
    if (typeof row.selected_index === "number") out[row.question_id] = row.selected_index;
  }
  return out;
}
