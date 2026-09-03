import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpen, Sparkles, Target, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { moduleStudyPathCta, useCourseStudyPaths } from "@/hooks/use-study-path";
import {
  computeCoursePerformance,
  improvementLabel,
  justReachedStrong,
  sufficientTrendLabel,
  type PerfAttempt,
  type PerfTopic,
} from "@/lib/quiz-performance";
import { fadeUp } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/performance/$courseId")({
  component: MyPerformancePage,
});

/**
 * Course-level "My Performance", grouped BY MODULE — what the student's quiz
 * performance means for their learning, as opposed to "View past results" (the
 * raw attempt history on the dashboard). Reuses the shared
 * `computeCoursePerformance` so it can never disagree with the course page or
 * the module Study Path gateway. Module quizzes only.
 */
function MyPerformancePage() {
  const { courseId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: course, isLoading: courseLoading } = useQuery({
    queryKey: ["perf-course", courseId],
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
    queryKey: ["perf-enrollment", user?.id, courseId],
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
    queryKey: ["perf-topics", courseId],
    queryFn: async () => {
      const { data } = await supabase
        .from("topics")
        .select("id, title, order_index")
        .eq("course_id", courseId)
        .order("order_index");
      return (data ?? []) as PerfTopic[];
    },
  });

  const { data: attempts = [] } = useQuery({
    queryKey: ["perf-attempts", user?.id, courseId, topics.length],
    enabled: !!user && topics.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("id, topic_id, score, total, finished_at, answered_count, started_at")
        .eq("user_id", user!.id)
        .in(
          "topic_id",
          topics.map((t) => t.id),
        );
      return (data ?? []) as PerfAttempt[];
    },
  });

  const perf = useMemo(() => computeCoursePerformance(topics, attempts), [topics, attempts]);

  // Deterministic module-state breakdown for the overview — straight off the
  // shared model, never a second calculation.
  const counts = useMemo(() => {
    const by = (s: string) => perf.modules.filter((m) => m.state === s).length;
    return {
      strong: by("strong"),
      weak: by("weak"),
      insufficient: by("insufficient"),
      noData: by("no-data"),
    };
  }, [perf.modules]);

  // Same current-vs-historical Study Path interpretation as Personalized
  // Learning — so the CTA a module shows here matches the course page.
  const { studyPaths } = useCourseStudyPaths(courseId, { enabled: !!enrollment, all: true });
  const pathsByAttempt = useMemo(
    () => new Map(studyPaths.filter((p) => p.attempt_id).map((p) => [p.attempt_id, p])),
    [studyPaths],
  );

  const backToCourse = course?.slug ? (
    <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
      <Link to="/courses/$slug" params={{ slug: course.slug }}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to {course.title}
      </Link>
    </Button>
  ) : null;

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
          <h1 className="font-display text-2xl">Enroll to see your performance</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            My Performance is built from your quiz attempts in {course.title}. Enroll and take a
            quiz to get started.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/courses/$slug" params={{ slug: course.slug }}>
              Go to course
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      {backToCourse}
      <motion.div variants={fadeUp} initial="hidden" animate="show">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">My Performance</p>
        <h1 className="mt-2 font-display text-4xl">{course.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Your standing in each module — the average score across the quiz attempts that covered
          enough of the quiz to be reliable, so retaking after studying updates it. Each module is
          assessed on its own.
        </p>
      </motion.div>

      {perf.state === "no-data" ? (
        <section className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl">
            Complete a quiz to unlock personalized performance insights
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {perf.unusableAttemptCount > 0
              ? "You have quiz attempts on record, but they don't have enough answered questions for AceTutor to assess what you know. Take a quiz and answer the questions."
              : "Once you take a module quiz and answer its questions, AceTutor will show your strong and weak areas here."}
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/quizzes/$courseId" params={{ courseId }}>
              Take a Quiz <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </section>
      ) : (
        <>
          <section className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Course average
              </p>
              <p className="mt-1 font-display text-4xl">
                {perf.overall !== null ? `${perf.overall}%` : "—"}
              </p>
              <Progress value={perf.overall ?? 0} className="mt-3" />
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Modules assessed
              </p>
              <p className="mt-1 font-display text-4xl">
                {counts.strong + counts.weak}
                <span className="text-xl text-muted-foreground">/{topics.length}</span>
              </p>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="text-success">{counts.strong} strong</span>
                <span>{counts.weak} need{counts.weak === 1 ? "s" : ""} strengthening</span>
                {counts.insufficient > 0 && <span>{counts.insufficient} not enough evidence</span>}
                {counts.noData > 0 && <span>{counts.noData} not assessed</span>}
              </p>
            </div>
          </section>

          {/* Deterministic "where do I stand" summary — module names straight
              from the shared model (perf.strong / perf.weak are pre-sorted). */}
          {(perf.strong.length > 0 || perf.weak.length > 0) && (
            <section className="mt-4 grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5 text-success" /> Strongest in
                </p>
                <p className="mt-1 text-sm">
                  {perf.strong.length > 0
                    ? perf.strong
                        .slice(0, 3)
                        .map((s) => s.topic.title)
                        .join(", ")
                    : "No strong modules yet."}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Target className="h-3.5 w-3.5 text-primary" /> Needs more attention
                </p>
                <p className="mt-1 text-sm">
                  {perf.weak.length > 0
                    ? perf.weak
                        .slice(0, 3)
                        .map((w) => w.topic.title)
                        .join(", ")
                    : "Nothing below par right now."}
                </p>
              </div>
            </section>
          )}

          {perf.state === "insufficient" && (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
              You&apos;ve started quizzes here, but none has enough answered questions yet for a
              reliable assessment. Answer more of a module&apos;s quiz to see where you stand.
            </div>
          )}

          {perf.state === "weak" && (
            <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <Target className="h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm text-muted-foreground">
                {perf.weak.length} module{perf.weak.length === 1 ? "" : "s"} below par. Each has its
                own Study Path.
              </p>
              <Button asChild size="sm" className="ml-auto">
                <Link to="/study-path/$courseId" params={{ courseId }}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> View Study Paths
                </Link>
              </Button>
            </div>
          )}

          <section className="mt-6 space-y-3">
            <h2 className="font-display text-lg">By module</h2>
            {perf.modules.map((m) => (
              <div key={m.topic.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden
                      className={
                        m.state === "strong"
                          ? "text-success"
                          : m.state === "weak"
                            ? "text-primary"
                            : "text-muted-foreground"
                      }
                    >
                      {m.state === "strong"
                        ? "✓"
                        : m.state === "weak"
                          ? "⚠"
                          : m.state === "insufficient"
                            ? "•"
                            : "–"}
                    </span>
                    {m.topic.title}
                  </span>
                  {m.state === "no-data" ? (
                    <span className="text-xs text-muted-foreground">Not attempted</span>
                  ) : m.state === "insufficient" ? (
                    <span className="text-xs text-muted-foreground">
                      Last quiz: {m.lastUsableScore ?? 0}% · {m.answeredCount ?? 0}/
                      {m.totalQuestions ?? 0} answered
                    </span>
                  ) : (
                    <Badge
                      variant={m.state === "strong" ? "default" : "secondary"}
                      className={
                        m.state === "strong"
                          ? "border-success/40 bg-success/10 text-success"
                          : undefined
                      }
                    >
                      Average {m.averageScore}%
                    </Badge>
                  )}
                </div>
                {(m.state === "weak" || m.state === "strong") && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Latest quiz: {m.lastUsableScore ?? 0}%
                    {m.coveragePercent !== null &&
                    m.coveragePercent < 100 &&
                    m.answeredCount !== null &&
                    m.totalQuestions !== null
                      ? ` · ${m.answeredCount}/${m.totalQuestions} answered`
                      : ""}
                    {improvementLabel(m) ? (
                      <span
                        className={
                          (m.improvementPoints ?? 0) > 0
                            ? "ml-1.5 font-medium text-success"
                            : "ml-1.5 font-medium text-muted-foreground"
                        }
                      >
                        · {improvementLabel(m)}
                      </span>
                    ) : null}
                  </p>
                )}
                {sufficientTrendLabel(m) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Recent quizzes: {sufficientTrendLabel(m)}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {m.state === "weak" &&
                    (() => {
                      const cta = moduleStudyPathCta(m.currentStudyPathAttemptId, pathsByAttempt);
                      return (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {cta.kind === "build"
                              ? "Below par on your quiz average — a Study Path can target it."
                              : cta.kind === "review"
                                ? "Below par — you have a Study Path for it (reviewed)."
                                : "Below par — you have a Study Path in progress for it."}
                          </p>
                          {cta.kind === "build" ? (
                            <Button asChild size="sm" variant="outline" className="ml-auto">
                              <Link
                                to="/study-path/$courseId"
                                params={{ courseId }}
                                search={{ module: m.topic.id }}
                              >
                                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Build Study Path
                              </Link>
                            </Button>
                          ) : (
                            <Button asChild size="sm" variant="outline" className="ml-auto">
                              <Link
                                to="/learning/$studyPathId"
                                params={{ studyPathId: cta.studyPathId }}
                              >
                                <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                                {cta.kind === "review"
                                  ? "Review Study Path"
                                  : "Continue Study Path"}
                              </Link>
                            </Button>
                          )}
                        </>
                      );
                    })()}
                  {m.state === "strong" && (
                    <p className="text-xs text-muted-foreground">
                      <TrendingUp className="mr-1 inline h-3.5 w-3.5 text-success" />
                      {justReachedStrong(m)
                        ? "Your recent quiz performance has brought this module up to a strong level."
                        : "You're doing well in this module."}
                    </p>
                  )}
                  {m.state === "insufficient" && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Not enough evidence yet — answer more of the quiz for a reliable assessment.
                      </p>
                      <Button asChild size="sm" variant="outline" className="ml-auto">
                        <Link
                          to="/quiz/$topicId"
                          params={{ topicId: m.topic.id }}
                          search={{ retake: true }}
                        >
                          Take the quiz
                        </Link>
                      </Button>
                    </>
                  )}
                  {m.state === "no-data" && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/quizzes/$courseId" params={{ courseId }}>
                        Take this module&apos;s quiz
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </section>

          {perf.state === "strong" && (
            <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-success/30 bg-success/5 p-4">
              <TrendingUp className="h-4 w-4 shrink-0 text-success" />
              <p className="text-sm text-muted-foreground">
                Every assessed module is at or above par — no remediation needed right now.
              </p>
              <Button asChild size="sm" variant="outline" className="ml-auto">
                <Link to="/quizzes/$courseId" params={{ courseId }}>
                  Take a Quiz
                </Link>
              </Button>
            </div>
          )}

          <div className="mt-4">
            <Button asChild variant="ghost" size="sm">
              <Link to="/courses/$slug" params={{ slug: course.slug }}>
                <BookOpen className="mr-1.5 h-4 w-4" /> Course material
              </Link>
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
