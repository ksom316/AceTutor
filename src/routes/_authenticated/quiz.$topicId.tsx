import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import logoAsset from "@/assets/ace-logo.jpg";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Q = { id: string; prompt: string; choices: string[]; difficulty: number };

export const Route = createFileRoute("/_authenticated/quiz/$topicId")({
  component: QuizRunner,
});

const EASE = [0.22, 1, 0.36, 1] as const;

function QuizRunner() {
  const { topicId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: topic } = await supabase.from("topics").select("title").eq("id", topicId).maybeSingle();
      if (!active) return;
      setTopicTitle(topic?.title ?? "");

      const { data: qs, error } = await supabase.rpc("get_quiz_questions", { _topic_id: topicId, _limit: 5 });
      if (!active) return;
      if (error) {
        toast.error("Could not load questions");
        setLoading(false);
        return;
      }
      setQuestions((qs ?? []) as Q[]);

      const { data: attempt, error: aErr } = await supabase
        .from("quiz_attempts")
        .insert({ user_id: user.id, topic_id: topicId })
        .select("id")
        .single();
      if (!active) return;
      if (aErr) toast.error(aErr.message);
      else if (attempt) setAttemptId(attempt.id);
      else toast.error("Could not start this quiz. Please try again.");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, topicId]);

  const submit = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("grade_quiz", { _attempt_id: attemptId, _answers: answers });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/result/$attemptId", params: { attemptId } });
  };

  const total = questions.length;
  const q = questions[current];
  const isLast = current === total - 1;
  const selected = q ? answers[q.id] : undefined;
  const hasAnswer = selected !== undefined;

  const handleNext = () => {
    if (!hasAnswer) return;
    if (isLast) {
      submit();
    } else {
      setDirection(1);
      setCurrent((c) => c + 1);
    }
  };

  const handlePrev = () => {
    if (current === 0) return;
    setDirection(-1);
    setCurrent((c) => c - 1);
  };

  const handleClose = () => navigate({ to: "/dashboard" });

  const Brand = (
    <div className="flex items-center gap-2">
      <img src={logoAsset} alt="AceTutor" width={28} height={28} className="rounded-md object-contain" />
      <span className="font-display text-lg font-semibold">{topicTitle || "Quiz"}</span>
    </div>
  );

  // Loading state
  if (loading) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Preparing your quiz…</p>
      </main>
    );
  }

  // Empty state — topic has no questions
  if (!q) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="max-w-md rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center"
        >
          <img src={logoAsset} alt="AceTutor" width={48} height={48} className="mx-auto rounded-xl object-contain" />
          <h1 className="mt-4 font-display text-2xl">No questions yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This topic doesn't have any quiz questions published yet. Check back soon or try another module.
          </p>
          <Button onClick={handleClose} className="mt-6 rounded-full">
            Back to dashboard
          </Button>
        </motion.div>
      </main>
    );
  }

  const progressValue = ((current + (hasAnswer ? 1 : 0)) / total) * 100;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          {Brand}
          <button
            onClick={handleClose}
            aria-label="Close quiz"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <Progress value={progressValue} className="h-1 rounded-none bg-muted" />
      </div>

      {/* Body */}
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-12 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-3"
        >
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Question</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {current + 1}
          </span>
          <span className="text-sm text-muted-foreground">of {total}</span>
        </motion.div>

        <div className="w-full overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={q.id}
              custom={direction}
              initial={{ opacity: 0, x: direction * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -60 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="w-full"
            >
              <h1 className="mt-10 text-center font-display text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
                {q.prompt}
              </h1>

              <motion.div
                className="mx-auto mt-12 grid w-full max-w-2xl gap-4 sm:grid-cols-2"
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
              >
                {q.choices.map((c, ci) => {
                  const isSelected = selected === ci;
                  return (
                    <motion.button
                      key={ci}
                      variants={{
                        hidden: { opacity: 0, y: 16 },
                        show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
                      }}
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setAnswers({ ...answers, [q.id]: ci })}
                      className={`group flex min-h-[88px] items-center justify-center rounded-2xl border-2 px-6 py-5 text-center text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        isSelected
                          ? "border-primary bg-primary/10 text-foreground shadow-md"
                          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/40"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground group-hover:border-primary/40"
                          }`}
                        >
                          {String.fromCharCode(65 + ci)}
                        </span>
                        <span>{c}</span>
                      </span>
                    </motion.button>
                  );
                })}
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-14 flex w-full max-w-xs flex-col items-center gap-3">
          <Button
            size="lg"
            onClick={handleNext}
            disabled={!hasAnswer || submitting}
            className="h-12 w-full rounded-full text-base font-semibold transition-transform hover:scale-[1.02] active:scale-95"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Grading…
              </>
            ) : isLast ? (
              "Finish Quiz"
            ) : (
              "Next Question"
            )}
          </Button>
          {current > 0 && !submitting && (
            <button
              onClick={handlePrev}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Previous question
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
