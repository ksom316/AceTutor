import { useCallback, useEffect, useRef, useState } from "react";
import { saveQuizAnswer } from "@/lib/quiz-recovery";

/**
 * Persists each selected answer for an in-progress official quiz attempt via the
 * idempotent `save_quiz_answer` RPC, and keeps a list of answers whose last save
 * did not land so they can be retried — when the next answer saves successfully
 * (connection is healthy again), when the browser fires `online`, and on a slow
 * poll while a backlog exists. Retrying is always safe: `save_quiz_answer` is an
 * UPSERT keyed on (attempt, question).
 *
 * This never becomes the authoritative quiz state — the server row is — and it
 * never bypasses `expires_at`: once the attempt has expired the RPC rejects the
 * save and the answer simply stays "not saved" (the final graded score is then
 * computed from whatever actually persisted).
 */
export function useAnswerSync(attemptId: string | null) {
  const [unsynced, setUnsynced] = useState<Record<string, number>>({});
  const unsyncedRef = useRef(unsynced);
  unsyncedRef.current = unsynced;
  // Last value we sent per question, so an unchanged re-select is a no-op.
  const lastSentRef = useRef<Record<string, number>>({});
  const retryingRef = useRef(false);

  /** Pre-load the values already persisted for a resumed attempt. */
  const seedSaved = useCallback((answers: Record<string, number>) => {
    lastSentRef.current = { ...answers };
  }, []);

  const persist = useCallback(
    async (questionId: string, selectedIndex: number): Promise<boolean> => {
      if (!attemptId) return false;
      lastSentRef.current[questionId] = selectedIndex;
      const ok = await saveQuizAnswer(attemptId, questionId, selectedIndex);
      setUnsynced((u) => {
        const next = { ...u };
        if (ok) delete next[questionId];
        else next[questionId] = selectedIndex;
        return next;
      });
      return ok;
    },
    [attemptId],
  );

  const retryUnsynced = useCallback(async () => {
    if (!attemptId || retryingRef.current) return;
    const pending = Object.entries(unsyncedRef.current);
    if (pending.length === 0) return;
    retryingRef.current = true;
    try {
      for (const [questionId, selectedIndex] of pending) {
        await persist(questionId, selectedIndex);
      }
    } finally {
      retryingRef.current = false;
    }
  }, [attemptId, persist]);

  /** Called by the runner on every selection. */
  const onAnswer = useCallback(
    (questionId: string, selectedIndex: number) => {
      if (
        lastSentRef.current[questionId] === selectedIndex &&
        unsyncedRef.current[questionId] === undefined
      ) {
        return;
      }
      void persist(questionId, selectedIndex).then((ok) => {
        if (ok) void retryUnsynced();
      });
    },
    [persist, retryUnsynced],
  );

  // Retry when connectivity returns.
  useEffect(() => {
    const handler = () => void retryUnsynced();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [retryUnsynced]);

  // Slow poll while there is a backlog (covers a flaky connection that never
  // fires a clean `online` event).
  useEffect(() => {
    if (Object.keys(unsynced).length === 0) return;
    const id = window.setInterval(() => void retryUnsynced(), 15_000);
    return () => window.clearInterval(id);
  }, [unsynced, retryUnsynced]);

  const unsyncedIds = Object.keys(unsynced);
  return { onAnswer, seedSaved, retryUnsynced, unsyncedIds, hasUnsynced: unsyncedIds.length > 0 };
}
