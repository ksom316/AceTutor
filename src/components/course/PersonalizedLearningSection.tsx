import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useCourseStudyPaths, type ParsedStudyPath } from "@/hooks/use-study-path";

/**
 * The student's private "Personalized Learning" area for one course — a
 * LIBRARY / OVERVIEW of the AI Study Paths they have added to My Learning
 * (module + course-level General Quiz). It intentionally does NOT render the
 * full mini-course; each row is a concise summary with a "Continue Learning"
 * link to the dedicated study path page where the content is actually studied.
 *
 * Visually its own card, clearly separate from the official course modules and
 * from the official course-progress percentage. RLS (`study_paths_select_own`)
 * guarantees only the current student's paths load.
 */
export function PersonalizedLearningSection({
  courseId,
  topicTitleById,
  enabled = true,
}: {
  courseId: string;
  topicTitleById: Map<string, string>;
  enabled?: boolean;
}) {
  const { studyPaths, stats, isLoading, setSaved, savingSavedId } = useCourseStudyPaths(courseId, {
    enabled,
  });

  if (!enabled) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" /> Your Personalized Learning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Nothing saved yet — don't show an empty section.
  if (studyPaths.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-primary" /> Your Personalized Learning
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Targeted revision AceTutor built from your quiz performance. Personal to you, and separate
          from official course progress.
        </p>
        <p className="text-xs text-muted-foreground">
          {stats.total} saved · {stats.completed} reviewed · {stats.inProgress} in progress
        </p>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {studyPaths.map((sp) => (
            <StudyPathRow
              key={sp.id}
              studyPath={sp}
              moduleTitle={sp.topic_id ? (topicTitleById.get(sp.topic_id) ?? null) : null}
              removing={savingSavedId === sp.id}
              onRemove={() => setSaved(sp.id, false)}
            />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function statusLabel(sp: ParsedStudyPath): "Reviewed" | "In progress" {
  return sp.completed_at ? "Reviewed" : "In progress";
}

function StudyPathRow({
  studyPath: sp,
  moduleTitle,
  removing,
  onRemove,
}: {
  studyPath: ParsedStudyPath;
  moduleTitle: string | null;
  removing: boolean;
  onRemove: () => void;
}) {
  const heading = moduleTitle
    ? `${moduleTitle} — Study Path`
    : sp.content.title || "General Quiz Review";
  const areaCount = sp.content.weakAreas.length;
  const status = statusLabel(sp);

  return (
    <AccordionItem value={sp.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3 pr-3">
          <div className="min-w-0 text-left">
            <p className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">{heading}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {areaCount} weak area{areaCount === 1 ? "" : "s"}
              {sp.topic_id ? "" : " · Course-wide"}
            </p>
          </div>
          <Badge
            variant={sp.completed_at ? "secondary" : "outline"}
            className={sp.completed_at ? "border-success/40 bg-success/10 text-success" : undefined}
          >
            {status}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pt-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Areas to revise
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {sp.content.weakAreas.map((area, i) => (
                <li key={`${i}-${area.title}`}>
                  <Badge variant="secondary" className="font-normal">
                    {area.title}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            Status: {status}
            {moduleTitle ? ` · Module: ${moduleTitle}` : " · Course-wide revision"}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link to="/learning/$studyPathId" params={{ studyPathId: sp.id }}>
                <ArrowRight className="mr-1.5 h-4 w-4" /> Continue Learning
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={removing}
              onClick={onRemove}
            >
              {removing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Remove from My Learning
            </Button>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
