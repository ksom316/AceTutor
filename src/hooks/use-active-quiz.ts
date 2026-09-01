import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type ActiveQuizAttempt = {
  attemptId: string;
  kind: "module" | "general";
  /** topic id (module) or course-quiz id (general) — the runner route param. */
  paramId: string;
  title: string;
  /** Course name, shown for context. */
  contextName: string | null;
  /** Server `quiz_attempts.expires_at` — the authoritative deadline. */
  expiresAt: string;
};

type Row = {
  id: string;
  topic_id: string | null;
  course_quiz_id: string | null;
  expires_at: string;
  topics: { title: string; courses: { title: string } | null } | null;
  course_quizzes: { title: string; courses: { title: string } | null } | null;
};

/**
 * The student's single in-progress, timed quiz attempt, if any. One shared
 * cached query (`["active-quiz-attempt", userId]`) — mounted once in AppShell,
 * so it costs one request per session, not one per page. Reuses `quiz_attempts`;
 * no separate tracking. The `.gt("expires_at", now)` filter is coarse — the
 * banner ticks locally and drops the attempt the moment it lapses.
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
          "id, topic_id, course_quiz_id, expires_at, topics(title, courses(title)), course_quizzes(title, courses(title))",
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
        return {
          attemptId: r.id,
          kind: "general",
          paramId: r.course_quiz_id,
          title: r.course_quizzes?.title ?? "General Course Quiz",
          contextName: r.course_quizzes?.courses?.title ?? null,
          expiresAt: r.expires_at,
        };
      }
      return null;
    },
  });

  return data ?? null;
}
