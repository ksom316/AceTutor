import { useEffect, useMemo, useState } from "react";
import { AlarmClock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deadlineMs, formatRemaining } from "@/lib/quiz-timer";

/**
 * Shown when a student opens an official quiz that already has an unfinished,
 * still-valid attempt (refresh, tab close, network drop, or a return later /
 * from another device). It does NOT create anything — the attempt and its
 * `expires_at` already exist server-side. "Resume Quiz" just reveals the runner,
 * which restores the saved answers and counts down the *remaining* time against
 * the same absolute deadline.
 */
export function QuizRecoveryGate({
  eyebrow,
  title,
  deadlineIso,
  answeredCount,
  totalQuestions,
  onResume,
}: {
  eyebrow: string;
  title: string;
  deadlineIso: string | null;
  answeredCount: number;
  totalQuestions: number;
  onResume: () => void;
}) {
  const deadline = useMemo(() => deadlineMs(deadlineIso), [deadlineIso]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const remainingMs = deadline == null ? null : deadline - now;

  return (
    <main className="container mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-12">
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
          <RotateCcw className="h-6 w-6" />
        </div>
        <p className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-1 font-display text-2xl font-bold">Unfinished Quiz</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          You have an unfinished attempt for{" "}
          <span className="font-medium text-foreground">{title}</span>. Your answers so far are
          saved and the timer has kept running — pick up exactly where you left off.
        </p>

        <div className="mx-auto mt-5 flex max-w-xs flex-col gap-2 text-sm">
          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
            <span className="text-muted-foreground">Answered so far</span>
            <span className="font-medium tabular-nums">
              {answeredCount} / {totalQuestions}
            </span>
          </div>
          {remainingMs != null && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <AlarmClock className="h-4 w-4" /> Time remaining
              </span>
              <span
                className={`font-semibold tabular-nums ${
                  remainingMs <= 60_000 ? "text-destructive" : "text-foreground"
                }`}
              >
                {remainingMs > 0 ? formatRemaining(remainingMs) : "Time's up"}
              </span>
            </div>
          )}
        </div>

        <Button
          onClick={onResume}
          size="lg"
          className="mt-6 w-full rounded-full sm:w-auto sm:px-10"
        >
          Resume Quiz
        </Button>
      </div>
    </main>
  );
}
