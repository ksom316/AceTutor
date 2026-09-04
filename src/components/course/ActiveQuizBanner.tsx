import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlarmClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useActiveQuiz } from "@/hooks/use-active-quiz";
import { formatRemaining, timerTone } from "@/lib/quiz-timer";

/**
 * Persistent, unobtrusive banner shown across the student workspace while a
 * timed quiz attempt is in progress. It keeps counting down as the student
 * moves around, survives refresh (the deadline is the server's `expires_at`),
 * and "Continue quiz" returns them to the SAME attempt — the runner routes
 * resume an existing in-progress, non-expired attempt rather than starting a new
 * one. When the timer lapses the banner disappears and asks the server to
 * finalise the attempt (`finalize_expired_quiz_attempts`).
 */
export function ActiveQuizBanner() {
  const attempt = useActiveQuiz();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [now, setNow] = useState(() => Date.now());
  const finalizedRef = useRef(false);

  const attemptId = attempt?.attemptId ?? null;
  useEffect(() => {
    finalizedRef.current = false;
    if (!attemptId) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [attemptId]);

  const remaining = attempt ? Date.parse(attempt.expiresAt) - now : 0;

  useEffect(() => {
    if (!attempt || remaining > 0 || finalizedRef.current) return;
    finalizedRef.current = true;
    supabase
      .rpc("finalize_expired_quiz_attempts")
      .then(() => qc.invalidateQueries({ queryKey: ["active-quiz-attempt"] }));
  }, [attempt, remaining, qc]);

  // The runner pages have their own prominent timer — no need to double up.
  const onRunnerPage = pathname.startsWith("/quiz/") || pathname.startsWith("/course-quiz/");
  if (!attempt || remaining <= 0 || onRunnerPage) return null;

  const tone = timerTone(remaining);

  // Strong, high-contrast bar. Escalates from the brand accent to amber to
  // destructive as the clock runs down so it always pulls the eye without
  // dimming or covering the page behind it.
  const surface =
    tone === "critical"
      ? "border-destructive bg-destructive text-white"
      : tone === "warning"
        ? "border-amber-600 bg-amber-500 text-white"
        : "border-primary bg-primary text-primary-foreground";

  return (
    <div
      role="status"
      className={cn(
        // Sticky, not fixed: it reserves its own space in normal flow (so
        // page content below is never covered — no manual padding needed
        // anywhere) and pins at top-16, directly under AppShell's h-16 sticky
        // TopBar, on mobile, tablet and desktop alike. z-10 keeps it under the
        // navbar's z-20 at the seam. Hidden on the runner routes themselves
        // (onRunnerPage above) so only QuizRunner's own sticky timer shows
        // there — never both at once.
        "sticky top-16 z-10 flex flex-col gap-2 border-b px-4 py-2.5 shadow-sm sm:flex-row sm:items-center sm:gap-4",
        surface,
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20">
        <AlarmClock className={cn("h-5 w-5", tone === "critical" && "animate-pulse")} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{attempt.title}</p>
        <p className="truncate text-xs leading-tight text-white/80">
          {attempt.contextName ? `${attempt.contextName} · ` : ""}Quiz in progress
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 font-mono text-base font-bold tabular-nums">
          <AlarmClock className="h-4 w-4" />
          {formatRemaining(remaining)}
        </span>
        <Button
          asChild
          size="sm"
          variant="secondary"
          className="h-9 shrink-0 rounded-full px-4 font-semibold shadow-sm"
        >
          {attempt.kind === "module" ? (
            <Link to="/quiz/$topicId" params={{ topicId: attempt.paramId }}>
              Continue quiz
            </Link>
          ) : (
            <Link to="/course-quiz/$quizId" params={{ quizId: attempt.paramId }}>
              Continue quiz
            </Link>
          )}
        </Button>
      </div>
    </div>
  );
}
