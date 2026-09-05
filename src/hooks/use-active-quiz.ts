import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { loadActiveOfficialAttempt, type ActiveQuizAttempt } from "@/lib/quiz-start";

export type { ActiveQuizAttempt };

/**
 * The student's single in-progress, timed OFFICIAL quiz attempt, if any (a
 * module quiz or a General Course Quiz — Quiz Me practice is stateless and
 * never creates a `quiz_attempts` row, so it can never appear here). One
 * shared cached query (`["active-quiz-attempt", userId]`) — mounted once in
 * AppShell, so it costs one request per session, not one per page, and the
 * SAME data (not a second countdown system) backs both the global banner and
 * every place that invalidates this key when an attempt starts/resumes/finishes.
 *
 * The query itself lives in `src/lib/quiz-start.ts` (`loadActiveOfficialAttempt`)
 * so the runner routes and StartQuizButton can call the exact same check
 * without going through a hook.
 */
export function useActiveQuiz(): ActiveQuizAttempt | null {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["active-quiz-attempt", user?.id],
    enabled: !!user,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () => loadActiveOfficialAttempt(user!.id),
  });

  return data ?? null;
}
