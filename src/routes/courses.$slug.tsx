import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  ClipboardList,
  FileText,
  GraduationCap,
  History,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { PageShell } from "@/components/site/PageShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { askCourse } from "@/lib/course-chat.functions";
import {
  attemptsUsageLabel,
  canAttemptCourseQuiz,
  deadlineStatus,
  formatDeadline,
} from "@/lib/course-quiz";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { toast } from "sonner";
import { StartQuizButton } from "@/components/course/StartQuizButton";

export const Route = createFileRoute("/courses/$slug")({
  component: CourseDetail,
});

type TopicRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  order_index: number;
};
type AttemptRow = {
  id: string;
  topic_id: string;
  score: number;
  total: number;
  finished_at: string | null;
};

function CourseDetail() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const ask = useServerFn(askCourse);
  const [input, setInput] = useState("");
  const [activeModule, setActiveModule] = useState<TopicRow | null>(null);

  const { data: course, isLoading } = useQuery({
    queryKey: ["course", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, slug, title, summary")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data;
    },
  });

  // Time spent on this page counts towards this course.
  useStudyCourse(course?.id);

  const { data: topics = [] } = useQuery({
    queryKey: ["course-topics", course?.id],
    enabled: !!course?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("topics")
        .select("id, slug, title, summary, order_index")
        .eq("course_id", course!.id)
        .order("order_index");
      return (data ?? []) as TopicRow[];
    },
  });

  const { data: enrollment } = useQuery({
    queryKey: ["enrollment", user?.id, course?.id],
    enabled: !!user && !!course?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", user!.id)
        .eq("course_id", course!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: attempts = [] } = useQuery({
    queryKey: ["course-attempts", user?.id, course?.id, topics.length],
    enabled: !!user && topics.length > 0,
    queryFn: async () => {
      const ids = topics.map((t) => t.id);
      const { data } = await supabase
        .from("quiz_attempts")
        .select("id, topic_id, score, total, finished_at")
        .eq("user_id", user!.id)
        .in("topic_id", ids);
      return (data ?? []) as AttemptRow[];
    },
  });

  // General Course Assessments — lecturer-created, course-wide, separate from
  // modules. There can be several, each with its own questions and deadline.
  const { data: generalQuizzes = [] } = useQuery({
    queryKey: ["course-general-quizzes", user?.id, course?.id],
    enabled: !!user && !!course?.id,
    queryFn: async () => {
      const { data: quizzes } = await supabase.rpc("list_course_quizzes", {
        _course_id: course!.id,
      });
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

      // Every attempt (finished or abandoned) counts towards the cap — mirrors
      // the server-side enforce_course_quiz_attempt() trigger.
      const { data: att } = await supabase
        .from("quiz_attempts")
        .select("course_quiz_id, score, total, finished_at")
        .eq("user_id", user!.id)
        .in(
          "course_quiz_id",
          published.map((q) => q.id),
        );
      const bestById = new Map<string, number>();
      const usedById = new Map<string, number>();
      for (const a of att ?? []) {
        if (!a.course_quiz_id) continue;
        usedById.set(a.course_quiz_id, (usedById.get(a.course_quiz_id) ?? 0) + 1);
        if (a.finished_at) {
          const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
          if (pct > (bestById.get(a.course_quiz_id) ?? -1)) bestById.set(a.course_quiz_id, pct);
        }
      }
      return published.map((q) => ({
        ...q,
        best: bestById.get(q.id) ?? null,
        used: usedById.get(q.id) ?? 0,
      }));
    },
  });

  const analytics = useMemo(() => {
    const finished = attempts.filter((a) => a.finished_at);
    const byTopic = new Map<string, { score: number; total: number; count: number }>();
    for (const a of finished) {
      const cur = byTopic.get(a.topic_id) ?? { score: 0, total: 0, count: 0 };
      cur.score += a.score;
      cur.total += a.total;
      cur.count += 1;
      byTopic.set(a.topic_id, cur);
    }
    const perTopic = topics.map((t) => {
      const m = byTopic.get(t.id);
      const pct = m && m.total > 0 ? Math.round((m.score / m.total) * 100) : null;
      return { topic: t, accuracy: pct, attempts: m?.count ?? 0 };
    });
    const scored = perTopic.filter((p) => p.accuracy !== null) as {
      topic: TopicRow;
      accuracy: number;
      attempts: number;
    }[];
    const totalScore = finished.reduce((s, a) => s + a.score, 0);
    const totalQ = finished.reduce((s, a) => s + a.total, 0);
    const overall = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;
    const completed = perTopic.filter((p) => p.attempts > 0).length;
    const progress = topics.length > 0 ? Math.round((completed / topics.length) * 100) : 0;
    const weak = [...scored]
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3)
      .filter((p) => p.accuracy < 70);
    const strong = [...scored]
      .sort((a, b) => b.accuracy - a.accuracy)
      .slice(0, 3)
      .filter((p) => p.accuracy >= 70);
    const nextTopic = topics.find((t) => !byTopic.has(t.id)) ?? topics[0];
    return { perTopic, overall, progress, completed, weak, strong, nextTopic };
  }, [attempts, topics]);

  const performanceSummary = useMemo(() => {
    if (analytics.perTopic.length === 0) return "";

    const lines = [
      `Overall accuracy: ${analytics.overall}%`,
      `Modules completed: ${analytics.completed}/${topics.length}`,
      "",
      "Available course modules and student performance:",
      ...analytics.perTopic.map((p) => {
        if (p.accuracy === null) {
          return `- ${p.topic.title}: Not attempted`;
        }

        return `- ${p.topic.title}: ${p.accuracy}% (${p.attempts} attempt${p.attempts === 1 ? "" : "s"})`;
      }),
    ];

    return lines.join("\n");
  }, [analytics, topics.length]);

  const enroll = useMutation({
    mutationFn: async () => {
      if (!user || !course) throw new Error("Sign in to enroll");
      const { error } = await supabase
        .from("enrollments")
        .insert({ user_id: user.id, course_id: course.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Enrolled in ${course?.title}`);
      qc.invalidateQueries({ queryKey: ["enrollment", user?.id, course?.id] });
      qc.invalidateQueries({ queryKey: ["enrolled-courses", user?.id] });
      // Refresh the dashboard / home / my-courses surfaces too.
      qc.invalidateQueries({ queryKey: ["dash-enrollments", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tutor = useMutation({
    mutationFn: async (vars: {
      mode: "general" | "ask" | "explain" | "quiz" | "summarize" | "test";
      question?: string;
      moduleTitle?: string;
      moduleSummary?: string;
    }) => {
      if (!user) throw new Error("Please sign in to use the AI tutor.");
      if (!course) throw new Error("Course not loaded");

      // Check if session is still valid before making the request
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        throw new Error("Your session has expired. Please refresh the page and sign in again.");
      }

      return ask({
        data: {
          courseId: course.id,
          courseTitle: course.title,
          courseSummary: course.summary ?? undefined,
          mode: vars.mode,
          question: vars.question,
          moduleTitle: vars.moduleTitle,
          moduleSummary: vars.moduleSummary,
          performanceSummary,
        },
      });
    },
    onError: (error: Error) => {
      if (
        error.message.includes("Session expired") ||
        error.message.includes("session has expired")
      ) {
        toast.error("Your session has expired", {
          description: "Please refresh the page and sign in again to continue.",
          action: {
            label: "Refresh",
            onClick: () => window.location.reload(),
          },
        });
      } else {
        toast.error(error.message);
      }
    },
  });

  const recommendations = useQuery({
    queryKey: ["course-recs", course?.id, performanceSummary],
    enabled: !!course && !!user && attempts.length > 0 && !!performanceSummary.trim(),
    queryFn: async () => {
      const res = await ask({
        data: {
          courseId: course!.id,
          courseTitle: course!.title,
          courseSummary: course!.summary ?? undefined,
          mode: "recommend",
          performanceSummary,
        },
      });

      return res.related === false ? "" : res.answer;
    },
    staleTime: 1000 * 60 * 10,
  });

  const submit = () => {
    const q = input.trim();
    if (!q || tutor.isPending) return;
    tutor.mutate({
      mode: "ask",
      question: q,
      moduleTitle: activeModule?.title,
      moduleSummary: activeModule?.summary ?? undefined,
    });
  };

  if (isLoading || !course) {
    return (
      <PageShell>
        <main className="container mx-auto max-w-6xl px-4 py-12 text-sm text-muted-foreground">
          Loading…
        </main>
      </PageShell>
    );
  }

  const isEnrolled = !!enrollment;

  return (
    <PageShell>
      <main className="container mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          <Link to="/courses" className="hover:underline">
            Courses
          </Link>
        </p>

        {/* HEADER */}
        <section className="mt-3 rounded-2xl border border-border bg-card p-6 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-3xl md:text-5xl">{course.title}</h1>
                {user &&
                  (isEnrolled ? (
                    <Badge className="ml-1">
                      <Check className="mr-1 h-3 w-3" /> Enrolled
                    </Badge>
                  ) : (
                    <Badge variant="outline">Not enrolled</Badge>
                  ))}
              </div>
              {course.summary && (
                <p className="mt-3 max-w-2xl text-muted-foreground">{course.summary}</p>
              )}

              {user && isEnrolled && topics.length > 0 && (
                <div className="mt-6 max-w-md">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Course progress</span>
                    <span>
                      {analytics.completed}/{topics.length} modules · {analytics.progress}%
                    </span>
                  </div>
                  <Progress value={analytics.progress} />
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col gap-2">
              {!user && (
                <Link to="/login">
                  <Button size="lg" className="h-12 rounded-full px-6 text-base">
                    <Plus className="mr-2 h-5 w-5" /> Sign in to enroll
                  </Button>
                </Link>
              )}
              {user && !isEnrolled && (
                <Button
                  size="lg"
                  onClick={() => enroll.mutate()}
                  disabled={enroll.isPending}
                  className="h-12 rounded-full px-6 text-base"
                >
                  {enroll.isPending ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-5 w-5" />
                  )}
                  Enroll in this course
                </Button>
              )}
              {user && isEnrolled && analytics.nextTopic && (
                <Link to="/topic/$topicId" params={{ topicId: analytics.nextTopic.id }}>
                  <Button size="lg" className="h-12 rounded-full px-6 text-base">
                    <Play className="mr-2 h-5 w-5" /> Continue learning
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* GENERAL COURSE ASSESSMENTS — lecturer-created, course-wide, not modules */}
        {user && isEnrolled && generalQuizzes.length > 0 && (
          <section className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <GraduationCap className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-lg">General Course Assessments</p>
                <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                  These assessments were created by your lecturer and cover material from across the
                  course. They are separate from the individual module quizzes.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {generalQuizzes.map((q) => {
                const dl = deadlineStatus(q.deadline);
                const attemptsLeft = canAttemptCourseQuiz(q.used, q.max_attempts);
                return (
                  <div
                    key={q.id}
                    className="flex flex-col rounded-xl border border-border bg-card p-4"
                  >
                    <p className="font-medium">{q.title}</p>
                    <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-primary">
                      Created by your lecturer
                    </p>
                    {q.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{q.description}</p>
                    )}
                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <p>
                        {q.question_count} {q.question_count === 1 ? "question" : "questions"}
                      </p>
                      <p className={dl === "passed" ? "text-destructive" : undefined}>
                        {dl === "none"
                          ? "Deadline: No deadline"
                          : dl === "passed"
                            ? "Deadline passed"
                            : `Deadline: ${formatDeadline(q.deadline)}`}
                      </p>
                      <p className={!attemptsLeft ? "text-destructive" : undefined}>
                        Attempts: {attemptsUsageLabel(q.used, q.max_attempts)}
                      </p>
                      {q.best != null && <p>Best score: {q.best}%</p>}
                    </div>
                    <div className="mt-3">
                      {dl === "passed" ? (
                        <Badge variant="outline" className="text-destructive">
                          Closed
                        </Badge>
                      ) : !attemptsLeft ? (
                        <Badge variant="outline" className="text-destructive">
                          Attempt limit reached
                        </Badge>
                      ) : (
                        <Button asChild size="sm" className="rounded-full">
                          <Link to="/course-quiz/$quizId" params={{ quizId: q.id }}>
                            <Brain className="mr-1.5 h-4 w-4" />
                            {q.used > 0 ? "Retry Quiz" : "Start Quiz"}
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
          <div className="space-y-8">
            {/* AI TUTOR */}
            <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Sparkles className="h-5 w-5 text-primary" /> AI Course Tutor
                    {activeModule && (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        Focused on: {activeModule.title}
                        <button
                          onClick={() => setActiveModule(null)}
                          className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          ✕
                        </button>
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!isEnrolled) {
                        toast.error("Enroll to use AI tutor", {
                          description: "You need to be enrolled in this course to ask questions.",
                          action: user ? {
                            label: "Enroll",
                            onClick: () => enroll.mutate(),
                          } : undefined,
                        });
                        return;
                      }
                      submit();
                    }}
                  >
                    <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-3 shadow-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submit();
                          }
                        }}
                        rows={1}
                        placeholder="Ask anything about this course (e.g. explain Week 3, generate quiz, summarize notes...)"
                        className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!input.trim() || tutor.isPending}
                        className="h-9 w-9 shrink-0 rounded-full"
                        aria-label="Send"
                      >
                        {tutor.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUp className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </form>

                  {(tutor.isPending || tutor.data || tutor.isError) && (
                    <div className="mt-3 rounded-xl border border-border bg-background/50 p-5">
                      {tutor.isPending && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                        </div>
                      )}
                      {tutor.isError && (
                        <p className="text-sm text-destructive">
                          Couldn't get a response: {(tutor.error as Error).message}
                        </p>
                      )}
                      {tutor.data?.related === false && (
                        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                          <div>
                            <p className="font-medium text-foreground">
                              That doesn't look related to {course.title}.
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {tutor.data.reason ||
                                `Try asking something specific to ${course.title}.`}
                            </p>
                          </div>
                        </div>
                      )}
                      {tutor.data?.related !== false && tutor.data?.answer && (
                        <div className="prose-lesson max-w-none text-foreground">
                          <ReactMarkdown>{tutor.data.answer}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {[
                      { mode: "explain" as const, label: "📘 Explain Topic" },
                      { mode: "summarize" as const, label: "📄 Summarize Lecture" },
                      { mode: "test" as const, label: "🎯 Test My Knowledge" },
                    ].map(({ mode, label }) => (
                      <Button
                        key={mode}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        disabled={tutor.isPending}
                        onClick={() => {
                          if (!isEnrolled) {
                            toast.error("Enroll to use AI tutor", {
                              description: "You need to be enrolled in this course to use AI features.",
                              action: user ? {
                                label: "Enroll",
                                onClick: () => enroll.mutate(),
                              } : undefined,
                            });
                            return;
                          }
                          tutor.mutate({
                            mode: "explain" as const,
                            moduleTitle: activeModule?.title,
                            moduleSummary: activeModule?.summary ?? undefined,
                          });
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      disabled={tutor.isPending}
                      onClick={() => {
                        if (!isEnrolled) {
                          toast.error("Enroll to use AI tutor", {
                            description: "You need to be enrolled in this course to use AI features.",
                            action: user ? {
                              label: "Enroll",
                              onClick: () => enroll.mutate(),
                            } : undefined,
                          });
                          return;
                        }
                        tutor.mutate({ mode: "general" });
                      }}
                    >
                      General overview
                    </Button>
                  </div>
                </CardContent>
              </Card>

            {/* MODULES */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Course modules</CardTitle>
              </CardHeader>
              <CardContent>
                {topics.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No modules published yet.</p>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {topics.map((t, idx) => {
                      const stat = analytics.perTopic.find((p) => p.topic.id === t.id);
                      return (
                        <AccordionItem key={t.id} value={t.id}>
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-1 items-center justify-between gap-4 pr-4">
                              <div className="text-left">
                                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                                  Module {idx + 1}
                                </p>
                                <p className="font-medium">{t.title}</p>
                              </div>
                              {stat?.accuracy !== null && stat?.accuracy !== undefined && (
                                <Badge variant={stat.accuracy >= 70 ? "default" : "secondary"}>
                                  {stat.accuracy}%
                                </Badge>
                              )}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            {t.summary && (
                              <p className="text-sm text-muted-foreground">{t.summary}</p>
                            )}
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                onClick={() => {
                                  if (!isEnrolled) {
                                    toast.error("Enroll to view module", {
                                      description: "You need to be enrolled to view this module.",
                                      action: user ? {
                                        label: "Enroll",
                                        onClick: () => enroll.mutate(),
                                      } : undefined,
                                    });
                                    return;
                                  }
                                  window.location.href = `/topic/${t.id}`;
                                }}
                              >
                                <BookOpen className="mr-1.5 h-4 w-4" /> Open module
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                onClick={() => {
                                  if (!isEnrolled) {
                                    toast.error("Enroll to ask AI tutor", {
                                      description: "You need to be enrolled to use AI features.",
                                      action: user ? {
                                        label: "Enroll",
                                        onClick: () => enroll.mutate(),
                                      } : undefined,
                                    });
                                    return;
                                  }
                                  setActiveModule(t);
                                  document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                              >
                                <Sparkles className="mr-1.5 h-4 w-4" /> Ask AI about this module
                              </Button>
                              <StartQuizButton
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                topicId={t.id}
                                icon={<Brain className="mr-1.5 h-4 w-4" />}
                              >
                                Take quiz
                              </StartQuizButton>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                )}
              </CardContent>
            </Card>

            {/* ANALYTICS */}
            {user && isEnrolled && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your performance</CardTitle>
                </CardHeader>
                <CardContent>
                  {attempts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Take a quiz to start seeing your strong and weak areas.
                    </p>
                  ) : (
                    <div className="grid gap-6 md:grid-cols-3">
                      <div className="rounded-xl border border-border p-4">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">
                          Overall accuracy
                        </p>
                        <p className="mt-1 font-display text-3xl">{analytics.overall}%</p>
                        <Progress value={analytics.overall} className="mt-3" />
                      </div>
                      <div className="rounded-xl border border-border p-4">
                        <p className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
                          <TrendingDown className="h-3.5 w-3.5" /> Weak topics
                        </p>
                        {analytics.weak.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Nothing weak yet — nice.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5 text-sm">
                            {analytics.weak.map((w) => (
                              <li key={w.topic.id} className="flex items-center justify-between">
                                <span className="truncate">{w.topic.title}</span>
                                <Badge variant="secondary">{w.accuracy}%</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="rounded-xl border border-border p-4">
                        <p className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
                          <TrendingUp className="h-3.5 w-3.5" /> Strong topics
                        </p>
                        {analytics.strong.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Keep practicing to build strengths.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5 text-sm">
                            {analytics.strong.map((w) => (
                              <li key={w.topic.id} className="flex items-center justify-between">
                                <span className="truncate">{w.topic.title}</span>
                                <Badge>{w.accuracy}%</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* RECOMMENDATIONS */}
            {user && isEnrolled && attempts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Sparkles className="h-5 w-5 text-primary" /> Recommended next steps
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {recommendations.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Personalizing your plan…
                    </div>
                  ) : recommendations.data ? (
                    <div className="prose-lesson max-w-none text-foreground">
                      <ReactMarkdown>{recommendations.data}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recommendations yet.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* QUICK ACTIONS SIDEBAR */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {analytics.nextTopic && (
                  <Button
                    variant="outline"
                    className="w-full justify-start rounded-lg"
                    onClick={() => {
                      if (!isEnrolled) {
                        toast.error("Enroll to continue learning", {
                          description: "You need to be enrolled to access modules.",
                          action: user ? {
                            label: "Enroll",
                            onClick: () => enroll.mutate(),
                          } : undefined,
                        });
                        return;
                      }
                      window.location.href = `/topic/${analytics.nextTopic.id}`;
                    }}
                  >
                    <Play className="mr-2 h-4 w-4" /> Continue learning
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full justify-start rounded-lg"
                  onClick={() => {
                    if (!isEnrolled) {
                      toast.error("Enroll to ask AI tutor", {
                        description: "You need to be enrolled to use AI features.",
                        action: user ? {
                          label: "Enroll",
                          onClick: () => enroll.mutate(),
                        } : undefined,
                      });
                      return;
                    }
                    document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" /> Ask AI Tutor
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start rounded-lg"
                  onClick={() => {
                    if (!isEnrolled) {
                      toast.error("Enroll to view results", {
                        description: "You need to be enrolled to view your progress.",
                        action: user ? {
                          label: "Enroll",
                          onClick: () => enroll.mutate(),
                        } : undefined,
                      });
                      return;
                    }
                    window.location.href = "/dashboard";
                  }}
                >
                  <History className="mr-2 h-4 w-4" /> View past results
                </Button>
              </CardContent>
            </Card>

            {user && isEnrolled && topics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Module checklist</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {analytics.perTopic.map((p) => (
                      <li key={p.topic.id} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 truncate">
                          {p.attempts > 0 ? (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <span className="h-3.5 w-3.5 rounded-full border border-border" />
                          )}
                          <span className="truncate">{p.topic.title}</span>
                        </span>
                        {p.accuracy !== null && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {p.accuracy}%
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </main>
    </PageShell>
  );
}
