import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useVarkProfile } from "@/hooks/use-vark-profile";
import {
  derivePrimaryVarkCategory,
  isVarkAssessmentComplete,
  scoresFromProfile,
  varkMlClassificationFromProfile,
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
  // `?from=onboarding` — reached as the optional onboarding step (see
  // onboarding.vark.tsx). Only changes the post-submit call-to-action (return to
  // the dashboard instead of Profile); the assessment itself is identical.
  validateSearch: (search: Record<string, unknown>): { from?: "onboarding" } => ({
    from: search.from === "onboarding" ? "onboarding" : undefined,
  }),
  component: VarkAssessmentPage,
});

/**
 * VARK learning-tendency assessment. Separate route from Learning Preferences
 * (/onboarding/preferences) — this is the OTHER half of the learner profile,
 * linked from Profile and offered as an OPTIONAL onboarding step
 * (/onboarding/vark, reached here with `?from=onboarding`). Never a blocking
 * gate: the onboarding prompt always has "Skip for now", and post-auth-
 * redirect.ts only ever shows it ONCE (until the student completes OR skips —
 * see varkOnboardingStatus in src/lib/vark.ts).
 *
 * Doubles as viewer + editor, same pattern as the preferences page: a student
 * with a completed profile lands on a read-only "your VARK profile" summary
 * with a "Retake assessment" action; a student with none goes straight to the
 * question form. The form shows ONE question at a time (same fixed-position,
 * animated-swap pattern as onboarding.preferences.tsx) — "Next" only requires
 * the CURRENT question to have a selection, which transitively guarantees
 * every question up to wherever the student currently is has one, so by the
 * time "Submit assessment" is reachable the whole set is already complete.
 * Every question allows selecting more than one option — nothing forces an
 * exclusive category — and the result is always shown as a four-way score
 * breakdown, never just a single label. Nothing is saved until that final
 * Submit is pressed.
 */
function VarkAssessmentPage() {
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const fromOnboarding = from === "onboarding";
  const { profile, isLoading, submit, submitting } = useVarkProfile();
  // null = not decided yet (waiting for the profile to load once). Once the
  // first load settles, default to "summary" for a completed profile or
  // "form" for a fresh one — after that, only the student's own clicks
  // (Retake / Cancel) change it, never a background refetch.
  const [view, setView] = useState<"summary" | "form" | null>(null);
  const [responses, setResponses] = useState<VarkResponses>({});
  const [justSubmitted, setJustSubmitted] = useState<VarkScores | null>(null);
  const [step, setStep] = useState(0);
  const questionRef = useRef<HTMLHeadingElement>(null);

  const hasCompletedProfile = !!profile?.assessment_completed_at;
  useEffect(() => {
    if (view !== null || isLoading) return;
    setView(hasCompletedProfile ? "summary" : "form");
  }, [view, isLoading, hasCompletedProfile]);

  // Move focus to the new question on every step change so keyboard/screen
  // reader users get a clear signal the content advanced, without stealing
  // focus on the initial mount of the page itself.
  useEffect(() => {
    if (view !== "form") return;
    questionRef.current?.focus();
  }, [step, view]);

  const total = VARK_QUESTIONS.length;
  const question = VARK_QUESTIONS[step];
  const isFirst = step === 0;
  const isLast = step === total - 1;
  const selectedForStep = responses[question.id] ?? [];
  const canAdvance = selectedForStep.length > 0;
  const complete = isVarkAssessmentComplete(responses);
  const progress = Math.round(((step + 1) / total) * 100);

  const toggle = (questionId: string, dimension: VarkCategory) => {
    setResponses((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(dimension)
        ? current.filter((d) => d !== dimension)
        : [...current, dimension];
      return { ...prev, [questionId]: next };
    });
  };

  const goNext = () => {
    if (!canAdvance) return;
    if (!isLast) setStep((s) => Math.min(total - 1, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const startRetake = () => {
    setResponses({});
    setJustSubmitted(null);
    setStep(0);
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
  const mlClassification = varkMlClassificationFromProfile(profile);

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

          {/* ML classification — a SEPARATE signal from the questionnaire
              tendency above, from the actual trained scikit-learn model
              (ml/vark/). Never promoted to "the" tendency and never a fake
              result: "unavailable" when inference hasn't run or last failed,
              rather than guessing. See src/lib/vark-inference.functions.ts. */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="flex items-center gap-2 text-sm font-medium">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              ML classification
            </p>
            {mlClassification.available && mlClassification.category ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent-foreground">
                    {VARK_CATEGORY_LABEL[mlClassification.category]}
                  </span>
                  {mlClassification.confidencePercent !== null && (
                    <span className="text-xs text-muted-foreground">
                      {mlClassification.confidencePercent}% confidence
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Model: Gradient Boosting
                  {mlClassification.modelVersion ? ` · ${mlClassification.modelVersion}` : ""}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  This is a prototype ML classification based on your VARK assessment scores. The
                  current model was trained on synthetic development data and should not be treated
                  as a definitive learning-style label.
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">ML classification unavailable</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {fromOnboarding ? (
              <>
                <Button className="rounded-full" onClick={() => navigate({ to: "/" })}>
                  Continue to dashboard <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
                <Button onClick={startRetake} variant="outline" className="rounded-full">
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Retake assessment
                </Button>
              </>
            ) : (
              <>
                <Button onClick={startRetake} variant="outline" className="rounded-full">
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Retake assessment
                </Button>
                <Button asChild className="rounded-full">
                  <Link to="/profile">Back to profile</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {view === "form" && (
        <>
          {/* Progress */}
          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Question {step + 1} of {total}
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

          {/* Question card — fixed position, only its content swaps. Multi-select:
              every option is an independent toggle, so more than one can stay
              selected at once. */}
          <div className="relative mt-6 min-h-[24rem]">
            <AnimatePresence mode="wait">
              <motion.section
                key={question.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="rounded-2xl border border-border bg-card p-6"
                aria-live="polite"
              >
                <h2 ref={questionRef} tabIndex={-1} className="font-display text-xl outline-none">
                  {question.prompt}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pick every option that genuinely applies — more than one is fine.
                </p>
                <div className="mt-4 grid gap-3">
                  {question.options.map((opt) => {
                    const isSelected = selectedForStep.includes(opt.dimension);
                    return (
                      <button
                        key={opt.dimension}
                        type="button"
                        onClick={() => toggle(question.id, opt.dimension)}
                        aria-pressed={isSelected}
                        disabled={submitting}
                        className={`group flex items-start gap-3 rounded-xl border p-4 text-left text-sm transition-colors disabled:opacity-60 ${
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
              </motion.section>
            </AnimatePresence>
          </div>

          {/* Controls */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!isFirst && (
              <Button variant="ghost" onClick={goBack} disabled={submitting}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
            )}
            {isLast ? (
              <Button onClick={onSubmit} disabled={!canAdvance || !complete || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Submit assessment"
                )}
              </Button>
            ) : (
              <Button onClick={goNext} disabled={!canAdvance || submitting}>
                Next <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
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
          </div>
          {!canAdvance && (
            <p className="mt-3 text-xs text-muted-foreground">
              Select at least one option to continue.
            </p>
          )}
        </>
      )}
    </main>
  );
}
