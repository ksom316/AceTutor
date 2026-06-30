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
import { askCourse, type AIQuizQuestion } from "@/lib/course-chat.functions";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AIQuizDialog } from "@/components/course/AIQuizDialog";

export const Route = createFileRoute("/courses/$slug")({
  component: CourseDetail,
});

type TopicRow = { id: string; slug: string; title: string; summary: string | null; order_index: number };
type AttemptRow = { id: string; topic_id: string; score: number; total: number; finished_at: string | null };

function CourseDetail() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const ask = useServerFn(askCourse);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<"gemini" | "llama" | "deepseek">("gemini");
  const [activeModule, setActiveModule] = useState<TopicRow | null>(null);
  const [aiQuiz, setAiQuiz] = useState<{ module: TopicRow; questions: AIQuizQuestion[] } | null>(null);

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
    const scored = perTopic.filter((p) => p.accuracy !== null) as { topic: TopicRow; accuracy: number; attempts: number }[];
    const totalScore = finished.reduce((s, a) => s + a.score, 0);
    const totalQ = finished.reduce((s, a) => s + a.total, 0);
    const overall = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;
    const completed = perTopic.filter((p) => p.attempts > 0).length;
    const progress = topics.length > 0 ? Math.round((completed / topics.length) * 100) : 0;
    const weak = [...scored].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3).filter((p) => p.accuracy < 70);
    const strong = [...scored].sort((a, b) => b.accuracy - a.accuracy).slice(0, 3).filter((p) => p.accuracy >= 70);
    const nextTopic = topics.find((t) => !byTopic.has(t.id)) ?? topics[0];
    return { perTopic, overall, progress, completed, weak, strong, nextTopic };
  }, [attempts, topics]);

  const performanceSummary = useMemo(() => {
    if (analytics.perTopic.length === 0) return "No quiz attempts yet.";
    const lines = [
      `Overall accuracy: ${analytics.overall}%`,
      `Modules completed: ${analytics.completed}/${topics.length}`,
      ...analytics.perTopic
        .filter((p) => p.accuracy !== null)
        .map((p) => `- ${p.topic.title}: ${p.accuracy}% (${p.attempts} attempts)`),
    ];
    return lines.join("\n");
  }, [analytics, topics.length]);

  const enroll = useMutation({
    mutationFn: async () => {
      if (!user || !course) throw new Error("Sign in to enroll");
      const { error } = await supabase.from("enrollments").insert({ user_id: user.id, course_id: course.id });
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
      if (!course) throw new Error("Course not loaded");
      return ask({
        data: {
          courseTitle: course.title,
          courseSummary: course.summary ?? undefined,
          mode: vars.mode,
          provider,
          question: vars.question,
          moduleTitle: vars.moduleTitle,
          moduleSummary: vars.moduleSummary,
          performanceSummary,
        },
      });
    },
  });

  const generateQuiz = useMutation({
    mutationFn: async (module: TopicRow) => {
      if (!course) throw new Error("Course not loaded");
      const res = await ask({
        data: {
          courseTitle: course.title,
          courseSummary: course.summary ?? undefined,
          mode: "quiz_json",
          provider,
          moduleTitle: module.title,
          moduleSummary: module.summary ?? undefined,
          performanceSummary,
        },
      });
      if (!res.quiz || res.quiz.length === 0) throw new Error("No quiz returned");
      return { module, questions: res.quiz };
    },
    onSuccess: (data) => setAiQuiz(data),
    onError: (e: Error) => toast.error(e.message),
  });


  const recommendations = useQuery({
    queryKey: ["course-recs", course?.id, performanceSummary, provider],
    enabled: !!course && !!user && attempts.length > 0,
    queryFn: async () => {
      const res = await ask({
        data: {
          courseTitle: course!.title,
          courseSummary: course!.summary ?? undefined,
          mode: "recommend",
          provider,
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
        <main className="container mx-auto max-w-6xl px-4 py-12 text-sm text-muted-foreground">Loading…</main>
      </PageShell>
    );
  }

  const isEnrolled = !!enrollment;

  return (
    <PageShell>
      <main className="container mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          <Link to="/courses" className="hover:underline">Courses</Link>
        </p>

        {/* HEADER */}
        <section className="mt-3 rounded-2xl border border-border bg-card p-6 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-3xl md:text-5xl">{course.title}</h1>
                {user && (
                  isEnrolled ? (
                    <Badge className="ml-1"><Check className="mr-1 h-3 w-3" /> Enrolled</Badge>
                  ) : (
                    <Badge variant="outline">Not enrolled</Badge>
                  )
                )}
              </div>
              {course.summary && <p className="mt-3 max-w-2xl text-muted-foreground">{course.summary}</p>}

              {user && isEnrolled && topics.length > 0 && (
                <div className="mt-6 max-w-md">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Course progress</span>
                    <span>{analytics.completed}/{topics.length} modules · {analytics.progress}%</span>
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
                  {enroll.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Plus className="mr-2 h-5 w-5" />}
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
                {/* AI model selector */}
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">AI model</span>
                  <div className="inline-flex rounded-full border border-border bg-background p-0.5">
                    {([
                      { id: "gemini", label: "Gemini" },
                      { id: "llama", label: "Llama 3.3" },
                      { id: "deepseek", label: "DeepSeek" },
                    ] as const).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProvider(p.id)}
                        aria-pressed={provider === p.id ? "true" : "false"}
                        className={
                          "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                          (provider === p.id
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground")
                        }
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
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
                    <Button type="submit" size="icon" disabled={!input.trim() || tutor.isPending} className="h-9 w-9 shrink-0 rounded-full" aria-label="Send">
                      {tutor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    </Button>
                  </div>
                </form>

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
                      onClick={() =>
                        tutor.mutate({
                          mode,
                          moduleTitle: activeModule?.title,
                          moduleSummary: activeModule?.summary ?? undefined,
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={generateQuiz.isPending || topics.length === 0}
                    onClick={() => {
                      const mod = activeModule ?? topics[0];
                      if (!mod) {
                        toast.error("No module available");
                        return;
                      }
                      generateQuiz.mutate(mod);
                    }}
                  >
                    {generateQuiz.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Brain className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Generate Quiz
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    disabled={tutor.isPending}
                    onClick={() => tutor.mutate({ mode: "general" })}
                  >
                    General overview
                  </Button>
                </div>

                {(tutor.isPending || tutor.data || tutor.isError) && (
                  <div className="mt-6 rounded-xl border border-border bg-background/50 p-5">
                    {tutor.isPending && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                      </div>
                    )}
                    {tutor.isError && (
                      <p className="text-sm text-destructive">Couldn't get a response: {(tutor.error as Error).message}</p>
                    )}
                    {tutor.data?.related === false && (
                      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        <div>
                          <p className="font-medium text-foreground">That doesn't look related to {course.title}.</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {tutor.data.reason || `Try asking something specific to ${course.title}.`}
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
                                <p className="text-xs uppercase tracking-wider text-muted-foreground">Module {idx + 1}</p>
                                <p className="font-medium">{t.title}</p>
                              </div>
                              {stat?.accuracy !== null && stat?.accuracy !== undefined && (
                                <Badge variant={stat.accuracy >= 70 ? "default" : "secondary"}>{stat.accuracy}%</Badge>
                              )}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            {t.summary && <p className="text-sm text-muted-foreground">{t.summary}</p>}
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Link to="/topic/$topicId" params={{ topicId: t.id }}>
                                <Button size="sm" variant="outline" className="rounded-full">
                                  <BookOpen className="mr-1.5 h-4 w-4" /> Open module
                                </Button>
                              </Link>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                onClick={() => {
                                  setActiveModule(t);
                                  document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                              >
                                <Sparkles className="mr-1.5 h-4 w-4" /> Ask AI about this module
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                disabled={generateQuiz.isPending}
                                onClick={() => generateQuiz.mutate(t)}
                              >
                                {generateQuiz.isPending ? (
                                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                ) : (
                                  <Brain className="mr-1.5 h-4 w-4" />
                                )}
                                Generate quiz
                              </Button>
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
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Overall accuracy</p>
                        <p className="mt-1 font-display text-3xl">{analytics.overall}%</p>
                        <Progress value={analytics.overall} className="mt-3" />
                      </div>
                      <div className="rounded-xl border border-border p-4">
                        <p className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
                          <TrendingDown className="h-3.5 w-3.5" /> Weak topics
                        </p>
                        {analytics.weak.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">Nothing weak yet — nice.</p>
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
                          <p className="mt-2 text-sm text-muted-foreground">Keep practicing to build strengths.</p>
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
                {analytics.nextTopic ? (
                  <>
                    <Link to="/quiz/$topicId" params={{ topicId: analytics.nextTopic.id }} className="block">
                      <Button variant="outline" className="w-full justify-start rounded-lg">
                        <ClipboardList className="mr-2 h-4 w-4" /> Start quiz
                      </Button>
                    </Link>
                    <Link to="/topic/$topicId" params={{ topicId: analytics.nextTopic.id }} className="block">
                      <Button variant="outline" className="w-full justify-start rounded-lg">
                        <Play className="mr-2 h-4 w-4" /> Continue learning
                      </Button>
                    </Link>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No modules available.</p>
                )}
                <Button
                  variant="outline"
                  className="w-full justify-start rounded-lg"
                  onClick={() => document.documentElement.scrollTo({ top: 0, behavior: "smooth" })}
                >
                  <Sparkles className="mr-2 h-4 w-4" /> Ask AI Tutor
                </Button>
                <Link to="/dashboard" className="block">
                  <Button variant="outline" className="w-full justify-start rounded-lg">
                    <History className="mr-2 h-4 w-4" /> View past results
                  </Button>
                </Link>
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
                          <span className="shrink-0 text-xs text-muted-foreground">{p.accuracy}%</span>
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
      {aiQuiz && user && (
        <AIQuizDialog
          open={!!aiQuiz}
          onClose={() => setAiQuiz(null)}
          courseTitle={course.title}
          moduleTitle={aiQuiz.module.title}
          topicId={aiQuiz.module.id}
          userId={user.id}
          questions={aiQuiz.questions}
          onCompleted={() => {
            qc.invalidateQueries({ queryKey: ["course-attempts", user.id, course.id] });
            // Keep the dashboard / home quiz widgets in sync with the new attempt.
            qc.invalidateQueries({ queryKey: ["dash-attempts", user.id] });
            qc.invalidateQueries({ queryKey: ["dash-progress", user.id] });
          }}
        />
      )}
    </PageShell>
  );
}
