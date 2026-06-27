import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, CheckCircle2, XCircle, RotateCcw, Trophy, Sparkles } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AIQuizQuestion } from "@/lib/course-chat.functions";

type Props = {
  open: boolean;
  onClose: () => void;
  courseTitle: string;
  moduleTitle: string;
  topicId: string;
  userId: string;
  questions: AIQuizQuestion[];
  onCompleted?: () => void;
};

export function AIQuizDialog({
  open,
  onClose,
  courseTitle,
  moduleTitle,
  topicId,
  userId,
  questions,
  onCompleted,
}: Props) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);

  const total = questions.length;
  const q = questions[current];
  const selected = answers[current];
  const hasAnswer = selected !== undefined;
  const isLast = current === total - 1;

  const score = questions.reduce(
    (s, qq, i) => (answers[i] === qq.correctIndex ? s + 1 : s),
    0,
  );

  const reset = () => {
    setCurrent(0);
    setAnswers({});
    setFinished(false);
  };

  const handleClose = () => {
    if (finished) {
      reset();
      onClose();
      return;
    }
    if (Object.keys(answers).length === 0) {
      onClose();
      return;
    }
    setConfirmOpen(true);
  };

  const confirmStop = () => {
    setConfirmOpen(false);
    reset();
    onClose();
  };

  const handleNext = async () => {
    if (!hasAnswer) return;
    if (!isLast) {
      setCurrent((c) => c + 1);
      return;
    }
    setSaving(true);
    const finalScore = questions.reduce(
      (s, qq, i) => (answers[i] === qq.correctIndex ? s + 1 : s),
      0,
    );
    const { error } = await supabase.from("quiz_attempts").insert({
      user_id: userId,
      topic_id: topicId,
      score: finalScore,
      total,
      finished_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Quiz saved to your performance");
    setFinished(true);
    onCompleted?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent
          className="max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl [&>button]:hidden"
        >
          {/* Header */}
          <div className="border-b border-border">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-7 w-7 shrink-0 rounded-md bg-primary" />
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-semibold">
                    {courseTitle}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    AI Practice Quiz · {moduleTitle}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close quiz"
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Progress
              value={
                finished
                  ? 100
                  : ((current + (hasAnswer ? 1 : 0)) / Math.max(total, 1)) * 100
              }
              className="h-1 rounded-none bg-muted"
            />
          </div>

          {/* Body */}
          {!finished ? (
            <div className="flex flex-col items-center px-6 py-10 sm:py-12">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Question
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {current + 1}
                </span>
                <span className="text-xs text-muted-foreground">of {total}</span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={current}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full"
                >
                  <h2 className="mt-8 text-center font-display text-2xl font-bold leading-tight sm:text-3xl">
                    {q?.prompt}
                  </h2>

                  <motion.div
                    className="mx-auto mt-10 grid w-full max-w-2xl gap-3 sm:grid-cols-2"
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }}
                  >
                    {q?.choices.map((c, ci) => {
                      const isSelected = selected === ci;
                      return (
                        <motion.button
                          key={ci}
                          variants={{
                            hidden: { opacity: 0, y: 14 },
                            show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
                          }}
                          whileHover={{ y: -3 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setAnswers({ ...answers, [current]: ci })}
                          className={`group flex min-h-[72px] items-center justify-center rounded-2xl border-2 px-5 py-4 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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

              <div className="w-full">
                <div className="mt-10 flex justify-center">
                  <Button
                    size="lg"
                    onClick={handleNext}
                    disabled={!hasAnswer || saving}
                    className="h-12 w-full max-w-xs rounded-full text-base font-semibold"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : isLast ? (
                      "Finish Quiz"
                    ) : (
                      "Next Question"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto px-6 py-8">
              {(() => {
                const pct = Math.round((score / total) * 100);
                const passed = pct >= 70;
                return (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 text-center"
                  >
                    <div
                      aria-hidden
                      className={`pointer-events-none absolute -top-20 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full blur-3xl ${
                        passed ? "bg-success/20" : "bg-primary/20"
                      }`}
                    />
                    <motion.div
                      initial={{ scale: 0, rotate: -30 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.25 }}
                      className={`relative mx-auto grid h-12 w-12 place-items-center rounded-2xl ${
                        passed ? "bg-success/15 text-success" : "bg-primary/15 text-primary"
                      }`}
                    >
                      {passed ? <Trophy className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
                    </motion.div>
                    <p className="relative mt-4 text-xs uppercase tracking-widest text-muted-foreground">
                      Your score
                    </p>
                    <motion.p
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.35, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      className="relative mt-1 font-display text-6xl text-primary"
                    >
                      {pct}%
                    </motion.p>
                    <p className="relative mt-1 text-sm text-muted-foreground">
                      {score} of {total} correct · saved to your performance
                    </p>
                  </motion.div>
                );
              })()}

              <ol className="mt-6 space-y-4">
                {questions.map((qq, i) => {
                  const sel = answers[i];
                  const ok = sel === qq.correctIndex;
                  return (
                    <li key={i} className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">
                          {i + 1}. {qq.prompt}
                        </p>
                        {ok ? (
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                        ) : (
                          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                        )}
                      </div>
                      <div className="mt-3 grid gap-1.5 text-sm">
                        {qq.choices.map((c, ci) => (
                          <div
                            key={ci}
                            className={`rounded-lg border p-2 ${
                              ci === qq.correctIndex
                                ? "border-success/60 bg-success/10"
                                : ci === sel
                                ? "border-destructive/50 bg-destructive/10"
                                : "border-border"
                            }`}
                          >
                            {c}
                          </div>
                        ))}
                      </div>
                      {qq.explanation && (
                        <p className="mt-3 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Why:</span>{" "}
                          {qq.explanation}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>

              <div className="mt-6 flex justify-center gap-3">
                <Button variant="outline" onClick={reset}>
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Retry
                </Button>
                <Button
                  onClick={() => {
                    reset();
                    onClose();
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this quiz?</AlertDialogTitle>
            <AlertDialogDescription>
              Your progress on this quiz won't be saved. Are you sure you want to leave?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStop}>Stop quiz</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
