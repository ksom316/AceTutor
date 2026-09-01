import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { CheckCircle2, Loader2, RotateCcw, Sparkles, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { useStudyPath } from "@/hooks/use-study-path";
import { canAttemptCourseQuiz } from "@/lib/course-quiz";
import { attemptStatus } from "@/lib/quiz-timer";
import { StudyPathPanel } from "@/components/course/StudyPathPanel";

export const Route = createFileRoute("/_authenticated/result/$attemptId")({
  component: ResultPage,
});

const EASE = [0.22, 1, 0.36, 1] as const;

type AttemptDetail = {
  id: string;
  score: number | null;
  total: number | null;
  answered_count: number | null;
  finished_at: string | null;
  expires_at: string | null;
  timed_out: boolean;
  topic_id: string | null;
  course_quiz_id: string | null;
  topics: { title: string; course_id: string } | null;
  course_quizzes: {
    title: string;
    max_attempts: number | null;
    courses: { id: string; title: string; slug: string } | null;
  } | null;
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
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["result", attemptId],
    queryFn: async () => {
      // Finalise the attempt server-side first if its timer lapsed while the
      // student was away, so the result below reflects the graded state.
      await supabase.rpc("finalize_expired_quiz_attempts");
      const { data: attempt } = await supabase
        .from("quiz_attempts")
        .select(
          "id, score, total, answered_count, finished_at, expires_at, timed_out, topic_id, course_quiz_id, topics(title, course_id), course_quizzes(title, max_attempts, courses(id, title, slug))",
        )
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

  // Time reviewing results counts towards the quiz's course.
  useStudyCourse(
    data?.attempt?.topics?.course_id ?? data?.attempt?.course_quizzes?.courses?.id ?? null,
  );

  const isCourseQuiz = !!data?.attempt && !data.attempt.topic_id;
  const moduleTopicId = data?.attempt && data.attempt.topic_id ? data.attempt.topic_id : null;
  const attemptFinished = !!data?.attempt?.finished_at;
  const imperfect =
    !!data?.attempt &&
    (data.attempt.total ?? 0) > 0 &&
    (data.attempt.score ?? 0) < (data.attempt.total ?? 0);

  // AI Study Path — a finished, non-perfect MODULE or GENERAL COURSE QUIZ
  // attempt. A perfect attempt never touches the study-path table. Generation
  // itself is on demand (button). For a general quiz, topicId is null and the
  // path is course-level.
  const studyPathEligible =
    !!data?.attempt &&
    attemptFinished &&
    imperfect &&
    (!!moduleTopicId || (isCourseQuiz && !!data.attempt.course_quiz_id));
  const sp = useStudyPath(attemptId, { enabled: studyPathEligible });

  const courseQuizId = data?.attempt?.course_quiz_id ?? null;
  const maxAttempts = data?.attempt?.course_quizzes?.max_attempts ?? null;
  const resultTitle = isCourseQuiz
    ? `${data?.attempt?.course_quizzes?.title ?? "General Course Quiz"} · ${
        data?.attempt?.course_quizzes?.courses?.title ?? "Course"
      }`
    : (data?.attempt?.topics?.title ?? "Quiz");

  // Whether the student may still start this General Course Quiz again. The DB
  // trigger is authoritative; this only decides whether to show a Retry button.
  const { data: attemptsUsed } = useQuery({
    queryKey: ["result-course-quiz-attempts", courseQuizId, user?.id],
    enabled: isCourseQuiz && !!courseQuizId && !!user && maxAttempts != null,
    queryFn: async () => {
      const { count } = await supabase
        .from("quiz_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("course_quiz_id", courseQuizId!);
      return count ?? 0;
    },
  });
  const canRetryCourseQuiz =
    maxAttempts == null || canAttemptCourseQuiz(attemptsUsed ?? 0, maxAttempts);

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
  const status = attemptStatus({
    finished: !!data.attempt.finished_at,
    answered: data.attempt.answered_count,
    total: data.attempt.total,
    timedOut: data.attempt.timed_out,
    expired:
      !data.attempt.finished_at &&
      !!data.attempt.expires_at &&
      Date.now() >= Date.parse(data.attempt.expires_at),
  });
  const unansweredCount =
    data.attempt.answered_count != null && data.attempt.total != null
      ? data.attempt.total - data.attempt.answered_count
      : 0;
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
        {resultTitle}
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
        <div className="relative mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${
              status.key === "completed-full"
                ? "border-success/40 bg-success/10 text-success"
                : status.key === "completed-incomplete"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                  : "border-border bg-card text-muted-foreground"
            }`}
          >
            {status.marker} {status.label}
          </span>
          {status.note && (
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              {status.note}
            </span>
          )}
          {unansweredCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {unansweredCount} question{unansweredCount === 1 ? "" : "s"} left unanswered
            </span>
          )}
        </div>
      </motion.div>

      {/* Personalized study path — offered right after the score, before the
          detailed corrections, so the student discovers it without scrolling
          past every wrong-answer explanation. */}
      {studyPathEligible && (
        <div className="mt-10">
          <StudyPathPanel
            studyPath={sp.studyPath}
            isLoading={sp.isLoading}
            generating={sp.generating}
            generateResult={sp.generateResult}
            onGenerate={sp.generate}
            saved={!!sp.studyPath?.saved_at}
            savingSaved={sp.savingSaved}
            onSetSaved={sp.setSaved}
          />
        </div>
      )}

      {/* Answer breakdown — review what you missed: your answer, the correct
          answer, and the explanation for each question. */}
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
        {isCourseQuiz ? (
          data.attempt.course_quiz_id && canRetryCourseQuiz ? (
            <Button asChild className="transition-transform hover:scale-[1.02] active:scale-95">
              <Link
                to="/course-quiz/$quizId"
                params={{ quizId: data.attempt.course_quiz_id }}
                search={{ retake: true }}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" /> Retry
              </Link>
            </Button>
          ) : data.attempt.course_quiz_id ? (
            <p className="self-center text-sm text-muted-foreground">
              Attempt limit reached — no retries left for this assessment.
            </p>
          ) : null
        ) : data.attempt.topic_id ? (
          <Button asChild className="transition-transform hover:scale-[1.02] active:scale-95">
            <Link
              to="/quiz/$topicId"
              params={{ topicId: data.attempt.topic_id }}
              search={{ retake: true }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" /> Retry
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </motion.div>
    </main>
  );
}
