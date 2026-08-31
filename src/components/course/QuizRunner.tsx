import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type RunnerQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  difficulty: number;
};

/**
 * Presentational quiz runner — shared by the module quiz (`/quiz/$topicId`) and
 * a General Course Assessment (`/course-quiz/$quizId`). Each route owns its own
 * data loading, `quiz_attempts` insert and `grade_quiz` call, and passes the
 * questions + an `onSubmit(answers)` handler in.
 */
export function QuizRunner({
  eyebrow,
  title,
  subtitle,
  loading,
  submitting,
  attemptReady,
  questions,
  onSubmit,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  loading: boolean;
  submitting: boolean;
  attemptReady: boolean;
  questions: RunnerQuestion[];
  onSubmit: (answers: Record<string, number>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const submit = () => {
    if (Object.keys(answers).length < questions.length) {
      toast.error("Answer every question before submitting");
      return;
    }
    onSubmit(answers);
  };

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-2 font-display text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {subtitle ?? "Answer all questions, then submit for instant feedback."}
      </p>

      {loading && <p className="mt-10 text-sm text-muted-foreground">Loading questions…</p>}

      <ol className="mt-10 space-y-8">
        {questions.map((q, idx) => (
          <li key={q.id} className="rounded-2xl border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Question {idx + 1}
            </p>
            <p className="mt-2 text-lg">{q.prompt}</p>
            <div className="mt-4 grid gap-2">
              {q.choices.map((c, ci) => (
                <label
                  key={ci}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    answers[q.id] === ci
                      ? "border-accent bg-accent/10"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === ci}
                    onChange={() => setAnswers({ ...answers, [q.id]: ci })}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">{c}</span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <Button onClick={submit} disabled={submitting || !attemptReady} size="lg" className="mt-10">
        {submitting ? "Grading…" : "Submit answers"}
      </Button>
    </main>
  );
}
