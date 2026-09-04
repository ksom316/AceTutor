import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { effectiveQuizDeadline } from "@/lib/course-quiz";

export type ActiveQuizAttempt = {
  attemptId: string;
  kind: "module" | "general";
  /** topic id (module) or course-quiz id (general) — the runner route param. */
  paramId: string;
  title: string;
  /** Course name, shown for context. */
  contextName: string | null;
  /** The EFFECTIVE deadline — `quiz_attempts.expires_at` for a module quiz, or
   *  `min(expires_at, course_quizzes.deadline)` for a General Course Quiz
   *  (via the same `effectiveQuizDeadline` helper QuizRunner /
   *  course-quiz.$quizId.tsx use), so a lecturer shortening a General Course
   *  Quiz deadline mid-attempt is reflected here identically to the runner. */
  expiresAt: string;
};

type Row = {
  id: string;
  topic_id: string | null;
  course_quiz_id: string | null;
  expires_at: string;
  topics: { title: string; courses: { title: string } | null } | null;
  course_quizzes: {
    title: string;
    deadline: string | null;
    courses: { title: string } | null;
  } | null;
};

/**
 * The student's single in-progress, timed OFFICIAL quiz attempt, if any (a
 * module quiz or a General Course Quiz — Quiz Me practice is stateless and
 * never creates a `quiz_attempts` row, so it can never appear here). One
 * shared cached query (`["active-quiz-attempt", userId]`) — mounted once in
 * AppShell, so it costs one request per session, not one per page, and the
 * SAME data (not a second countdown system) backs both the global banner and
 * every place that invalidates this key when an attempt starts/resumes/finishes.
 * The `.gt("expires_at", now)` filter is a coarse, index-friendly pre-filter on
 * the attempt's own normal timer; the General Course Quiz branch below then
 * re-derives the true effective deadline and drops the attempt if that has
 * already passed even though the raw timer hadn't. The banner still ticks
 * locally against the returned `expiresAt` and drops the attempt the moment it
 * lapses.
 */
export function useActiveQuiz(): ActiveQuizAttempt | null {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["active-quiz-attempt", user?.id],
    enabled: !!user,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ActiveQuizAttempt | null> => {
      const { data: row } = await supabase
        .from("quiz_attempts")
        .select(
          "id, topic_id, course_quiz_id, expires_at, topics(title, courses(title)), course_quizzes(title, deadline, courses(title))",
        )
        .eq("user_id", user!.id)
        .is("finished_at", null)
        .not("expires_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const r = (row ?? null) as Row | null;
      if (!r) return null;

      if (r.topic_id) {
        return {
          attemptId: r.id,
          kind: "module",
          paramId: r.topic_id,
          title: r.topics?.title ?? "Module quiz",
          contextName: r.topics?.courses?.title ?? null,
          expiresAt: r.expires_at,
        };
      }
      if (r.course_quiz_id) {
        // General Course Quiz: the deadline is an absolute bound a lecturer can
        // shorten mid-attempt. min(expires_at, deadline) — same rule, same
        // helper, as the runner route, so the two can never disagree. If that
        // effective instant has already passed, treat it as no active attempt
        // (finalize_expired_quiz_attempts will close it out server-side on the
        // next quiz-route visit or result read).
        const effective = effectiveQuizDeadline(r.expires_at, r.course_quizzes?.deadline ?? null);
        if (!effective || Date.parse(effective) <= Date.now()) return null;
        return {
          attemptId: r.id,
          kind: "general",
          paramId: r.course_quiz_id,
          title: r.course_quizzes?.title ?? "General Course Quiz",
          contextName: r.course_quizzes?.courses?.title ?? null,
          expiresAt: effective,
        };
      }
      return null;
    },
  });

  return data ?? null;
}
