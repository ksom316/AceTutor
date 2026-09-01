import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useStudyPathById } from "@/hooks/use-study-path";
import { StudyPathContentView } from "@/components/course/StudyPathPanel";

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
  const sp = useStudyPathById(studyPathId);

  const courseId = sp.studyPath?.course_id ?? null;
  const topicId = sp.studyPath?.topic_id ?? null;

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

  if (sp.isLoading) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your study path…</p>
      </main>
    );
  }

  if (!sp.studyPath) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl">Study path not available</h1>
        <p className="mt-2 text-muted-foreground">
          This study path doesn&apos;t exist, or it isn&apos;t part of your learning.
        </p>
        <Button asChild className="mt-6">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </main>
    );
  }

  const studyPath = sp.studyPath;
  const isCourseLevel = !studyPath.topic_id;
  const courseSlug = context?.courseSlug ?? null;
  const backLabel = `Back to ${context?.courseTitle ?? "course"}`;

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
          Personalized Learning
        </p>
        <h1 className="mt-2 font-display text-4xl">{studyPath.content.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{context?.courseTitle ?? "This course"}</Badge>
          <Badge variant="outline">
            {isCourseLevel
              ? "Course-wide revision"
              : `Module: ${context?.topicTitle ?? "This module"}`}
          </Badge>
          {studyPath.completed_at && (
            <Badge variant="secondary" className="border-success/40 bg-success/10 text-success">
              Reviewed
            </Badge>
          )}
        </div>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          This revision was generated from the questions you missed. It is personal to you and does
          not affect your official course or module progress.
        </p>
      </motion.div>

      <div className="mt-8">
        <StudyPathContentView
          studyPath={studyPath}
          topicId={studyPath.topic_id}
          completing={sp.completing}
          onMarkCompleted={sp.markCompleted}
          saved={!!studyPath.saved_at}
          savingSaved={sp.savingSaved}
          onSetSaved={sp.setSaved}
          showRetake={!!studyPath.topic_id}
        />
      </div>

      <div className="mt-10">
        <Button asChild variant="outline">
          <BackLink
            courseSlug={courseSlug}
            label={backLabel}
            className="inline-flex items-center gap-1.5"
          />
        </Button>
      </div>
    </main>
  );
}
