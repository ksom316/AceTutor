import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpen, Sparkles, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyPath } from "@/hooks/use-study-path";
import { StudyPathPanel } from "@/components/course/StudyPathPanel";
import {
  computeCoursePerformance,
  type ModulePerformance,
  type PerfAttempt,
  type PerfTopic,
} from "@/lib/quiz-performance";
import { fadeUp } from "@/lib/motion";

type StudyPathSearch = { module?: string };

export const Route = createFileRoute("/_authenticated/study-path/$courseId")({
  validateSearch: (search: Record<string, unknown>): StudyPathSearch => ({
    module: typeof search.module === "string" ? search.module : undefined,
  }),
  component: CourseStudyPathPage,
});

/**
 * Module-level Study Path gateway. Every "Build My Study Path" surface (course
 * page, adaptive card, My Performance) converges here.
 *
 * `?module=<topicId>` focuses one module; without it the page lists every weak
 * module, each with its own Study Path. State + weak modules come from the SAME
 * shared `computeCoursePerformance` the rest of the app uses. Each module's
 * CURRENT Study Path is identified by `currentStudyPathAttemptId` and
 * generated/persisted through the existing `useStudyPath` / `generateStudyPath`
 * — one current path per module, no course-wide combined path, older paths kept
 * as history in My Learning.
 */
function CourseStudyPathPage() {
  const { courseId } = Route.useParams();
  const { module: focusModuleId } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: course, isLoading: courseLoading } = useQuery({
    queryKey: ["studypath-course", courseId],
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
    queryKey: ["studypath-enrollment", user?.id, courseId],
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
    queryKey: ["studypath-topics", courseId],
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
    queryKey: ["studypath-attempts", user?.id, courseId, topics.length],
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
  const focusModule = focusModuleId
    ? (perf.modules.find((m) => m.topic.id === focusModuleId) ?? null)
    : null;
  const weakModules = perf.modules.filter((m) => m.state === "weak");
  const strongModules = perf.modules.filter((m) => m.state === "strong");

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
          <h1 className="font-display text-2xl">Enroll to build a Study Path</h1>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/courses/$slug" params={{ slug: course.slug }}>
              Go to course
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  // --- Focused: one module ------------------------------------------------
  if (focusModule) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-12">
        {backToCourse}
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/study-path/$courseId" params={{ courseId }}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> All study paths
          </Link>
        </Button>
        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Personalized Study Path
          </p>
          <h1 className="mt-2 font-display text-4xl">{focusModule.topic.title}</h1>
        </motion.div>
        <div className="mt-6">
          <ModuleStudyPath module={focusModule} courseId={courseId} />
        </div>
      </main>
    );
  }

  // --- List: every module that needs work -------------------------------
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      {backToCourse}
      <motion.div variants={fadeUp} initial="hidden" animate="show">
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Personalized Study Paths
        </p>
        <h1 className="mt-2 font-display text-4xl">{course.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Each module is assessed on its own. Modules that need work get their own Study Path, built
          from the questions you&apos;ve missed in that module and presented using your current
          Learning Preferences.
        </p>
      </motion.div>

      {perf.state === "no-data" && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl">Your Study Paths need quiz performance data</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {perf.unusableAttemptCount > 0
              ? "Your quiz attempts so far don't have enough answered questions for AceTutor to work out which modules you need to strengthen. Take a quiz and answer the questions."
              : "Take a module quiz and answer its questions so AceTutor can identify which modules need a Study Path."}
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/quizzes/$courseId" params={{ courseId }}>
              Take a Quiz <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </section>
      )}

      {perf.state === "insufficient" && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Sparkles className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl">Not enough evidence yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            You&apos;ve started quizzes here, but none has enough answered questions for AceTutor to
            work out where you stand. Answer more of a module&apos;s quiz, then come back.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/quizzes/$courseId" params={{ courseId }}>
              Take a Quiz <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </section>
      )}

      {perf.state === "strong" && (
        <section className="mt-8 rounded-2xl border border-success/30 bg-success/5 p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
            <TrendingUp className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl">You&apos;re doing great!</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Your recent quiz performance doesn&apos;t show any modules that need remediation right
            now, so there&apos;s no Study Path to build. Keep going and reassess with another quiz
            later.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/quizzes/$courseId" params={{ courseId }}>
                Take a Quiz
              </Link>
            </Button>
            <Button asChild variant="ghost" className="rounded-full">
              <Link to="/courses/$slug" params={{ slug: course.slug }}>
                <BookOpen className="mr-1.5 h-4 w-4" /> Review course material
              </Link>
            </Button>
          </div>
        </section>
      )}

      {perf.state === "weak" && (
        <div className="mt-8 space-y-8">
          {weakModules.map((m) => (
            <section key={m.topic.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-2xl">{m.topic.title}</h2>
                <Badge variant="secondary">Last quiz: {m.lastUsableScore ?? 0}%</Badge>
              </div>
              <div className="mt-3">
                <ModuleStudyPath module={m} courseId={courseId} />
              </div>
            </section>
          ))}

          {strongModules.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Doing well:{" "}
              {strongModules.map((m) => `${m.topic.title} (${m.lastUsableScore ?? 0}%)`).join(", ")}
              . No Study Path needed for {strongModules.length === 1 ? "it" : "those"}.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

/**
 * One module's CURRENT Study Path — loads or generates the path identified by
 * `currentStudyPathAttemptId` (the module's latest usable imperfect attempt),
 * then hands off to the existing `StudyPathPanel` (which links on to
 * `/learning/$studyPathId` for the actual studying). Repeat visits with no new
 * attempt reuse the same path; a retake that produces a newer imperfect attempt
 * moves the identity and offers a fresh path built from the module's full
 * incorrect-answer history — the previous one stays in My Learning. Its own
 * component so the `useStudyPath` hook can run per module.
 */
function ModuleStudyPath({ module: m, courseId }: { module: ModulePerformance; courseId: string }) {
  const anchor = m.currentStudyPathAttemptId;
  const sp = useStudyPath(anchor ?? "", { enabled: !!anchor });

  if (m.state === "insufficient") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Not enough evidence yet</p>
        <p className="mt-1">
          You answered only {m.answeredCount ?? 0} of {m.totalQuestions ?? 0} questions on your last
          attempt. Complete more of the quiz so AceTutor can reliably assess this module and build a
          Study Path.
        </p>
        <div className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link to="/quiz/$topicId" params={{ topicId: m.topic.id }} search={{ retake: true }}>
              Take the quiz
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!anchor) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        This module looks like it needs work, but there aren&apos;t any missed questions to build a
        Study Path from yet. Take a full quiz for this module and answer every question.
        <div className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link to="/quizzes/$courseId" params={{ courseId }}>
              Take a Quiz
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        Your current Study Path for this module. It&apos;s built from the questions you&apos;ve
        missed across your {m.usableAttemptCount} answered{" "}
        {m.usableAttemptCount === 1 ? "attempt" : "attempts"} and presented using your current
        Learning Preferences.
      </p>
      <StudyPathPanel
        studyPath={sp.studyPath}
        isLoading={sp.isLoading}
        generating={sp.generating}
        generateResult={sp.generateResult}
        onGenerate={sp.generate}
      />
    </>
  );
}
