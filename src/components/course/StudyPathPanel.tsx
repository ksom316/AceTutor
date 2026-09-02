import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { GenerateStudyPathResult, WeakArea } from "@/lib/study-path.functions";
import type { ParsedStudyPath } from "@/hooks/use-study-path";

const EASE = [0.22, 1, 0.36, 1] as const;

const CARD = "rounded-2xl border border-border bg-card p-6";

/* ------------------------------------------------------------------ *
 * StudyPathContentView — the shared presentational view of a known,
 * validated study path. Reused by the result page (below) and the course
 * page's "Personalized Learning" section. No AI / persistence logic.
 * ------------------------------------------------------------------ */

type ContentViewProps = {
  studyPath: ParsedStudyPath;
  /** Module study path → the module id for a "Retake quiz" link. Null for a
   *  course-level (General Course Quiz) study path. */
  topicId: string | null;
  completing: boolean;
  onMarkCompleted: (id: string) => void;
  saved: boolean;
  savingSaved: boolean;
  onSetSaved: (id: string, saved: boolean) => void;
  /** The result page offers a retake CTA; the course library does not need one. */
  showRetake?: boolean;
};

export function StudyPathContentView({
  studyPath,
  topicId,
  completing,
  onMarkCompleted,
  saved,
  savingSaved,
  onSetSaved,
  showRetake = false,
}: ContentViewProps) {
  const completed = !!studyPath.completed_at;
  const isCourseLevel = !studyPath.topic_id;

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-display text-xl">{studyPath.content.title}</h3>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {isCourseLevel
                  ? "Built from the questions you missed across this course's General Course Quiz — a short review of just those areas."
                  : "Based on the questions you found difficult in this quiz, a short review focused only on the areas you need to strengthen."}
              </p>
            </div>
          </div>
          {completed && (
            <Badge
              variant="secondary"
              className="shrink-0 gap-1 border-success/40 bg-success/10 text-success"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Reviewed
            </Badge>
          )}
        </div>
      </div>

      <ol className="space-y-4">
        {studyPath.content.weakAreas.map((area, i) => (
          <WeakAreaCard key={`${i}-${area.title}`} index={i + 1} area={area} />
        ))}
      </ol>

      <div className={cn(CARD, "flex flex-wrap items-center gap-2")}>
        {completed ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" /> Study path completed.
          </p>
        ) : (
          <Button
            variant="outline"
            disabled={completing}
            onClick={() => onMarkCompleted(studyPath.id)}
          >
            {completing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            I&apos;ve reviewed this study path
          </Button>
        )}

        {saved ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <BookmarkCheck className="h-4 w-4" /> Added to My Learning
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={savingSaved}
              onClick={() => onSetSaved(studyPath.id, false)}
            >
              {savingSaved ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Remove from My Learning
            </Button>
          </div>
        ) : (
          <Button disabled={savingSaved} onClick={() => onSetSaved(studyPath.id, true)}>
            {savingSaved ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            Add to My Learning
          </Button>
        )}

        {showRetake && topicId && (
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
  );
}

/* ------------------------------------------------------------------ */

/**
 * The explanation / worked example / self-check body for one weak area, with no
 * outer card. Shared by the compact `WeakAreaCard` (result + course surfaces)
 * and the guided reader on the dedicated learning page.
 */
export function WeakAreaBody({ area }: { area: WeakArea }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Explanation
        </p>
        <div className="prose-lesson mt-1.5 max-w-none break-words text-foreground">
          <ReactMarkdown>{area.explanation}</ReactMarkdown>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Worked example
        </p>
        <div className="prose-lesson mt-1.5 max-w-none break-words rounded-lg bg-muted/60 p-4 text-foreground">
          <ReactMarkdown>{area.example}</ReactMarkdown>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick self-check
        </p>
        <ul className="mt-2 space-y-2">
          {area.practice.map((item, i) => (
            <PracticeItem key={i} question={item.question} answer={item.answer} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function WeakAreaCard({ index, area }: { index: number; area: WeakArea }) {
  return (
    <li className={CARD}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-muted-foreground">{index}.</span>
        <h4 className="font-display text-lg">{area.title}</h4>
      </div>
      <div className="mt-3">
        <WeakAreaBody area={area} />
      </div>
    </li>
  );
}

function PracticeItem({ question, answer }: { question: string; answer: string }) {
  return (
    <li className="rounded-lg border border-border p-3">
      <p className="text-sm">{question}</p>
      <Collapsible className="mt-2">
        <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          <span className="group-data-[state=open]:hidden">Show answer</span>
          <span className="hidden group-data-[state=open]:inline">Hide answer</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-lg bg-success/10 p-2.5 text-sm text-foreground">
          {answer}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * StudyPathPanel — the result-page entry point. Owns the four states
 * (loading / generate CTA / existing / no-review-needed). The full
 * mini-course is NOT shown here: an existing path renders a COMPACT card
 * that links to the dedicated study path page (/learning/$studyPathId),
 * which owns StudyPathContentView.
 * ------------------------------------------------------------------ */

type PanelProps = {
  studyPath: ParsedStudyPath | null;
  isLoading: boolean;
  generating: boolean;
  generateResult: GenerateStudyPathResult | null;
  onGenerate: () => void;
  saved: boolean;
  savingSaved: boolean;
  onSetSaved: (id: string, saved: boolean) => void;
};

export function StudyPathPanel({
  studyPath,
  isLoading,
  generating,
  generateResult,
  onGenerate,
  saved,
  savingSaved,
  onSetSaved,
}: PanelProps) {
  if (isLoading) {
    return (
      <section aria-label="AI Study Path" className={cn(CARD, "flex items-center gap-3")}>
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking for a study path…</p>
      </section>
    );
  }

  // --- Existing study path — compact card, links to the dedicated page ----
  if (studyPath) {
    const justCreated = generateResult?.status === "created";
    const completed = !!studyPath.completed_at;
    return (
      <motion.section
        aria-label="Your AI Study Path"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className={cn(CARD, "border-primary/30 bg-primary/5")}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl">
                {justCreated
                  ? "Your Personalized Study Path is ready"
                  : "Your Personalized Study Path"}
              </h2>
              {completed && (
                <Badge
                  variant="secondary"
                  className="gap-1 border-success/40 bg-success/10 text-success"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Reviewed
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              We&apos;ve identified the areas that need revision based on your quiz performance.
              Study them on your dedicated study path page.
            </p>

            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Weak areas
              </p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {studyPath.content.weakAreas.map((area, i) => (
                  <li key={`${i}-${area.title}`} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{area.title}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button asChild className="transition-transform hover:scale-[1.02] active:scale-95">
                <Link to="/learning/$studyPathId" params={{ studyPathId: studyPath.id }}>
                  {justCreated ? "Start learning" : "Continue learning"}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>

              {saved ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={savingSaved}
                  onClick={() => onSetSaved(studyPath.id, false)}
                >
                  {savingSaved ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BookmarkCheck className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Remove from My Learning
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={savingSaved}
                  onClick={() => onSetSaved(studyPath.id, true)}
                >
                  {savingSaved ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Add to My Learning
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.section>
    );
  }

  // --- No weak areas (defensive — the CTA is score-gated) ----------------
  if (generateResult?.status === "not-needed") {
    return (
      <section aria-label="AI Study Path" className={CARD}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-xl">No review needed</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              You don&apos;t currently have any weak areas that need additional review.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // --- Generate CTA -----------------------------------------------------
  return (
    <motion.section
      aria-label="AI Study Path"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={cn(CARD, "border-primary/30 bg-primary/5")}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl">Your Personalized Study Path</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Missed a few questions? AceTutor can build a short review focused only on the areas you
            need to strengthen, so you can revise those and retake the quiz.
          </p>
          <div className="mt-4">
            <Button disabled={generating} onClick={onGenerate}>
              {generating ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Generating your study path…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Generate AI Study Path
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
