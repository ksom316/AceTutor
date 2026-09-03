import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const EASE = [0.22, 1, 0.36, 1] as const;

export const Route = createFileRoute("/_authenticated/onboarding/preferences")({
  component: PreferencesOnboarding,
});

/**
 * Learning Preferences — how a student would like AceTutor to present what they
 * learn. This is NOT a learning-style test: the whole flow is optional (a "Skip
 * for now" is always available), nothing is a fixed category, and a saved
 * preference never restricts access to any lesson format or course content.
 *
 * The three questions are shown ONE AT A TIME in a fixed-position card; "Next"
 * is disabled until the current question is answered. The completed set is
 * persisted with a single atomic upsert to `learning_preferences` (one row per
 * user) — never one write per question. Opened from Profile / Settings it
 * pre-fills the saved answers and acts as the editor for the same row.
 */

type Field = "explanation_style" | "lesson_format" | "wrong_answer_help";

type Option = { value: string; label: string; description: string };

const SECTIONS: {
  field: Field;
  question: string;
  options: Option[];
}[] = [
  {
    field: "explanation_style",
    question: "How would you like explanations to be presented?",
    options: [
      {
        value: "concise",
        label: "Concise",
        description: "Give me the key idea without too much detail.",
      },
      {
        value: "detailed",
        label: "Detailed",
        description: "Explain the concept thoroughly.",
      },
      {
        value: "step_by_step",
        label: "Step-by-step",
        description: "Walk me through it in a clear sequence.",
      },
      {
        value: "example_first",
        label: "Example-first",
        description: "Show me an example before explaining the theory.",
      },
    ],
  },
  {
    field: "lesson_format",
    question: "What type of learning material do you prefer?",
    options: [
      {
        value: "written",
        label: "Written",
        description: "Read explanations and notes.",
      },
      {
        value: "visual",
        label: "Visual",
        description: "Learn through visual and video-based material.",
      },
      {
        value: "audio",
        label: "Audio",
        description: "Learn through audio explanations.",
      },
    ],
  },
  {
    field: "wrong_answer_help",
    question: "When you get something wrong, what helps you most?",
    options: [
      {
        value: "simple",
        label: "Simple explanation",
        description: "Quickly explain what I misunderstood.",
      },
      {
        value: "detailed",
        label: "Detailed explanation",
        description: "Break down the concept thoroughly.",
      },
      {
        value: "example",
        label: "Example",
        description: "Help me understand through a worked example.",
      },
      {
        value: "similar_practice",
        label: "Similar practice question",
        description: "Give me a similar question to try.",
      },
    ],
  },
];

const TOTAL = SECTIONS.length;

type Answers = Partial<Record<Field, string>>;

function PreferencesOnboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  // Seed the form from saved preferences exactly once, so a background refetch
  // never clobbers answers the student is mid-way through changing.
  const seeded = useRef(false);

  // Pre-fill from any saved preferences so this screen doubles as the editor.
  const { data: existing } = useQuery({
    queryKey: ["learning-preferences", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_preferences")
        .select("explanation_style, lesson_format, wrong_answer_help")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!existing || seeded.current) return;
    seeded.current = true;
    setAnswers({
      ...(existing.explanation_style ? { explanation_style: existing.explanation_style } : {}),
      ...(existing.lesson_format ? { lesson_format: existing.lesson_format } : {}),
      ...(existing.wrong_answer_help ? { wrong_answer_help: existing.wrong_answer_help } : {}),
    });
  }, [existing]);

  const section = SECTIONS[step];
  const selected = answers[section.field];
  const isLast = step === TOTAL - 1;
  const progress = useMemo(() => ((step + 1) / TOTAL) * 100, [step]);

  const choose = (value: string) => {
    setAnswers((prev) => ({ ...prev, [section.field]: value }));
  };

  const goNext = () => {
    if (!selected) return;
    if (!isLast) setStep((s) => s + 1);
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const save = async () => {
    if (!user || !selected) return;
    setSaving(true);
    // One atomic upsert — current state, keyed by user_id. Only the values the
    // student actually chose are written; the rest stay null.
    const { error } = await supabase.from("learning_preferences").upsert(
      {
        user_id: user.id,
        explanation_style: answers.explanation_style ?? null,
        lesson_format: answers.lesson_format ?? null,
        wrong_answer_help: answers.wrong_answer_help ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["learning-preferences"] });
    await queryClient.invalidateQueries({ queryKey: ["topic-learning-prefs"] });
    await queryClient.invalidateQueries({ queryKey: ["study-path-prefs-freshness"] });
    toast.success("Preferences updated", {
      description:
        "Your new preferences apply to future Study Paths and new AI explanations. Existing Study Paths are unchanged.",
    });
    navigate({ to: "/" });
  };

  const skipForNow = async () => {
    if (!user || saving) {
      navigate({ to: "/" });
      return;
    }
    setSaving(true);
    // Persist an all-null row so this counts as "onboarding handled" — the
    // student won't be sent back here on every login. Preference fields stay
    // null (they made no choices), so the "personalize your learning" nudge
    // still shows everywhere. On conflict this only bumps updated_at.
    const { error } = await supabase.from("learning_preferences").upsert(
      { user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    setSaving(false);
    if (error) {
      // Persistence failed — don't pretend the skip stuck. Let them continue to
      // Home anyway; onboarding may reappear next login until it succeeds.
      toast.error(error.message);
    } else {
      await queryClient.invalidateQueries({ queryKey: ["learning-preferences"] });
    }
    navigate({ to: "/" });
  };

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Learning preferences
        </p>
        <h1 className="mt-3 font-display text-3xl md:text-4xl">
          Choose how you&apos;d like AceTutor to help you
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          These are preferences, not a fixed learning type. It only takes a moment, it&apos;s
          optional, and you can change your answers anytime.
        </p>
      </motion.div>

      {/* Progress */}
      <div className="mt-8">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Question {step + 1} of {TOTAL}
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-accent"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: EASE }}
          />
        </div>
      </div>

      {/* Question card — stays in the same position; only its content changes. */}
      <div className="relative mt-6 min-h-[22rem]">
        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="rounded-2xl border border-border bg-card p-6"
            aria-live="polite"
          >
            <h2 className="font-display text-xl">{section.question}</h2>
            <div className="mt-4 grid gap-3">
              {section.options.map((opt) => {
                const isSelected = selected === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => choose(opt.value)}
                    aria-pressed={isSelected}
                    disabled={saving}
                    className={`group flex items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-accent/60 hover:bg-accent/5"
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-transparent group-hover:border-accent"
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.section>
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {step > 0 && (
          <Button variant="ghost" onClick={goBack} disabled={saving}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
        )}
        {isLast ? (
          <Button onClick={save} disabled={saving || !selected}>
            {saving ? "Saving…" : "Finish & save preferences"}
          </Button>
        ) : (
          <Button onClick={goNext} disabled={!selected}>
            Next <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={skipForNow}
          disabled={saving}
        >
          Skip for now
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        You can update these preferences anytime from Settings or your profile.
      </p>
    </main>
  );
}
