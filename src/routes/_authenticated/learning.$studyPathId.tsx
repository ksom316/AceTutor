import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, BookmarkCheck, CheckCircle2, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useStudyPathById } from "@/hooks/use-study-path";
import { GuidedReader, type ReaderSection } from "@/components/course/GuidedReader";
import { WeakAreaBody } from "@/components/course/StudyPathPanel";

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

  const isCourseLevel = !studyPath.topic_id;
  const areas = studyPath.content.weakAreas;
  const completed = !!studyPath.completed_at;
  const saved = !!studyPath.saved_at;
  const spId = studyPath.id;
  const areaPhrase = areas.length === 1 ? "the area" : `all ${areas.length} areas`;

  // One guided page per weak area, wrapped by an overview page and a wrap-up
  // page that carries the (unchanged) completion / My Learning / retake actions.
  const sections: ReaderSection[] = [
    {
      key: "overview",
      heading: "What to focus on",
      body: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            This short review targets the {areas.length} area{areas.length === 1 ? "" : "s"} you
            found hardest on the quiz. Read each one, try the self-check questions, then mark it
            reviewed at the end. This does not affect your official course or module progress.
          </p>
          <ul className="space-y-2">
            {areas.map((a, i) => (
              <li key={`${i}-${a.title}`} className="flex items-start gap-2.5">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="text-foreground">{a.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    ...areas.map(
      (area, i): ReaderSection => ({
        key: `area-${i}`,
        heading: area.title,
        body: <WeakAreaBody area={area} />,
      }),
    ),
    {
      key: "wrap-up",
      heading: "Wrap up",
      body: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            You&apos;ve been through {areaPhrase} in this study path. When you feel ready, mark it
            reviewed{topicId ? " and retake the quiz to check your progress." : "."}
          </p>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {completed ? (
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> Study path completed.
              </p>
            ) : (
              <Button
                variant="outline"
                disabled={sp.completing}
                onClick={() => sp.markCompleted(spId)}
              >
                {sp.completing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                )}
                I&apos;ve reviewed this study path
              </Button>
            )}

            {saved ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-success">
                  <BookmarkCheck className="h-4 w-4" /> Added to My Learning
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={sp.savingSaved}
                  onClick={() => sp.setSaved(spId, false)}
                >
                  {sp.savingSaved ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Remove from My Learning
                </Button>
              </div>
            ) : (
              <Button disabled={sp.savingSaved} onClick={() => sp.setSaved(spId, true)}>
                {sp.savingSaved ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                Add to My Learning
              </Button>
            )}

            {topicId && (
              <Button
                asChild
                variant="secondary"
                className="transition-transform hover:scale-[1.02] active:scale-95"
              >
                <Link to="/quiz/$topicId" params={{ topicId }} search={{ retake: true }}>
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Retake quiz
                </Link>
              </Button>
            )}
          </div>
        </div>
      ),
    },
  ];

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
          {studyPath.completed_at && (
            <Badge variant="secondary" className="border-success/40 bg-success/10 text-success">
              Reviewed
            </Badge>
          )}
        </div>
      </motion.div>

      <div className="mt-6">
        <GuidedReader
          sections={sections}
          resetKey={spId}
          ariaLabel={`${studyPath.content.title} — guided reading`}
          finalCta={
            <Button asChild>
              {courseSlug ? (
                <Link to="/courses/$slug" params={{ slug: courseSlug }}>
                  Back to {courseTitle}
                </Link>
              ) : (
                <Link to="/dashboard">Back to dashboard</Link>
              )}
            </Button>
          }
        />
      </div>
    </main>
  );
}
