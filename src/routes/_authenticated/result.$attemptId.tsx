import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import {
  BookOpen,
  CheckCircle2,
  Info,
  Loader2,
  MinusCircle,
  RotateCcw,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { useStudyPath } from "@/hooks/use-study-path";
import { canAttemptCourseQuiz } from "@/lib/course-quiz";
import { attemptStatus } from "@/lib/quiz-timer";
import { StudyPathPanel } from "@/components/course/StudyPathPanel";
import {
  computeModulePerformances,
  improvementLabel,
  isSufficientAttempt,
  justReachedStrong,
  type PerfAttempt,
} from "@/lib/quiz-performance";

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
type QuestionRow = {
  id: string;
  prompt: string;
  choices: string[];
  correct_index: number;
  explanation: string | null;
  order_index: number;
};
/** One row of get_attempt_review() — a quiz question with the caller's own
 *  answer merged in (nullable when unanswered). */
type ReviewRow = {
  question_id: string;
  prompt: string;
  choices: unknown;
  correct_index: number;
  explanation: string | null;
  order_index: number;
  selected_index: number | null;
  is_correct: boolean | null;
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
      // Finished-attempt review comes from the SECURITY DEFINER RPC
      // get_attempt_review() — students have no direct read on `questions`
      // (SEC-01). The RPC returns one row per question in the quiz, with the
      // caller's own answer merged in (selected_index / is_correct null when
      // unanswered), and only for the caller's own FINISHED attempt.
      let review: ReviewRow[] = [];
      if (attempt?.finished_at) {
        try {
          const { data: rows } = await supabase.rpc("get_attempt_review", {
            _attempt_id: attemptId,
          });
          review = (rows ?? []) as unknown as ReviewRow[];
        } catch {
          review = []; // review is best-effort — the score hero still renders
        }
      }

      const questions: QuestionRow[] = review.map((r) => ({
        id: r.question_id,
        prompt: r.prompt,
        choices: r.choices as string[],
        correct_index: r.correct_index,
        explanation: r.explanation,
        order_index: r.order_index,
      }));
      const answers: AnswerRow[] = review
        .filter((r) => r.selected_index != null && r.is_correct != null)
        .map((r) => ({
          question_id: r.question_id,
          selected_index: r.selected_index as number,
          is_correct: r.is_correct as boolean,
          questions: {
            prompt: r.prompt,
            choices: r.choices as string[],
            correct_index: r.correct_index,
            explanation: r.explanation,
          },
        }));

      return {
        attempt: (attempt ?? null) as unknown as AttemptDetail | null,
        answers,
        questions,
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
  // A deliberately blank submission: finished, but not one question answered.
  // It carries no signal about what the student knows, so it never gets a Study
  // Path and never counts toward performance (see src/lib/quiz-performance.ts).
  const zeroAnswer = attemptFinished && data?.attempt?.answered_count === 0;

  // A partial submission: answered some, but not enough of the quiz to be
  // reliable evidence. Same "no Study Path / no adaptive weight" treatment as a
  // blank one, with its own message. The server guards generation too.
  const attemptShape = data?.attempt
    ? {
        id: data.attempt.id,
        topic_id: data.attempt.topic_id,
        score: data.attempt.score,
        total: data.attempt.total,
        finished_at: data.attempt.finished_at,
        answered_count: data.attempt.answered_count,
      }
    : null;
  const insufficientAnswers =
    attemptFinished && !zeroAnswer && !!attemptShape && !isSufficientAttempt(attemptShape);

  // AI Study Path — a finished, non-perfect MODULE or GENERAL COURSE QUIZ
  // attempt with enough answered questions to be reliable. Generation is on
  // demand (button). For a general quiz, topicId is null and the path is
  // course-level.
  const studyPathEligible =
    !!data?.attempt &&
    attemptFinished &&
    imperfect &&
    !zeroAnswer &&
    !insufficientAnswers &&
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

  // Adaptive loop: once THIS attempt is a sufficient module attempt, the
  // student's module standing may have changed. Recompute it from all of their
  // attempts for this module (same shared model as everywhere else — no second
  // performance system) so the page can say whether the module is now strong or
  // still needs strengthening, and by how much they've improved.
  const thisAttemptSufficient = !!attemptShape && isSufficientAttempt(attemptShape);
  const { data: moduleAttempts = [] } = useQuery({
    queryKey: ["result-module-attempts", moduleTopicId, user?.id],
    enabled: !!moduleTopicId && !!user && thisAttemptSufficient,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("id, topic_id, score, total, finished_at, answered_count, started_at")
        .eq("user_id", user!.id)
        .eq("topic_id", moduleTopicId!);
      return (data ?? []) as PerfAttempt[];
    },
  });
  const modulePerf =
    moduleTopicId && thisAttemptSufficient && moduleAttempts.length > 0
      ? (computeModulePerformances(
          [{ id: moduleTopicId, title: data?.attempt?.topics?.title ?? "This module" }],
          moduleAttempts,
        )[0] ?? null)
      : null;
  const moduleNowStrong = modulePerf?.state === "strong";

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
  const incorrectCount = data.answers.filter((a) => !a.is_correct).length;

  // Full-quiz review: every question, in order, paired with the student's
  // answer if they gave one. An unanswered question is shown with its correct
  // answer for learning, but is never turned into an answered row.
  const answersByQuestion = new Map(data.answers.map((a) => [a.question_id, a]));
  const reviewItems: { question: QuestionRow; answer: AnswerRow | null }[] = (
    data.questions.length > 0
      ? data.questions
      : // Fallback for a legacy attempt whose quiz questions can't be listed:
        // show at least the answered ones from the join.
        data.answers.map(
          (a, i): QuestionRow => ({
            id: a.question_id,
            prompt: a.questions.prompt,
            choices: a.questions.choices,
            correct_index: a.questions.correct_index,
            explanation: a.questions.explanation,
            order_index: i,
          }),
        )
  ).map((question) => ({ question, answer: answersByQuestion.get(question.id) ?? null }));

  const headline = zeroAnswer
    ? "No answers recorded"
    : insufficientAnswers
      ? "Partial attempt"
      : pct >= 90
        ? "Outstanding!"
        : pct >= 70
          ? "Great work!"
          : pct >= 50
            ? "Good effort!"
            : "Keep practicing!";

  const reviewMaterialTo = moduleTopicId
    ? { to: "/topic/$topicId" as const, params: { topicId: moduleTopicId } }
    : data.attempt.course_quizzes?.courses?.slug
      ? {
          to: "/courses/$slug" as const,
          params: { slug: data.attempt.course_quizzes.courses.slug },
        }
      : null;

  const retakeButtons = (
    <>
      {reviewMaterialTo && (
        <Button asChild variant="outline">
          <Link to={reviewMaterialTo.to} params={reviewMaterialTo.params}>
            <BookOpen className="mr-1.5 h-4 w-4" /> Review course material
          </Link>
        </Button>
      )}
      {moduleTopicId ? (
        <Button asChild>
          <Link to="/quiz/$topicId" params={{ topicId: moduleTopicId }} search={{ retake: true }}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Take quiz again
          </Link>
        </Button>
      ) : data.attempt.course_quiz_id && canRetryCourseQuiz ? (
        <Button asChild>
          <Link
            to="/course-quiz/$quizId"
            params={{ quizId: data.attempt.course_quiz_id }}
            search={{ retake: true }}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" /> Take quiz again
          </Link>
        </Button>
      ) : null}
    </>
  );

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
          {incorrectCount > 0 ? ` · ${incorrectCount} incorrect` : ""}
          {unansweredCount > 0 ? ` · ${unansweredCount} unanswered` : ""}
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
        </div>
      </motion.div>

      {/* Blank submission — no usable performance data. Explicitly NOT a Study
          Path and NOT a "you did poorly" message: the attempt simply can't tell
          AceTutor anything. */}
      {zeroAnswer && (
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mt-10 rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Info className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl">You didn&apos;t answer any questions</h2>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                This quiz attempt doesn&apos;t give AceTutor enough information to understand what
                you know or which topics you need to improve, so there&apos;s no performance
                feedback or Study Path for it. You can still review the questions and correct
                answers below, then take the quiz again when you&apos;re ready.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">{retakeButtons}</div>
            </div>
          </div>
        </motion.section>
      )}

      {/* Partial attempt — answered some, but not enough of the quiz to be
          reliable evidence. Not remediation, not "you did poorly". */}
      {insufficientAnswers && (
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mt-10 rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Info className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl">Not enough evidence yet</h2>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                You answered {data.attempt.answered_count ?? 0} of {data.attempt.total ?? 0}{" "}
                questions, so AceTutor can&apos;t reliably assess your understanding of this{" "}
                {moduleTopicId ? "module" : "quiz"} yet or build a Study Path. Review the questions
                below to see the correct answers and learn from this attempt, then retake the quiz
                when you&apos;re ready.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">{retakeButtons}</div>
            </div>
          </div>
        </motion.section>
      )}

      {/* Adaptive-loop status — when this sufficient retake has carried the
          module to a strong level, say so and do NOT offer a remediation path.
          The historical Study Path row (if any) stays untouched in the DB. */}
      {moduleNowStrong && (
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mt-10 rounded-2xl border border-success/30 bg-success/5 p-6"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl">Your performance in this module is strong</h2>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {modulePerf && justReachedStrong(modulePerf)
                  ? "Your recent quiz performance has brought this module up to a strong level. No Study Path is needed right now — keep practising to hold it there."
                  : "You're at or above par on your quiz average for this module, so there's no Study Path to build. Keep practising to hold it there."}
                {modulePerf?.averageScore !== null && modulePerf?.averageScore !== undefined
                  ? ` Current module average: ${modulePerf.averageScore}%.`
                  : ""}
              </p>
            </div>
          </div>
        </motion.section>
      )}

      {/* Personalized study path — offered right after the score, before the
          detailed corrections, so the student discovers it without scrolling
          past every wrong-answer explanation. Hidden once the module is strong. */}
      {studyPathEligible && !moduleNowStrong && (
        <div className="mt-10">
          {modulePerf && improvementLabel(modulePerf) && (
            <p
              className={`mb-2 text-sm font-medium ${
                (modulePerf.improvementPoints ?? 0) > 0 ? "text-success" : "text-muted-foreground"
              }`}
            >
              This module still needs strengthening — {improvementLabel(modulePerf)}.
            </p>
          )}
          <StudyPathPanel
            studyPath={sp.studyPath}
            isLoading={sp.isLoading}
            generating={sp.generating}
            generateResult={sp.generateResult}
            onGenerate={sp.generate}
          />
        </div>
      )}

      {/* Full-quiz review — every question, with your answer where you gave one
          and the correct answer either way. Unanswered questions are shown for
          learning; they are still counted as unanswered for this attempt. */}
      <ol className="mt-10 space-y-6">
        {reviewItems.map(({ question, answer }, idx) => {
          const correctIdx = question.correct_index;
          const answered = !!answer;
          return (
            <motion.li
              key={question.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, ease: EASE, delay: Math.min(idx * 0.05, 0.3) }}
              className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-base">
                  <span className="mr-1.5 text-sm text-muted-foreground">{idx + 1}.</span>
                  {question.prompt}
                </p>
                {!answered ? (
                  <MinusCircle className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                ) : answer.is_correct ? (
                  <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-1 h-5 w-5 shrink-0 text-destructive" />
                )}
              </div>

              {!answered && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Not answered
                </p>
              )}

              <div className="mt-4 grid gap-2 text-sm">
                {(question.choices as string[]).map((c, i) => {
                  const isCorrect = i === correctIdx;
                  const isPicked = answered && i === answer.selected_index;
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between gap-3 rounded-lg border p-2.5 transition-colors ${
                        isCorrect
                          ? "border-success/60 bg-success/10"
                          : isPicked
                            ? "border-destructive/50 bg-destructive/10"
                            : "border-border"
                      }`}
                    >
                      <span>{c}</span>
                      {isCorrect && (
                        <span className="shrink-0 text-xs font-medium text-success">
                          Correct answer
                        </span>
                      )}
                      {isPicked && !isCorrect && (
                        <span className="shrink-0 text-xs font-medium text-destructive">
                          Your answer
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {!answered && (
                <p className="mt-3 text-sm">
                  <span className="font-medium text-foreground">Correct answer:</span>{" "}
                  {question.choices[correctIdx]}
                </p>
              )}

              {question.explanation && (
                <p className="mt-4 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Why:</span> {question.explanation}
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
