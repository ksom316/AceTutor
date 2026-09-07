import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Info, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyPathById } from "@/hooks/use-study-path";
import { RecoveryRoadmap } from "@/components/course/RecoveryRoadmap";

export const Route = createFileRoute("/_authenticated/learning/$studyPathId")({
  component: StudyPathLearningPage,
});

const EASE = [0.22, 1, 0.36, 1] as const;

/** Back to the course page when we know its slug, otherwise the dashboard. */
function BackLink({
  courseSlug,
  label,
  className,
}: {
  courseSlug: string | null;
  label: string;
  className?: string;
}) {
  const inner = (
    <>
      <ArrowLeft className="h-4 w-4" />
      {label}
    </>
  );
  return courseSlug ? (
    <Link to="/courses/$slug" params={{ slug: courseSlug }} className={className}>
      {inner}
    </Link>
  ) : (
    <Link to="/dashboard" className={className}>
      {inner}
    </Link>
  );
}

function StudyPathLearningPage() {
  const { studyPathId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const sp = useStudyPathById(studyPathId);

  const courseId = sp.studyPath?.course_id ?? null;
  const topicId = sp.studyPath?.topic_id ?? null;
  const pathCreatedAt = sp.studyPath?.created_at ?? null;

  // Whether the student's Learning Preferences were saved AFTER this path was
  // built — this path stays as it was; current preferences apply to new paths.
  const { data: prefsChangedAfter } = useQuery({
    queryKey: ["study-path-prefs-freshness", user?.id, pathCreatedAt],
    enabled: !!user && !!pathCreatedAt,
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_preferences")
        .select("updated_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (!data?.updated_at) return false;
      return new Date(data.updated_at).getTime() > new Date(pathCreatedAt!).getTime();
    },
  });

  // Context for the header / back link. Both reads are RLS-scoped; a student can
  // only reach a study path they own, and its course/topic are public catalogue
  // rows.
  const { data: context } = useQuery({
    queryKey: ["study-path-context", courseId, topicId],
    enabled: !!courseId,
    queryFn: async () => {
      const { data: course } = await supabase
        .from("courses")
        .select("title, slug")
        .eq("id", courseId!)
        .maybeSingle();
      let topicTitle: string | null = null;
      if (topicId) {
        const { data: topic } = await supabase
          .from("topics")
          .select("title")
          .eq("id", topicId)
          .maybeSingle();
        topicTitle = topic?.title ?? null;
      }
      return {
        courseTitle: course?.title ?? "Course",
        courseSlug: course?.slug ?? null,
        topicTitle,
      };
    },
  });

  // P1.1 — the score on the quiz attempt that triggered this path, for the
  // "Why this study path?" summary. Existing stored data only, RLS-scoped to
  // the student's own attempt; no AI.
  const { data: anchorScorePercent } = useQuery({
    queryKey: ["study-path-anchor-score", sp.studyPath?.attempt_id],
    enabled: !!sp.studyPath?.attempt_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("score, total")
        .eq("id", sp.studyPath!.attempt_id)
        .maybeSingle();
      if (!data || !data.total || data.total <= 0) return null;
      return Math.round(((data.score ?? 0) / data.total) * 100);
    },
  });

  const courseSlug = context?.courseSlug ?? null;
  const courseTitle = context?.courseTitle ?? "course";
  const backLabel = `Back to ${courseTitle}`;

  if (sp.isLoading) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your study path…</p>
      </main>
    );
  }

  const studyPath = sp.studyPath;

  if (!studyPath) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl">We couldn&apos;t open this study path</h1>
        <p className="mt-2 text-muted-foreground">
          It may have been removed, or it isn&apos;t part of your learning. Your quiz results and
          course progress are unaffected.
        </p>
        <Button asChild className="mt-6">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </main>
    );
  }

  const isCourseLevel = !studyPath.topic_id;
  const areas = studyPath.content.weakAreas;
  const completed = !!studyPath.completed_at;
  const spId = studyPath.id;

  const retakeButton = topicId ? (
    <Button
      asChild
      variant={completed ? "default" : "secondary"}
      className="transition-transform hover:scale-[1.02] active:scale-95"
    >
      <Link to="/quiz/$topicId" params={{ topicId }} search={{ retake: true }}>
        <RotateCcw className="mr-1.5 h-4 w-4" /> Retake official quiz
      </Link>
    </Button>
  ) : null;

  const removeStudyPathControl = confirmRemove ? (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="destructive"
        size="sm"
        disabled={sp.removing}
        onClick={() =>
          sp.removeStudyPath(spId, {
            onSuccess: () =>
              courseSlug
                ? navigate({ to: "/courses/$slug", params: { slug: courseSlug } })
                : navigate({ to: "/dashboard" }),
          })
        }
      >
        {sp.removing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        Confirm remove
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
        Cancel
      </Button>
    </span>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive"
      onClick={() => setConfirmRemove(true)}
    >
      Remove from Learning
    </Button>
  );

  // The completion step of the Recovery Roadmap. Completion is ONLY ever the
  // student's explicit "Mark as complete" — reaching the last step never
  // completes the path, and it never touches Mastery.
  const roadmapCompletion = (
    <div className="space-y-4">
      <p
        className={
          completed
            ? "flex items-center gap-2 font-medium text-success"
            : "text-sm text-muted-foreground"
        }
      >
        {completed && <CheckCircle2 className="h-4 w-4 shrink-0" />}
        You reviewed all your weak areas.{" "}
        {topicId
          ? "Retaking the official module quiz is what updates your Mastery Score — marking this complete does not."
          : "Retaking the course quizzes is what updates your Mastery Score — marking this complete does not."}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {retakeButton}
        {!completed && (
          <Button disabled={sp.completing} onClick={() => sp.markCompleted(spId)}>
            {sp.completing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            Mark as complete
          </Button>
        )}
        {removeStudyPathControl}
      </div>
    </div>
  );

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <BackLink
        courseSlug={courseSlug}
        label={backLabel}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="mt-4"
      >
        <p className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Your Personalized Learning
        </p>
        <h1 className="mt-2 font-display text-4xl">{studyPath.content.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{context?.courseTitle ?? "This course"}</Badge>
          <Badge variant="outline">
            {isCourseLevel
              ? "Course-wide revision"
              : `Module: ${context?.topicTitle ?? "This module"}`}
          </Badge>
          {completed && (
            <Badge variant="secondary" className="border-success/40 bg-success/10 text-success">
              Complete
            </Badge>
          )}
        </div>
      </motion.div>

      {/* P1.1 — "Why this study path?" — built entirely from data already
          stored (the anchoring attempt score + the path's weak areas). No AI. */}
      <div className="mt-5 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">Why this study path?</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {anchorScorePercent != null && (
            <>
              You scored {anchorScorePercent}% on{" "}
              {isCourseLevel
                ? (context?.courseTitle ?? "this course")
                : (context?.topicTitle ?? "this module")}
              .{" "}
            </>
          )}
          AceTutor built this review around the {areas.length} concept
          {areas.length === 1 ? "" : "s"} you missed most on the quiz — work through{" "}
          {areas.length === 1 ? "it" : "them"} before you{" "}
          {isCourseLevel ? "revisit the course" : "retake the official module quiz"}:
        </p>
        <ul className="mt-2 space-y-1">
          {areas.map((a, i) => (
            <li key={`${i}-${a.title}`} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{a.title}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Working through this review is separate from your official course and module progress.
        </p>
      </div>

      {/* "How this Study Path was personalized" callout — informational, always
          visible before the student starts the roadmap. Not a warning. */}
      <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm font-semibold">How this Study Path was personalized</p>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          AceTutor built this from the questions you missed on the quiz. Your Learning Preferences
          shape how each step is written, and your recent learning activity and VARK results
          influence which delivery format the roadmap recommends — you can still switch format at
          any time.
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {prefsChangedAfter
            ? "You've changed your Learning Preferences since then. This Study Path keeps the settings it was built with; your newer preferences apply the next time a Study Path is generated. Remove this one and build it again to use them."
            : "Changing your Learning Preferences later won't modify this Study Path. Your current preferences apply whenever a new Study Path is generated."}
        </p>
      </div>

      {/* The ONE learning area: a step-by-step Recovery Roadmap over this path's
          weak concepts, delivered in the recommended format. Generated on
          demand, cached, and never affects course/module progress, Mastery, or
          the A7 learning algorithm. */}
      <div className="mt-6">
        <RecoveryRoadmap studyPath={studyPath} completion={roadmapCompletion} />
      </div>
    </main>
  );
}
