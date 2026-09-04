import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useVarkProfile } from "@/hooks/use-vark-profile";
import {
  derivePrimaryVarkCategory,
  isVarkAssessmentComplete,
  scoresFromProfile,
  VARK_CATEGORIES,
  VARK_CATEGORY_DESCRIPTION,
  VARK_CATEGORY_LABEL,
  VARK_QUESTIONS,
  varkScorePercentages,
  type VarkCategory,
  type VarkResponses,
  type VarkScores,
} from "@/lib/vark";

const EASE = [0.22, 1, 0.36, 1] as const;

export const Route = createFileRoute("/_authenticated/vark-assessment")({
  component: VarkAssessmentPage,
});

/**
 * VARK learning-tendency assessment. Separate route from Learning Preferences
 * (/onboarding/preferences) — this is the OTHER half of the learner profile,
 * linked from Profile — but styled consistently and never a blocking gate:
 * there is no onboarding requirement here, and post-auth-redirect.ts is
 * untouched (it still gates only on learning_preferences row-existence).
 *
 * Doubles as viewer + editor, same pattern as the preferences page: a student
 * with a completed profile lands on a read-only "your VARK profile" summary
 * with a "Retake assessment" action; a student with none goes straight to the
 * question form. Every question allows selecting more than one option — nothing
 * forces an exclusive category — and the result is always shown as a
 * four-way score breakdown, never just a single label.
 */
function VarkAssessmentPage() {
  const { profile, isLoading, submit, submitting } = useVarkProfile();
  // null = not decided yet (waiting for the profile to load once). Once the
  // first load settles, default to "summary" for a completed profile or
  // "form" for a fresh one — after that, only the student's own clicks
  // (Retake / Cancel) change it, never a background refetch.
  const [view, setView] = useState<"summary" | "form" | null>(null);
  const [responses, setResponses] = useState<VarkResponses>({});
  const [justSubmitted, setJustSubmitted] = useState<VarkScores | null>(null);

  const hasCompletedProfile = !!profile?.assessment_completed_at;
  useEffect(() => {
    if (view !== null || isLoading) return;
    setView(hasCompletedProfile ? "summary" : "form");
  }, [view, isLoading, hasCompletedProfile]);

  const answeredCount = useMemo(
    () => VARK_QUESTIONS.filter((q) => (responses[q.id]?.length ?? 0) > 0).length,
    [responses],
  );
  const complete = isVarkAssessmentComplete(responses);
  const progress = Math.round((answeredCount / VARK_QUESTIONS.length) * 100);

  const toggle = (questionId: string, dimension: VarkCategory) => {
    setResponses((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(dimension)
        ? current.filter((d) => d !== dimension)
        : [...current, dimension];
      return { ...prev, [questionId]: next };
    });
  };

  const startRetake = () => {
    setResponses({});
    setJustSubmitted(null);
    setView("form");
  };

  const onSubmit = async () => {
    if (!complete || submitting) return;
    try {
      const { scores } = await submit(responses);
      setJustSubmitted(scores);
      setView("summary");
      toast.success("VARK profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your assessment");
    }
  };

  const summaryScores = justSubmitted ?? (profile ? scoresFromProfile(profile) : null);
  const primary = summaryScores ? derivePrimaryVarkCategory(summaryScores) : null;
  const pct = summaryScores ? varkScorePercentages(summaryScores) : null;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <Link
        to="/profile"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Profile
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="mt-3"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Learner profile</p>
        <h1 className="mt-2 font-display text-3xl md:text-4xl">VARK learning tendency</h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          A short, practical check-in on how new ideas tend to click fastest for you — not a fixed
          learning type. Pick every option that genuinely applies; most people are a mix. This is
          separate from your Learning Preferences, which are about how you&apos;d like things
          presented.
        </p>
      </motion.div>

      {view === null && <p className="mt-10 text-sm text-muted-foreground">Loading…</p>}

      {view === "summary" && summaryScores && primary && pct && (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Current tendency{primary.tied ? " (close mix)" : ""}
            </p>
            <p className="mt-2 font-display text-2xl">
              {primary.category ? VARK_CATEGORY_LABEL[primary.category] : "Not enough signal yet"}
            </p>
            {primary.category && (
              <p className="mt-1 text-sm text-muted-foreground">
                {VARK_CATEGORY_DESCRIPTION[primary.category]}
              </p>
            )}
            {profile?.assessment_completed_at && !justSubmitted && (
              <p className="mt-3 text-xs text-muted-foreground">
                Completed {new Date(profile.assessment_completed_at).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="text-sm font-medium">Your V/A/R/K breakdown</p>
            <div className="mt-4 space-y-3">
              {VARK_CATEGORIES.map((c) => (
                <div key={c}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{VARK_CATEGORY_LABEL[c]}</span>
                    <span className="text-muted-foreground">{pct[c]}%</span>
                  </div>
                  <Progress value={pct[c]} className="mt-1 h-2" />
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              This reflects a mix, not a single box — most students score across more than one
              category, and that&apos;s expected.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={startRetake} variant="outline" className="rounded-full">
              <RotateCcw className="mr-1.5 h-4 w-4" /> Retake assessment
            </Button>
            <Button asChild className="rounded-full">
              <Link to="/profile">Back to profile</Link>
            </Button>
          </div>
        </div>
      )}

      {view === "form" && (
        <>
          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {answeredCount} of {VARK_QUESTIONS.length} answered
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-accent"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3, ease: EASE }}
              />
            </div>
          </div>

          <ol className="mt-6 space-y-5">
            {VARK_QUESTIONS.map((q, idx) => (
              <li key={q.id} className="rounded-2xl border border-border bg-card p-5">
                <p className="text-xs text-muted-foreground">Question {idx + 1}</p>
                <p className="mt-1 text-base font-medium">{q.prompt}</p>
                <div className="mt-3 grid gap-2">
                  {q.options.map((opt) => {
                    const isSelected = responses[q.id]?.includes(opt.dimension) ?? false;
                    return (
                      <button
                        key={opt.dimension}
                        type="button"
                        onClick={() => toggle(q.id, opt.dimension)}
                        aria-pressed={isSelected}
                        disabled={submitting}
                        className={`group flex items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors disabled:opacity-60 ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-accent/60 hover:bg-accent/5"
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-transparent group-hover:border-accent"
                          }`}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="min-w-0">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={onSubmit} disabled={!complete || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save my VARK profile"
              )}
            </Button>
            {hasCompletedProfile && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setView("summary")}
                disabled={submitting}
              >
                Cancel
              </Button>
            )}
            {!complete && (
              <p className="text-xs text-muted-foreground">
                Select at least one option for every question to save.
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
