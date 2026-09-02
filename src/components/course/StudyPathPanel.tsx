import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { ArrowRight, CheckCircle2, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { GenerateStudyPathResult, WeakArea } from "@/lib/study-path.functions";
import type { ParsedStudyPath } from "@/hooks/use-study-path";

const EASE = [0.22, 1, 0.36, 1] as const;

const CARD = "rounded-2xl border border-border bg-card p-6";

/* ------------------------------------------------------------------ */

/**
 * The explanation / worked example / self-check body for one weak area, with no
 * outer card. Used by the guided reader on the dedicated learning page.
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
 * StudyPathPanel — the entry point on the quiz-result page and the module
 * Study Path gateway. Owns the states (loading / generate CTA / existing /
 * no-review-needed). The full mini-course is NOT shown here: an existing path
 * renders a COMPACT card that links to the dedicated study path page
 * (/learning/$studyPathId), which owns the completion + Remove actions.
 * ------------------------------------------------------------------ */

type PanelProps = {
  studyPath: ParsedStudyPath | null;
  isLoading: boolean;
  generating: boolean;
  generateResult: GenerateStudyPathResult | null;
  onGenerate: () => void;
};

export function StudyPathPanel({
  studyPath,
  isLoading,
  generating,
  generateResult,
  onGenerate,
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
                  <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              We&apos;ve identified the areas that need revision based on your quiz performance.
              Study them on your dedicated study path page, then mark it complete and retake the
              quiz.
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

            <div className="mt-4">
              <Button asChild className="transition-transform hover:scale-[1.02] active:scale-95">
                <Link to="/learning/$studyPathId" params={{ studyPathId: studyPath.id }}>
                  {completed
                    ? "Review study path"
                    : justCreated
                      ? "Start learning"
                      : "Continue learning"}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </motion.section>
    );
  }

  // --- Not enough of the quiz answered to be reliable evidence ---------
  if (generateResult?.status === "insufficient-evidence") {
    return (
      <section aria-label="AI Study Path" className={CARD}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-xl">Not enough evidence yet</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              You answered {generateResult.answered} of {generateResult.total} questions. Complete
              more of the quiz so AceTutor can reliably assess this module and build a Study Path.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // --- Answered, but no meaningful weak areas to remediate --------------
  if (generateResult?.status === "not-needed") {
    return (
      <section aria-label="AI Study Path" className={CARD}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-xl">You&apos;re doing great</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Your quiz performance here doesn&apos;t point to any specific areas that need extra
              review right now. Keep working through the course material and take another quiz later
              to reassess.
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
