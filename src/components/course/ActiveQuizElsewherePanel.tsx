import { Link } from "@tanstack/react-router";
import { AlarmClock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActiveQuizAttempt } from "@/lib/quiz-start";

/**
 * Shown when a student tries to start an official quiz while a DIFFERENT
 * official quiz is still in progress. It creates nothing — the block is
 * enforced by `enforce_one_active_official_quiz` on the server. "Return to
 * quiz" routes to the correct existing runner (module or General Course Quiz),
 * which resumes the same attempt and timer.
 */
export function ActiveQuizElsewherePanel({ attempt }: { attempt: ActiveQuizAttempt }) {
  return (
    <main className="container mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-12">
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlarmClock className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold">
          You already have a quiz in progress
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          You can only have one official quiz active at a time. Finish{" "}
          <span className="font-medium text-foreground">{attempt.title}</span>
          {attempt.contextName ? ` (${attempt.contextName})` : ""} — or let its timer run out —
          before starting another.
        </p>
        <Button asChild size="lg" className="mt-6 w-full rounded-full sm:w-auto sm:px-10">
          {attempt.kind === "module" ? (
            <Link to="/quiz/$topicId" params={{ topicId: attempt.paramId }}>
              Return to quiz <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          ) : (
            <Link to="/course-quiz/$quizId" params={{ quizId: attempt.paramId }}>
              Return to quiz <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          )}
        </Button>
      </div>
    </main>
  );
}
