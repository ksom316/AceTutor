import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { CheckCircle2, Loader2, RotateCcw, Sparkles, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/result/$attemptId")({
  component: ResultPage,
});

const EASE = [0.22, 1, 0.36, 1] as const;

type AttemptDetail = {
  id: string;
  score: number | null;
  total: number | null;
  topic_id: string;
  topics: { title: string } | null;
};
type AnswerRow = {
  question_id: string;
  selected_index: number;
  is_correct: boolean;
  questions: {
    prompt: string;
    choices: string[];
    correct_index: number;
    explanation: string | null;
  };
};

/** Count-up percentage shown in the score hero. */
function ScoreCounter({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => `${Math.round(v)}%`);
  const [display, setDisplay] = useState("0%");
  useEffect(() => {
    const unsub = rounded.on("change", setDisplay);
    const controls = animate(mv, value, { duration: 1.2, ease: EASE, delay: 0.2 });
    return () => {
      unsub();
      controls.stop();
    };
  }, [value, mv, rounded]);
  return <span>{display}</span>;
}

function ResultPage() {
  const { attemptId } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["result", attemptId],
    queryFn: async () => {
      const { data: attempt } = await supabase
        .from("quiz_attempts")
        .select("id, score, total, topic_id, topics(title)")
        .eq("id", attemptId)
        .maybeSingle();
      const { data: answers } = await supabase
        .from("attempt_answers")
        .select(
          "question_id, selected_index, is_correct, questions(prompt, choices, correct_index, explanation)",
        )
        .eq("attempt_id", attemptId);
      return {
        attempt: (attempt ?? null) as unknown as AttemptDetail | null,
        answers: (answers ?? []) as unknown as AnswerRow[],
      };
    },
  });

  if (isLoading || !data?.attempt) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your results…</p>
      </main>
    );
  }

  const pct = data.attempt.total
    ? Math.round(((data.attempt.score ?? 0) / data.attempt.total) * 100)
    : 0;
  const passed = pct >= 70;
  const headline =
    pct >= 90
      ? "Outstanding!"
      : pct >= 70
        ? "Great work!"
        : pct >= 50
          ? "Good effort!"
          : "Keep practicing!";

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-xs uppercase tracking-widest text-muted-foreground"
      >
        Results
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE, delay: 0.05 }}
        className="mt-2 font-display text-4xl"
      >
        {data.attempt.topics?.title}
      </motion.h1>

      {/* Score hero */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EASE, delay: 0.1 }}
        className="relative mt-6 overflow-hidden rounded-2xl border border-border bg-card p-8 text-center"
      >
        {/* glow */}
        <div
          aria-hidden
          className={`pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl ${
            passed ? "bg-success/20" : "bg-primary/20"
          }`}
        />
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.3 }}
          className={`relative mx-auto grid h-14 w-14 place-items-center rounded-2xl ${
            passed ? "bg-success/15 text-success" : "bg-primary/15 text-primary"
          }`}
        >
          {passed ? <Trophy className="h-7 w-7" /> : <Sparkles className="h-7 w-7" />}
        </motion.div>
        <p className="relative mt-4 font-display text-2xl">{headline}</p>
        <p className="relative mt-4 font-display text-7xl text-primary">
          <ScoreCounter value={pct} />
        </p>
        <p className="relative mt-1 text-muted-foreground">
          {data.attempt.score} of {data.attempt.total} correct
        </p>
      </motion.div>

      {/* Answer breakdown */}
      <ol className="mt-10 space-y-6">
        {data.answers.map((a, idx) => {
          const correctIdx = a.questions.correct_index;
          return (
            <motion.li
              key={a.question_id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, ease: EASE, delay: Math.min(idx * 0.05, 0.3) }}
              className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-base">{a.questions.prompt}</p>
                {a.is_correct ? (
                  <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-1 h-5 w-5 shrink-0 text-destructive" />
                )}
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                {(a.questions.choices as string[]).map((c, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-2.5 transition-colors ${
                      i === correctIdx
                        ? "border-success/60 bg-success/10"
                        : i === a.selected_index
                          ? "border-destructive/50 bg-destructive/10"
                          : "border-border"
                    }`}
                  >
                    {c}
                  </div>
                ))}
              </div>
              {a.questions.explanation && (
                <p className="mt-4 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Why:</span>{" "}
                  {a.questions.explanation}
                </p>
              )}
            </motion.li>
          );
        })}
      </ol>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45 }}
        className="mt-10 flex gap-3"
      >
        <Button asChild className="transition-transform hover:scale-[1.02] active:scale-95">
          <Link to="/quiz/$topicId" params={{ topicId: data.attempt.topic_id }}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Retry
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </motion.div>
    </main>
  );
}
