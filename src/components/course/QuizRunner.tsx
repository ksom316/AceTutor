import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { deadlineMs, formatRemaining, timerTone } from "@/lib/quiz-timer";

export type RunnerQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  difficulty: number;
};

/**
 * Presentational quiz runner — shared by the module quiz (`/quiz/$topicId`) and
 * a General Course Assessment (`/course-quiz/$quizId`). Each route owns its own
 * data loading, `quiz_attempts` insert and `grade_quiz` call, and passes the
 * questions + an `onSubmit(answers, timedOut)` handler in.
 *
 * `deadlineIso` is the server's `quiz_attempts.expires_at` — an ABSOLUTE
 * instant. The countdown here is display-only + a client hint to auto-submit;
 * the server (`grade_quiz` / `finalize_expired_quiz_attempts`) is authoritative.
 *
 * Quiz Recovery: `initialAnswers` seeds the runner from the attempt's already-
 * saved answers on resume, and `onAnswer` is fired for every selection so the
 * route can persist it immediately. `unsyncedIds` marks answers whose save has
 * not landed yet (retried in the background).
 */
export function QuizRunner({
  eyebrow,
  title,
  subtitle,
  loading,
  submitting,
  attemptReady,
  questions,
  deadlineIso,
  initialAnswers,
  onAnswer,
  unsyncedIds,
  onSubmit,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  loading: boolean;
  submitting: boolean;
  attemptReady: boolean;
  questions: RunnerQuestion[];
  deadlineIso?: string | null;
  /** Answers already saved for this attempt (resume). Seeds the runner once. */
  initialAnswers?: Record<string, number>;
  /** Fired on every selection so the route can persist it mid-quiz. */
  onAnswer?: (questionId: string, selectedIndex: number) => void;
  /** Question ids whose answer has not been saved to the server yet. */
  unsyncedIds?: string[];
  onSubmit: (answers: Record<string, number>, timedOut: boolean) => void;
}) {
  const unsynced = useMemo(() => new Set(unsyncedIds ?? []), [unsyncedIds]);
  const [answers, setAnswers] = useState<Record<string, number>>(() => ({ ...initialAnswers }));
  const [confirm, setConfirm] = useState<null | "complete" | "incomplete">(null);
  const autoSubmitted = useRef(false);
  const resumeScrolled = useRef(false);

  // On resume (some answers already present), jump to the first unanswered
  // question so the student continues from where they left off. Question order
  // is server-randomised per load, but answers are keyed by id so nothing is
  // lost — only the visible position is re-derived.
  useEffect(() => {
    if (resumeScrolled.current || loading || questions.length === 0) return;
    if (Object.keys(initialAnswers ?? {}).length === 0) return;
    resumeScrolled.current = true;
    const next = questions.find((q) => answers[q.id] === undefined);
    if (next && typeof document !== "undefined") {
      document.getElementById(`q-${next.id}`)?.scrollIntoView({ block: "center" });
    }
  }, [loading, questions, initialAnswers, answers]);

  const answersRef = useRef(answers);
  answersRef.current = answers;

  const deadline = useMemo(() => deadlineMs(deadlineIso), [deadlineIso]);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while a deadline is active.
  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const remainingMs = deadline == null ? null : deadline - now;

  // Auto-submit exactly once when the timer runs out.
  useEffect(() => {
    if (remainingMs == null || remainingMs > 0) return;
    if (autoSubmitted.current || !attemptReady || submitting) return;
    autoSubmitted.current = true;
    setConfirm(null);
    onSubmit(answersRef.current, true);
  }, [remainingMs, attemptReady, submitting, onSubmit]);

  const unanswered = questions.length - Object.keys(answers).length;

  const openConfirm = () => {
    if (!attemptReady || submitting) return;
    setConfirm(unanswered > 0 ? "incomplete" : "complete");
  };

  const doSubmit = () => {
    setConfirm(null);
    onSubmit(answers, false);
  };

  const tone = remainingMs == null ? "normal" : timerTone(remainingMs);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      {/* Persistent timer — sticky, not fixed: it reserves its own space in
          normal flow (so it never overlaps the question list below it) and
          then pins at top-16, directly under the h-16 sticky navbar (AppShell's
          TopBar), on mobile, tablet, and desktop alike. z-10 keeps it under the
          navbar's z-20 at the seam. This is the ONLY timer UI in the runner —
          module quizzes and General Course Quizzes share this one component,
          so both get it from this single change. */}
      {remainingMs != null && (
        <div
          aria-live="polite"
          className={cn(
            "sticky top-16 z-10 -mx-4 mb-4 flex justify-end border-b px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85",
            tone === "normal" && "border-border bg-background/95",
            tone === "warning" && "border-amber-500/40 bg-amber-500/10",
            (tone === "critical" || tone === "up") && "border-destructive/40 bg-destructive/10",
          )}
        >
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold tabular-nums shadow-sm",
              tone === "normal" && "border-border bg-card text-foreground",
              tone === "warning" && "border-amber-500/50 bg-amber-500/10 text-amber-600",
              (tone === "critical" || tone === "up") &&
                "animate-pulse border-destructive/50 bg-destructive/10 text-destructive",
            )}
          >
            <AlarmClock className="h-4 w-4" />
            {tone === "up" ? "Time's up" : `${formatRemaining(remainingMs)} left`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-2 font-display text-4xl">{title}</h1>
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {subtitle ?? "Answer all questions, then submit for instant feedback."}
        {remainingMs != null && " You can finish early at any time."}
      </p>

      {Object.keys(initialAnswers ?? {}).length > 0 && (
        <p className="mt-3 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          Resumed — your {Object.keys(initialAnswers ?? {}).length} saved answer
          {Object.keys(initialAnswers ?? {}).length === 1 ? "" : "s"} and the remaining time were
          restored.
        </p>
      )}
      {unsynced.size > 0 && (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {unsynced.size} answer{unsynced.size === 1 ? "" : "s"}{" "}
          {unsynced.size === 1 ? "hasn't" : "haven't"} synced yet. We&apos;ll keep retrying while
          the quiz is active.
        </p>
      )}

      {loading && <p className="mt-10 text-sm text-muted-foreground">Loading questions…</p>}

      <ol className="mt-10 space-y-8">
        {questions.map((q, idx) => (
          <li key={q.id} id={`q-${q.id}`} className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Question {idx + 1}
              </p>
              {answers[q.id] !== undefined && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    unsynced.has(q.id)
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {unsynced.has(q.id) ? "Not saved — retrying" : "Saved"}
                </span>
              )}
            </div>
            <p className="mt-2 text-lg">{q.prompt}</p>
            <div className="mt-4 grid gap-2">
              {q.choices.map((c, ci) => (
                <label
                  key={ci}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                    answers[q.id] === ci
                      ? "border-accent bg-accent/10"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === ci}
                    onChange={() => {
                      setAnswers((a) => ({ ...a, [q.id]: ci }));
                      onAnswer?.(q.id, ci);
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">{c}</span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {questions.length > 0 && !loading && (
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border pt-6">
          <Button onClick={openConfirm} disabled={submitting || !attemptReady} size="lg">
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Grading…
              </>
            ) : (
              "Finish quiz"
            )}
          </Button>
          <p className="text-sm text-muted-foreground">
            {Object.keys(answers).length} of {questions.length} answered
            {unanswered > 0 ? ` · ${unanswered} unanswered` : ""}
          </p>
        </div>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !submitting && !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "incomplete" ? "Submit an incomplete quiz?" : "Submit your quiz?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "incomplete"
                ? `You have ${unanswered} unanswered ${
                    unanswered === 1 ? "question" : "questions"
                  }. Unanswered questions will receive no credit and may reduce your score. This can't be undone.`
                : "Once you submit you won't be able to change your answers."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Keep answering</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirm === "incomplete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault();
                doSubmit();
              }}
            >
              {confirm === "incomplete" ? "Submit anyway" : "Submit quiz"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
