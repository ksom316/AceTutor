import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import {
  BookOpen,
  Brain,
  Check,
  ClipboardList,
  FileText,
  GraduationCap,
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
import { COURSE_CTA_LABEL, courseCtaState } from "@/lib/course-progress";
import { askCourse } from "@/lib/course-chat.functions";
import {
  buildPerformanceSummary,
  computeCoursePerformance,
  type PerfAttempt,
} from "@/lib/quiz-performance";
import { computeCourseMastery } from "@/lib/mastery";
import { MasteryBadge, MasteryTrend } from "@/components/course/MasteryBadge";
import {
  attemptsUsageLabel,
  canAttemptCourseQuiz,
  deadlineStatus,
  formatDeadline,
} from "@/lib/course-quiz";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useStudyCourse } from "@/hooks/use-study-time";
import { toast } from "sonner";
import { StartQuizButton } from "@/components/course/StartQuizButton";
import { PersonalizedLearningSection } from "@/components/course/PersonalizedLearningSection";
import { CourseTutorChat } from "@/components/course/CourseTutorChat";

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
  answered_count: number | null;
  started_at: string | null;
};

function CourseDetail() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isLecturer } = useRole();
  const qc = useQueryClient();
  const ask = useServerFn(askCourse);
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
        .select("id, topic_id, score, total, finished_at, answered_count, started_at")
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

  // Shared performance model — per-module, evidence-gated. See
  // src/lib/quiz-performance.ts.
  const perf = useMemo(
    () => computeCoursePerformance(topics, attempts as PerfAttempt[]),
    [topics, attempts],
  );

  // Course Mastery — latest-attempt based, kept separate from completion.
  const mastery = useMemo(
    () => computeCourseMastery(topics, attempts as PerfAttempt[]),
    [topics, attempts],
  );

  // Module completion / "next module" / course-progress %: unchanged behaviour —
  // a topic counts as attempted once it has any finished attempt (blank
  // included). Drives the header CTA + progress bar only, never the performance
  // view.
  const analytics = useMemo(() => {
    const finishedTopicIds = new Set(attempts.filter((a) => a.finished_at).map((a) => a.topic_id));
    const completed = topics.filter((t) => finishedTopicIds.has(t.id)).length;
    const progress = topics.length > 0 ? Math.round((completed / topics.length) * 100) : 0;
    const nextTopic = topics.find((t) => !finishedTopicIds.has(t.id)) ?? topics[0];
    return { completed, progress, nextTopic };
  }, [attempts, topics]);

  // Fed to the AI tutor's "recommend" mode. "" (no recommendations) when the
  // student has no reliable quiz data yet.
  const performanceSummary = useMemo(
    () => buildPerformanceSummary(perf, topics.length),
    [perf, topics.length],
  );

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
                <div className="mt-6 max-w-md space-y-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Course progress</span>
                      <span>
                        {analytics.completed}/{topics.length} modules · {analytics.progress}%
                      </span>
                    </div>
                    <Progress value={analytics.progress} />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      How much of the course you&apos;ve completed.
                    </p>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Course mastery</span>
                      <span>
                        {mastery.score !== null
                          ? `${mastery.assessedModules} of ${topics.length} modules assessed`
                          : "Not assessed"}
                      </span>
                    </div>
                    {mastery.score !== null ? (
                      <>
                        <Progress value={mastery.score} />
                        <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <MasteryBadge level={mastery.level} score={mastery.score} />
                          <span>How well you understand the assessed material.</span>
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Complete a module quiz to see how well you understand the material.
                      </p>
                    )}
                  </div>
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
                    <Play className="mr-2 h-5 w-5" />{" "}
                    {COURSE_CTA_LABEL[courseCtaState(analytics.progress)]}
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
                          <Link
                            to="/course-quiz/$quizId"
                            params={{ quizId: q.id }}
                            search={{ retake: true }}
                          >
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
            {/* AI TUTOR — persistent, course-grounded conversation + Guide Me */}
            <CourseTutorChat
              key={course.id}
              courseId={course.id}
              courseTitle={course.title}
              courseSummary={course.summary ?? undefined}
              activeModule={activeModule}
              onClearModule={() => setActiveModule(null)}
              enrolled={!!isEnrolled}
            />

            {/* PERFORMANCE — existing course performance / analytics. Sits above
                the curriculum and guidance sections. */}
            {user && isEnrolled && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your performance</CardTitle>
                </CardHeader>
                <CardContent>
                  {perf.state === "no-data" ? (
                    <p className="text-sm text-muted-foreground">
                      {perf.unusableAttemptCount > 0
                        ? "Your quiz attempts so far don't have enough answered questions to assess. Take a quiz and answer the questions to see your strong and weak areas."
                        : "Take a quiz to start seeing your strong and weak areas."}
                    </p>
                  ) : perf.state === "insufficient" ? (
                    <p className="text-sm text-muted-foreground">
                      You&apos;ve started quizzes here, but none has enough answered questions yet
                      for a reliable assessment. Answer more of a module&apos;s quiz to see where
                      you stand.
                    </p>
                  ) : (
                    <div className="grid gap-6 md:grid-cols-3">
                      <div className="rounded-xl border border-border p-4">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">
                          Course average
                        </p>
                        <p className="mt-1 font-display text-3xl">{perf.overall ?? 0}%</p>
                        <Progress value={perf.overall ?? 0} className="mt-3" />
                      </div>
                      <div className="rounded-xl border border-border p-4">
                        <p className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
                          <TrendingDown className="h-3.5 w-3.5" /> Weak modules
                        </p>
                        {perf.weak.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Nothing weak yet — nice.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5 text-sm">
                            {perf.weak.map((w) => (
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
                          <TrendingUp className="h-3.5 w-3.5" /> Strong modules
                        </p>
                        {perf.strong.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Keep practicing to build strengths.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5 text-sm">
                            {perf.strong.map((w) => (
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

            {/* PERSONALIZED LEARNING — the ONE adaptive-remediation surface. */}
            {course?.id && user && isEnrolled && !isLecturer && (
              <PersonalizedLearningSection courseId={course.id} perf={perf} enabled />
            )}

            {/* MODULES — the student's primary access to the official course
                curriculum. Kept first, above guidance and personalized
                remediation. */}
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
                      const stat = perf.perTopic.find((p) => p.topic.id === t.id);
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
                            {(() => {
                              const mm = mastery.modules.find((m) => m.topic.id === t.id);
                              if (!mm) return null;
                              return (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-muted-foreground">
                                    Your mastery
                                  </span>
                                  <MasteryBadge level={mm.level} score={mm.score} />
                                  <MasteryTrend mastery={mm} />
                                </div>
                              );
                            })()}
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

            {/* RECOMMENDATIONS — answers "what should I do next in this course?":
                guidance toward the official course content. Sits after Course
                modules and before Personalized Learning (AI remediation). */}
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
                {user && isEnrolled && !isLecturer ? (
                  <>
                    {perf.state === "weak" && (
                      <Button asChild variant="outline" className="w-full justify-start rounded-lg">
                        <Link to="/study-path/$courseId" params={{ courseId: course.id }}>
                          <Sparkles className="mr-2 h-4 w-4" /> Personalized Learning
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant="outline" className="w-full justify-start rounded-lg">
                      <Link to="/performance/$courseId" params={{ courseId: course.id }}>
                        <Target className="mr-2 h-4 w-4" /> My Performance
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full justify-start rounded-lg">
                      <Link to="/quizzes/$courseId" params={{ courseId: course.id }}>
                        <Brain className="mr-2 h-4 w-4" /> Take a Quiz
                      </Link>
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full justify-start rounded-lg"
                    onClick={() => {
                      if (!user) {
                        navigate({ to: "/login", search: { redirect: `/courses/${slug}` } });
                        return;
                      }
                      if (!isEnrolled) enroll.mutate();
                    }}
                  >
                    <Play className="mr-2 h-4 w-4" />{" "}
                    {user ? "Enroll to unlock quizzes" : "Sign in to get started"}
                  </Button>
                )}
              </CardContent>
            </Card>

            {user && isEnrolled && topics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Module checklist</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {perf.perTopic.map((p) => (
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
