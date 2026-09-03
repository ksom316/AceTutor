import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Brain, CheckCircle2, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StartQuizButton } from "@/components/course/StartQuizButton";
import {
  attemptsUsageLabel,
  canAttemptCourseQuiz,
  deadlineStatus,
  formatDeadline,
} from "@/lib/course-quiz";
import { fadeUp } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/quizzes/$courseId")({
  component: TakeAQuizPage,
});

type TopicRow = { id: string; title: string; order_index: number };

/**
 * "Take a Quiz" — the course-level quiz picker. A course can hold several module
 * quizzes plus lecturer-created general assessments; this lists every published
 * one and makes clear which are new versus already attempted, instead of the old
 * Quick Action that just resumed the course. Nothing is auto-selected.
 */
function TakeAQuizPage() {
  const { courseId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: course, isLoading: courseLoading } = useQuery({
    queryKey: ["takequiz-course", courseId],
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, slug, title")
        .eq("id", courseId)
        .maybeSingle();
      return data;
    },
  });

  const { data: enrollment, isLoading: enrollLoading } = useQuery({
    queryKey: ["takequiz-enrollment", user?.id, courseId],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", user!.id)
        .eq("course_id", courseId)
        .maybeSingle();
      return data;
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: ["takequiz-topics", courseId],
    queryFn: async () => {
      const { data } = await supabase
        .from("topics")
        .select("id, title, order_index")
        .eq("course_id", courseId)
        .order("order_index");
      return (data ?? []) as TopicRow[];
    },
  });

  // Which modules actually have a published quiz, plus whether the student has
  // a finished attempt and their best score.
  const { data: moduleQuizzes = [] } = useQuery({
    queryKey: ["takequiz-modules", user?.id, courseId, topics.length],
    enabled: !!user && topics.length > 0,
    queryFn: async () => {
      const ids = topics.map((t) => t.id);
      const { data: qs } = await supabase.from("questions").select("topic_id").in("topic_id", ids);
      const withQuiz = new Set((qs ?? []).map((q) => q.topic_id).filter(Boolean) as string[]);

      const { data: att } = await supabase
        .from("quiz_attempts")
        .select("topic_id, score, total, finished_at")
        .eq("user_id", user!.id)
        .in("topic_id", ids);
      const bestByTopic = new Map<string, number>();
      for (const a of att ?? []) {
        if (!a.topic_id || !a.finished_at) continue;
        const p = a.total ? Math.round((a.score / a.total) * 100) : 0;
        if (p > (bestByTopic.get(a.topic_id) ?? -1)) bestByTopic.set(a.topic_id, p);
      }

      return topics
        .filter((t) => withQuiz.has(t.id))
        .map((t) => ({
          topic: t,
          attempted: bestByTopic.has(t.id),
          best: bestByTopic.get(t.id) ?? null,
        }));
    },
  });

  const { data: generalQuizzes = [] } = useQuery({
    queryKey: ["takequiz-general", user?.id, courseId],
    enabled: !!user,
    queryFn: async () => {
      const { data: quizzes } = await supabase.rpc("list_course_quizzes", { _course_id: courseId });
      const list = (quizzes ?? []) as {
        id: string;
        title: string;
        description: string | null;
        deadline: string | null;
        question_count: number;
        max_attempts: number | null;
      }[];
      const published = list.filter((q) => q.question_count > 0);
      if (published.length === 0) return [];
      const { data: att } = await supabase
        .from("quiz_attempts")
        .select("course_quiz_id, finished_at")
        .eq("user_id", user!.id)
        .in(
          "course_quiz_id",
          published.map((q) => q.id),
        );
      const usedById = new Map<string, number>();
      for (const a of att ?? []) {
        if (!a.course_quiz_id) continue;
        usedById.set(a.course_quiz_id, (usedById.get(a.course_quiz_id) ?? 0) + 1);
      }
      return published.map((q) => ({ ...q, used: usedById.get(q.id) ?? 0 }));
    },
  });

  if (courseLoading || enrollLoading) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-12">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-40 w-full animate-pulse rounded-2xl bg-muted" />
      </main>
    );
  }

  if (!course) {
    return (
      <main className="container mx-auto flex min-h-[50vh] max-w-2xl items-center justify-center px-4 py-12">
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <h1 className="font-display text-2xl">Course not found</h1>
          <Button onClick={() => navigate({ to: "/my-courses" })} className="mt-6 rounded-full">
            My courses
          </Button>
        </div>
      </main>
    );
  }

  if (!enrollment) {
    return (
      <main className="container mx-auto flex min-h-[50vh] max-w-2xl items-center justify-center px-4 py-12">
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <h1 className="font-display text-2xl">Enroll to take a quiz</h1>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/courses/$slug" params={{ slug: course.slug }}>
              Go to course
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  const nothing = moduleQuizzes.length === 0 && generalQuizzes.length === 0;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/courses/$slug" params={{ slug: course.slug }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to {course.title}
        </Link>
      </Button>

      <motion.div variants={fadeUp} initial="hidden" animate="show">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Take a Quiz</p>
        <h1 className="mt-2 font-display text-4xl">{course.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Choose a quiz to attempt. Retaking a quiz always creates a new attempt — your previous
          results are kept in your history.
        </p>
      </motion.div>

      {nothing && (
        <p className="mt-8 rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
          No quizzes have been published for this course yet.
        </p>
      )}

      {moduleQuizzes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Module quizzes
          </h2>
          <ul className="mt-3 space-y-3">
            {moduleQuizzes.map(({ topic, attempted, best }) => (
              <li
                key={topic.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">{topic.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {attempted ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Previously attempted
                        {best != null ? ` · best ${best}%` : ""}
                      </span>
                    ) : (
                      "Not attempted"
                    )}
                  </p>
                </div>
                <StartQuizButton
                  size="sm"
                  className="rounded-full"
                  topicId={topic.id}
                  icon={<Brain className="mr-1.5 h-4 w-4" />}
                >
                  {attempted ? "Retake Quiz" : "Take Quiz"}
                </StartQuizButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      {generalQuizzes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            General course assessments
          </h2>
          <ul className="mt-3 space-y-3">
            {generalQuizzes.map((q) => {
              const dl = deadlineStatus(q.deadline);
              const canAttempt = canAttemptCourseQuiz(q.used, q.max_attempts);
              return (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      <GraduationCap className="h-4 w-4 shrink-0 text-primary" /> {q.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {q.used > 0 ? "Previously attempted" : "Not attempted"} ·{" "}
                      {attemptsUsageLabel(q.used, q.max_attempts)}
                      {dl !== "none"
                        ? ` · ${dl === "passed" ? "deadline passed" : `due ${formatDeadline(q.deadline)}`}`
                        : ""}
                    </p>
                  </div>
                  {dl === "passed" ? (
                    <Badge variant="outline" className="text-destructive">
                      Closed
                    </Badge>
                  ) : !canAttempt ? (
                    <Badge variant="outline" className="text-destructive">
                      No attempts left
                    </Badge>
                  ) : (
                    <Button asChild size="sm" className="rounded-full">
                      <Link
                        to="/course-quiz/$quizId"
                        params={{ quizId: q.id }}
                        search={{ retake: true }}
                      >
                        <Brain className="mr-1.5 h-4 w-4" />
                        {q.used > 0 ? "Retake Quiz" : "Take Quiz"}
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
