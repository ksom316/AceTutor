import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { fadeUp } from "@/lib/motion";
import {
  formatDateTime,
  generalQuizStatus,
  generalQuizStatusLabel,
  maxAttemptsLabel,
  relativeTime,
} from "@/lib/course-quiz";

export const Route = createFileRoute("/lecturer/quizzes/")({
  component: LecturerQuizzes,
});

type TopicRow = { id: string; title: string; summary: string | null; order_index: number };
type GeneralQuizRow = {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  available_from: string | null;
  created_at: string;
  question_count: number;
  max_attempts: number | null;
};

type GeneralQuizWithStats = GeneralQuizRow & { enrolled: number; submitted: number };

function LecturerQuizzes() {
  const { lecturerCourseId } = useRole();
  const enabled = !!lecturerCourseId;

  const courseQuery = useQuery({
    queryKey: ["lecturer-course", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("title, summary")
        .eq("id", lecturerCourseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const overviewQuery = useQuery({
    queryKey: ["lecturer-quiz-overview", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data: topics, error } = await supabase
        .from("topics")
        .select("id, title, summary, order_index")
        .eq("course_id", lecturerCourseId!)
        .order("order_index");
      if (error) throw error;
      const list = (topics ?? []) as TopicRow[];

      const ids = list.map((t) => t.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: qs, error: qErr } = await supabase
          .from("questions")
          .select("id, topic_id")
          .in("topic_id", ids);
        if (qErr) throw qErr;
        for (const q of qs ?? []) {
          if (q.topic_id) counts.set(q.topic_id, (counts.get(q.topic_id) ?? 0) + 1);
        }
      }

      // General Course Quizzes — many per course, each with its own questions
      // and schedule. Read-only here (creation is an explicit action).
      const { data: gq, error: gErr } = await supabase.rpc("list_course_quizzes", {
        _course_id: lecturerCourseId!,
      });
      if (gErr) throw gErr;

      // Submission summary per general quiz — lecturer-scoped, real counts.
      const { data: stats, error: sErr } = await supabase.rpc("get_course_quiz_submission_stats");
      if (sErr) throw sErr;
      const statsById = new Map(
        (stats ?? []).map((s) => [
          s.course_quiz_id,
          { enrolled: s.enrolled, submitted: s.submitted },
        ]),
      );

      return {
        modules: list.map((t) => ({ ...t, questionCount: counts.get(t.id) ?? 0 })),
        generalQuizzes: ((gq ?? []) as GeneralQuizRow[]).map(
          (q): GeneralQuizWithStats => ({
            ...q,
            enrolled: statsById.get(q.id)?.enrolled ?? 0,
            submitted: statsById.get(q.id)?.submitted ?? 0,
          }),
        ),
      };
    },
  });

  const modules = useMemo(() => overviewQuery.data?.modules ?? [], [overviewQuery.data]);
  const generalQuizzes = useMemo(
    () => overviewQuery.data?.generalQuizzes ?? [],
    [overviewQuery.data],
  );
  const ready = modules.filter((m) => m.questionCount > 0).length;

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-4xl px-4 py-10"
    >
      <h1 className="font-display text-4xl">Quizzes</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every module in{" "}
        <span className="font-medium text-foreground">
          {courseQuery.data?.title ?? "your assigned course"}
        </span>{" "}
        needs a quiz before students can complete it. General Course Quizzes are separate
        course-wide assessments you create and schedule yourself.
      </p>

      <div className="mt-6">
        {overviewQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-4">
                <Skeleton className="h-5 w-52" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
            ))}
          </div>
        ) : overviewQuery.isError ? (
          <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
            <h2 className="font-display text-xl">Couldn&apos;t load your quizzes</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Please try again in a moment.
            </p>
            <Button
              variant="outline"
              className="mt-5 rounded-full"
              onClick={() => overviewQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {/* General Course Quizzes — separate from the module list */}
            <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">General Course Quizzes</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Course-wide assessments · {generalQuizzes.length}{" "}
                      {generalQuizzes.length === 1 ? "quiz" : "quizzes"}
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" className="shrink-0 rounded-full">
                  <Link to="/lecturer/quizzes/general/new">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Create General Quiz
                  </Link>
                </Button>
              </div>

              {generalQuizzes.length > 0 && (
                <div className="mt-3 space-y-2">
                  {generalQuizzes.map((q) => {
                    const published = q.question_count > 0;
                    const st = generalQuizStatus({
                      availableFrom: q.available_from,
                      deadline: q.deadline,
                    });
                    const badgeCls = !published
                      ? "text-destructive"
                      : st === "closed"
                        ? "text-destructive"
                        : st === "due_soon"
                          ? "text-amber-600 dark:text-amber-400"
                          : st === "available"
                            ? "text-success"
                            : "text-muted-foreground";
                    const notSubmitted = Math.max(0, q.enrolled - q.submitted);
                    const showCounts =
                      published && (st === "available" || st === "due_soon" || st === "closed");
                    return (
                      <div
                        key={q.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{q.title}</p>
                          {q.description && (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                              {q.description}
                            </p>
                          )}
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span>
                              {q.question_count} {q.question_count === 1 ? "question" : "questions"}
                            </span>
                            {q.available_from && st === "upcoming" && (
                              <span className="inline-flex items-center gap-1">
                                <CalendarClock className="h-3 w-3" />
                                Opens {formatDateTime(q.available_from)}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="h-3 w-3" />
                              {q.deadline
                                ? `${st === "closed" ? "Closed" : "Due"} ${formatDateTime(q.deadline)}`
                                : "No deadline"}
                            </span>
                            <span>{maxAttemptsLabel(q.max_attempts)}</span>
                          </p>
                          {showCounts && (
                            <p className="mt-1 text-xs font-medium text-foreground">
                              {q.submitted} of {q.enrolled}{" "}
                              {q.enrolled === 1 ? "student" : "students"} submitted
                              {st === "closed"
                                ? ` · ${notSubmitted} did not submit`
                                : ` · ${notSubmitted} remaining`}
                              {q.deadline && st !== "closed"
                                ? ` · due ${relativeTime(q.deadline)}`
                                : ""}
                            </p>
                          )}
                        </div>
                        <Badge variant="outline" className={`shrink-0 gap-1 ${badgeCls}`}>
                          {!published ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {published ? generalQuizStatusLabel(st) : "Not published"}
                        </Badge>
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="shrink-0 rounded-full"
                        >
                          <Link to="/lecturer/quizzes/general/$quizId" params={{ quizId: q.id }}>
                            Manage
                            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Module quizzes
              </p>
              {modules.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    No modules yet. Create modules on the{" "}
                    <Link to="/lecturer/materials" className="text-primary hover:underline">
                      Course Materials
                    </Link>{" "}
                    page, then build their quizzes here.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-3 mt-1 text-xs text-muted-foreground">
                    {ready} of {modules.length}{" "}
                    {modules.length === 1 ? "module has" : "modules have"} a quiz
                  </p>
                  <div className="space-y-3">
                    {modules.map((m) => {
                      const has = m.questionCount > 0;
                      return (
                        <div
                          key={m.id}
                          className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{m.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {m.questionCount} {m.questionCount === 1 ? "question" : "questions"}
                            </p>
                          </div>
                          {has ? (
                            <Badge variant="secondary" className="shrink-0 gap-1">
                              <CheckCircle2 className="h-3 w-3 text-success" /> Quiz ready
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="shrink-0 gap-1 text-destructive">
                              <AlertTriangle className="h-3 w-3" /> Quiz required
                            </Badge>
                          )}
                          <Button
                            asChild
                            size="sm"
                            variant={has ? "outline" : "default"}
                            className="shrink-0 rounded-full"
                          >
                            <Link to="/lecturer/quizzes/$topicId" params={{ topicId: m.id }}>
                              {has ? "Manage quiz" : "Create quiz"}
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </motion.main>
  );
}
