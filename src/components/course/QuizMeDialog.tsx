import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  generatePracticeQuiz,
  gradePracticeQuiz,
  practiceErrorMessage,
  type PracticeGradeResult,
  type PracticeQuestion,
} from "@/lib/practice-quiz.functions";

type Difficulty = "easy" | "medium" | "hard";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const COUNTS = [5, 10, 15, 20, 25, 30];

type ActiveQuiz = {
  questions: PracticeQuestion[];
  quizToken: string;
  topicId: string;
  topicTitle: string;
  difficulty: Difficulty;
  officialQuizExists: boolean;
  answers: (number | null)[];
  current: number;
};

type Phase = "setup" | "generating" | "quiz" | "grading" | "results" | "error";

/**
 * Quiz Me — AI-generated formative PRACTICE. Never touches official quiz
 * attempts, Mastery, or course progress. State lives in this dialog (plus a
 * sessionStorage snapshot of an in-progress quiz so a refresh doesn't lose it).
 */
export function QuizMeDialog({
  open,
  onOpenChange,
  courseId,
  topics,
  focusedTopicId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  topics: { id: string; title: string }[];
  focusedTopicId?: string;
}) {
  const gen = useServerFn(generatePracticeQuiz);
  const grade = useServerFn(gradePracticeQuiz);
  const storageKey = `acetutor:practice:${courseId}`;

  const [phase, setPhase] = useState<Phase>("setup");
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  const defaultTopic = useMemo(() => {
    if (focusedTopicId && topics.some((t) => t.id === focusedTopicId)) return focusedTopicId;
    return topics[0]?.id ?? "";
  }, [focusedTopicId, topics]);

  const [topicId, setTopicId] = useState(defaultTopic);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [count, setCount] = useState(10);

  const [quiz, setQuiz] = useState<ActiveQuiz | null>(null);
  const [result, setResult] = useState<PracticeGradeResult | null>(null);

  // Restore an in-progress quiz on open (survives an accidental refresh).
  // Anything else — a completed/graded quiz, an error, a half-configured setup —
  // must NOT carry over: every fresh open lands on the clean setup screen.
  useEffect(() => {
    if (!open) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as ActiveQuiz;
        if (saved?.questions?.length && saved.quizToken) {
          setQuiz(saved);
          setResult(null);
          setErrorMsg("");
          setPhase("quiz");
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setQuiz(null);
    setResult(null);
    setErrorMsg("");
    setPhase("setup");
    setTopicId(defaultTopic);
  }, [open, storageKey, defaultTopic]);

  // Persist the active quiz while it's being taken.
  useEffect(() => {
    try {
      if (phase === "quiz" && quiz) sessionStorage.setItem(storageKey, JSON.stringify(quiz));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [phase, quiz, storageKey]);

  const genMutation = useMutation({
    mutationFn: async () => gen({ data: { courseId, topicId, difficulty, count } }),
    onMutate: () => {
      setPhase("generating");
      setErrorMsg("");
    },
    onSuccess: (res) => {
      setQuiz({
        questions: res.questions,
        quizToken: res.quizToken,
        topicId: res.topicId,
        topicTitle: res.topicTitle,
        difficulty: res.difficulty,
        officialQuizExists: res.officialQuizExists,
        answers: Array(res.questions.length).fill(null),
        current: 0,
      });
      setResult(null);
      setPhase("quiz");
    },
    onError: (e) => {
      setErrorMsg(practiceErrorMessage(e));
      setPhase("error");
    },
  });

  const gradeMutation = useMutation({
    mutationFn: async () => {
      if (!quiz) throw new Error("PRACTICE_TOKEN_INVALID");
      return grade({ data: { quizToken: quiz.quizToken, answers: quiz.answers } });
    },
    onMutate: () => setPhase("grading"),
    onSuccess: (res) => {
      setResult(res);
      setPhase("results");
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },
    onError: (e) => {
      setErrorMsg(practiceErrorMessage(e));
      setPhase("error");
    },
  });

  const reset = useCallback(() => {
    setQuiz(null);
    setResult(null);
    setErrorMsg("");
    setPhase("setup");
    setTopicId(defaultTopic);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [defaultTopic, storageKey]);

  const requestClose = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (phase === "quiz") {
      setConfirmLeave(true);
      return;
    }
    // Any other exit (Close / Return to Tutor / error screen / after results):
    // wipe the whole practice session so the next open starts fresh.
    onOpenChange(false);
    reset();
  };

  const setAnswer = (choiceIdx: number) => {
    setQuiz((q) =>
      q ? { ...q, answers: q.answers.map((a, i) => (i === q.current ? choiceIdx : a)) } : q,
    );
  };
  const go = (delta: number) =>
    setQuiz((q) =>
      q ? { ...q, current: Math.min(q.questions.length - 1, Math.max(0, q.current + delta)) } : q,
    );

  const topicTitleFor = (id: string) => topics.find((t) => t.id === id)?.title ?? "this module";

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-h-[88vh] w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-2xl">
          {/* -------- SETUP -------- */}
          {(phase === "setup" || phase === "generating" || phase === "error") && (
            <>
              <DialogHeader>
                <DialogTitle>Quiz Me · practice quiz</DialogTitle>
                <DialogDescription>
                  AI-generated practice for {topicTitleFor(topicId)}. This is not an official quiz —
                  it doesn&apos;t affect your Mastery Score or module completion.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="qm-topic">Module</Label>
                  <Select value={topicId} onValueChange={setTopicId}>
                    <SelectTrigger id="qm-topic">
                      <SelectValue placeholder="Choose a module" />
                    </SelectTrigger>
                    <SelectContent>
                      {topics.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Difficulty</Label>
                  <div className="flex flex-wrap gap-2">
                    {DIFFICULTIES.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={difficulty === d ? "default" : "outline"}
                        className="rounded-full capitalize"
                        onClick={() => setDifficulty(d)}
                      >
                        {d}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Number of questions</Label>
                  <div className="flex flex-wrap gap-2">
                    {COUNTS.map((c) => (
                      <Button
                        key={c}
                        type="button"
                        size="sm"
                        variant={count === c ? "default" : "outline"}
                        className="rounded-full tabular-nums"
                        onClick={() => setCount(c)}
                      >
                        {c}
                      </Button>
                    ))}
                  </div>
                </div>

                {phase === "error" && (
                  <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {errorMsg}
                  </p>
                )}

                <Button
                  type="button"
                  className="w-full"
                  disabled={!topicId || phase === "generating"}
                  onClick={() => genMutation.mutate()}
                >
                  {phase === "generating" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating your practice
                      quiz…
                    </>
                  ) : phase === "error" ? (
                    "Try again"
                  ) : (
                    "Start Quiz"
                  )}
                </Button>
              </div>
            </>
          )}

          {/* -------- QUIZ -------- */}
          {phase === "quiz" && quiz && (
            <QuizBody
              quiz={quiz}
              onSelect={setAnswer}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              onFinish={() => gradeMutation.mutate()}
            />
          )}

          {phase === "grading" && (
            <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" /> Marking your practice quiz…
            </div>
          )}

          {/* -------- RESULTS -------- */}
          {phase === "results" && quiz && result && (
            <ResultsBody
              quiz={quiz}
              result={result}
              onPracticeAgain={reset}
              onClose={() => requestClose(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this practice quiz?</AlertDialogTitle>
            <AlertDialogDescription>
              Your answers so far will be discarded. This is practice only — nothing is recorded
              either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmLeave(false);
                reset();
                onOpenChange(false);
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function QuizBody({
  quiz,
  onSelect,
  onPrev,
  onNext,
  onFinish,
}: {
  quiz: ActiveQuiz;
  onSelect: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  const q = quiz.questions[quiz.current];
  const total = quiz.questions.length;
  const isLast = quiz.current === total - 1;
  const answered = quiz.answers.filter((a) => a !== null).length;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span>
            Question {quiz.current + 1} of {total}
          </span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal capitalize text-muted-foreground">
            {quiz.difficulty} practice
          </span>
        </DialogTitle>
        <DialogDescription>
          {quiz.topicTitle} · {answered}/{total} answered. You can change any answer before
          finishing.
        </DialogDescription>
      </DialogHeader>

      <Progress value={((quiz.current + 1) / total) * 100} className="h-1.5" />

      <div className="space-y-4">
        <p className="text-base font-medium">{q.prompt}</p>
        <div role="radiogroup" aria-label="Answer choices" className="grid gap-2">
          {q.choices.map((choice, i) => {
            const selected = quiz.answers[quiz.current] === i;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(i)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-secondary/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 break-words">{choice}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={quiz.current === 0}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Previous
        </Button>
        {isLast ? (
          <Button type="button" size="sm" className="ml-auto" onClick={onFinish}>
            <Check className="mr-1.5 h-4 w-4" /> Finish Quiz
          </Button>
        ) : (
          <Button type="button" size="sm" className="ml-auto" onClick={onNext}>
            Next <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        )}
      </div>
    </>
  );
}

function ResultsBody({
  quiz,
  result,
  onPracticeAgain,
  onClose,
}: {
  quiz: ActiveQuiz;
  result: PracticeGradeResult;
  onPracticeAgain: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary">
            Practice Quiz Result
          </span>
        </DialogTitle>
        <DialogDescription>
          {quiz.topicTitle} · practice only — your official Mastery Score is unchanged.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-2xl border border-border bg-card p-5 text-center">
        <p className="font-display text-4xl">
          {result.correct}/{result.total}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.pct}% · {result.correct} correct · {result.incorrect} to review
        </p>
        <Progress value={result.pct} className="mt-3" />
      </div>

      {(result.strongConcepts.length > 0 || result.weakConcepts.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-success">
              Strong concepts
            </p>
            <p className="mt-1 text-sm">
              {result.strongConcepts.length ? result.strongConcepts.join(", ") : "None yet"}
            </p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Concepts to review
            </p>
            <p className="mt-1 text-sm">
              {result.weakConcepts.length ? result.weakConcepts.join(", ") : "Nothing flagged"}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-sm font-medium">Question review</p>
        {result.review.map((r) => {
          const question = quiz.questions[r.index];
          return (
            <div
              key={r.index}
              className={cn(
                "rounded-xl border p-3 text-sm",
                r.isCorrect
                  ? "border-success/30 bg-success/5"
                  : "border-destructive/30 bg-destructive/5",
              )}
            >
              <p className="flex items-start gap-2 font-medium">
                {r.isCorrect ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                )}
                <span className="min-w-0 break-words">
                  {r.index + 1}. {question.prompt}
                </span>
              </p>
              <p className="mt-1.5 break-words text-muted-foreground">
                Your answer:{" "}
                {r.chosenIndex === null ? (
                  <span className="italic">not answered</span>
                ) : (
                  <span className={r.isCorrect ? "text-success" : "text-destructive"}>
                    {question.choices[r.chosenIndex]}
                  </span>
                )}
              </p>
              {!r.isCorrect && (
                <p className="mt-0.5 break-words text-muted-foreground">
                  Correct answer:{" "}
                  <span className="text-success">{question.choices[r.correctIndex]}</span>
                </p>
              )}
              {r.explanation && (
                <p className="mt-1.5 break-words rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                  {r.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onPracticeAgain}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> Practice Again
        </Button>
        {quiz.officialQuizExists && (
          <Button asChild type="button" size="sm" variant="outline">
            <Link
              to="/quiz/$topicId"
              params={{ topicId: quiz.topicId }}
              search={{ retake: true }}
              onClick={onClose}
            >
              Retake Official Module Quiz
            </Link>
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Return to Tutor
        </Button>
      </div>
    </>
  );
}
