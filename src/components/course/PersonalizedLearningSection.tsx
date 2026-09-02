import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { moduleStudyPathCta, useCourseStudyPaths } from "@/hooks/use-study-path";
import {
  improvementLabel,
  type CoursePerformance,
  type ModulePerformance,
} from "@/lib/quiz-performance";

/**
 * The student's unified "Personalized Learning" experience for one course — the
 * ONE place adaptive remediation lives on the course page.
 *
 * A module appears here only when it currently needs attention:
 *   - "weak"          → a row with the module's last quiz score and a CTA that
 *                       reflects its CURRENT Study Path (Build / Continue+Remove
 *                       / Review+Remove).
 *   - "insufficient"  → a supportive "not enough evidence yet" row asking the
 *                       student to answer more of the quiz. No Study Path CTA.
 * Strong / no-data / historical paths never appear here.
 */
export function PersonalizedLearningSection({
  courseId,
  perf,
  enabled = true,
}: {
  courseId: string;
  perf: CoursePerformance;
  enabled?: boolean;
}) {
  const { studyPaths, isLoading, removeStudyPath, removingId } = useCourseStudyPaths(courseId, {
    enabled,
    all: true,
  });
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const weakModules = useMemo(() => perf.modules.filter((m) => m.state === "weak"), [perf.modules]);
  const insufficientModules = useMemo(
    () => perf.modules.filter((m) => m.state === "insufficient"),
    [perf.modules],
  );

  const pathsByAttempt = useMemo(
    () => new Map(studyPaths.filter((p) => p.attempt_id).map((p) => [p.attempt_id, p])),
    [studyPaths],
  );

  const rows = useMemo(
    () =>
      weakModules.map((m) => ({
        module: m,
        cta: moduleStudyPathCta(m.currentStudyPathAttemptId, pathsByAttempt),
      })),
    [weakModules, pathsByAttempt],
  );

  if (!enabled) return null;

  // Nothing that needs attention right now.
  if (!isLoading && weakModules.length === 0 && insufficientModules.length === 0) return null;

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
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {rows.map(({ module: m, cta }) => {
              const areaCount = cta.path?.content.weakAreas.length ?? 0;
              const removing = removingId === cta.studyPathId;
              const confirming = confirmRemoveId === cta.studyPathId;
              return (
                <div key={m.topic.id} className="rounded-xl border border-border bg-card p-4">
                  <p className="font-medium">{m.topic.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {m.averageScore !== null ? `Quiz average: ${m.averageScore}% · ` : ""}
                    {lastQuizLabel(m)}
                  </p>
                  {improvementLabel(m) && (
                    <p
                      className={`mt-0.5 text-xs font-medium ${
                        (m.improvementPoints ?? 0) > 0 ? "text-success" : "text-muted-foreground"
                      }`}
                    >
                      {improvementLabel(m)}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {cta.kind === "build" ? (
                      "Needs strengthening"
                    ) : (
                      <>
                        Study Path · {areaCount} area{areaCount === 1 ? "" : "s"} to revise ·{" "}
                        {cta.kind === "review" ? "Reviewed" : "In progress"}
                      </>
                    )}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {cta.kind === "build" ? (
                      <Button asChild size="sm">
                        <Link
                          to="/study-path/$courseId"
                          params={{ courseId }}
                          search={{ module: m.topic.id }}
                        >
                          <Sparkles className="mr-1.5 h-4 w-4" /> Build Study Path
                        </Link>
                      </Button>
                    ) : (
                      <>
                        <Button asChild size="sm">
                          <Link
                            to="/learning/$studyPathId"
                            params={{ studyPathId: cta.studyPathId }}
                          >
                            <ArrowRight className="mr-1.5 h-4 w-4" />
                            {cta.kind === "review" ? "Review Study Path" : "Continue Study Path"}
                          </Link>
                        </Button>

                        {confirming ? (
                          <>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={removing}
                              onClick={() => {
                                removeStudyPath(cta.studyPathId);
                                setConfirmRemoveId(null);
                              }}
                            >
                              {removing ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : null}
                              Confirm remove
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmRemoveId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={removing}
                            onClick={() => setConfirmRemoveId(cta.studyPathId)}
                          >
                            {removing ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Remove Study Path
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {insufficientModules.map((m) => (
              <div
                key={m.topic.id}
                className="rounded-xl border border-dashed border-border bg-card p-4"
              >
                <p className="font-medium">{m.topic.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{lastQuizLabel(m)}</p>
                <p className="mt-1 text-xs font-medium text-foreground">Not enough evidence yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You answered only {m.answeredCount ?? 0} of {m.totalQuestions ?? 0} questions.
                  Complete more of the quiz so AceTutor can reliably assess your understanding of
                  this module.
                </p>
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to="/quiz/$topicId"
                      params={{ topicId: m.topic.id }}
                      search={{ retake: true }}
                    >
                      Take the quiz
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "Last quiz: 60%" — with " · 3/20 answered" appended when that attempt was
 *  partial, so a high score off one answer never reads as mastery. */
function lastQuizLabel(m: ModulePerformance): string {
  if (m.lastUsableScore === null) return "No answered quiz yet";
  const base = `Last quiz: ${m.lastUsableScore}%`;
  const partial =
    m.coveragePercent !== null &&
    m.coveragePercent < 100 &&
    m.answeredCount !== null &&
    m.totalQuestions !== null;
  return partial ? `${base} · ${m.answeredCount}/${m.totalQuestions} answered` : base;
}
