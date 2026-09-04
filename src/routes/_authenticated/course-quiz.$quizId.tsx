import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { QuizRunner, type RunnerQuestion } from "@/components/course/QuizRunner";
import { QuizRecoveryGate } from "@/components/course/QuizRecoveryGate";
import { loadSavedAnswers, orderQuestionsForAttempt } from "@/lib/quiz-recovery";
import { useAnswerSync } from "@/hooks/use-answer-sync";
import {
  canAttemptCourseQuiz,
  deadlineStatus,
  effectiveQuizDeadline,
  formatDateTime,
  formatDeadline,
} from "@/lib/course-quiz";

export const Route = createFileRoute("/_authenticated/course-quiz/$quizId")({
  component: GeneralCourseQuizRoute,
  // `?retake=1` is a one-shot signal from a deliberate "start / retry" action.
  // Without it, landing here for an assessment that already has a graded attempt
  // (browser Back, a bookmarked URL) redirects to that result instead of
  // starting a fresh attempt + timer.
  validateSearch: (search: Record<string, unknown>): { retake?: boolean } => ({
    retake:
      search.retake === true || search.retake === "1" || search.retake === 1 ? true : undefined,
  }),
});

type Status =
  | "loading"
  | "not-found"
  | "not-enrolled"
  | "not-published"
  | "upcoming"
  | "deadline-passed"
  | "limit-reached"
  | "ready"
  | "error";

function GeneralCourseQuizRoute() {
  const { quizId } = Route.useParams();
  const { retake } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Read once. Must NOT be an effect dependency — see the note in
  // quiz.$topicId.tsx: the loader re-runs on new `user` objects, and consuming
  // `?retake` changes the search; keeping it out of the deps lets the loader
  // finish normally.
  const retakeRef = useRef(retake === true);

  const [status, setStatus] = useState<Status>("loading");
  const [quiz, setQuiz] = useState<{
    title: string;
    deadline: string | null;
    availableFrom: string | null;
    maxAttempts: number | null;
  } | null>(null);
  const [course, setCourse] = useState<{ id: string; title: string; slug: string } | null>(null);
  const [questions, setQuestions] = useState<RunnerQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  // The attempt's stored NORMAL timer (never mutated) and the timer actually
  // shown, which is min(that, the CURRENT course-quiz deadline).
  const [attemptExpiresAt, setAttemptExpiresAt] = useState<string | null>(null);
  const [deadlineIso, setDeadlineIso] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Quiz Recovery — identical to the module quiz: pick up a pre-existing
  // unfinished attempt, restore its saved answers, show the "Unfinished Quiz"
  // gate. Resuming a General Course Quiz does NOT consume another attempt.
  const [resumed, setResumed] = useState(false);
  const [resumeAccepted, setResumeAccepted] = useState(false);
  const [restoredAnswers, setRestoredAnswers] = useState<Record<string, number>>({});

  const sync = useAnswerSync(attemptId);

  useStudyCourse(course?.id ?? null);

  // While an attempt is live, keep an eye on the course quiz's CURRENT deadline
  // (a lecturer can shorten it after this page loaded). Lightweight: one row by
  // primary key, polled a minute at a time and on window focus / reconnect. The
  // shown timer stays min(stored expires_at, this deadline); the stored attempt
  // timer is never touched. The DB trigger + save_quiz_answer remain the real
  // enforcement.
  const liveDeadline = useQuery({
    queryKey: ["course-quiz-live-deadline", quizId],
    enabled: !!attemptId && status === "ready",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("course_quizzes")
        .select("deadline")
        .eq("id", quizId)
        .maybeSingle();
      return data?.deadline ?? null;
    },
  });

  useEffect(() => {
    if (!attemptExpiresAt || !liveDeadline.isSuccess) return;
    setDeadlineIso(effectiveQuizDeadline(attemptExpiresAt, liveDeadline.data));
  }, [attemptExpiresAt, liveDeadline.isSuccess, liveDeadline.data]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setStatus("loading");

      // Server finalises the student's own timed-out attempts (module or
      // general) that were never submitted, so a late return is graded.
      await supabase.rpc("finalize_expired_quiz_attempts");
      if (!active) return;

      const { data: cq } = await supabase
        .from("course_quizzes")
        .select("id, title, deadline, available_from, max_attempts, course_id")
        .eq("id", quizId)
        .maybeSingle();
      if (!active) return;
      if (!cq) {
        setStatus("not-found");
        return;
      }
      setQuiz({
        title: cq.title,
        deadline: cq.deadline,
        availableFrom: cq.available_from,
        maxAttempts: cq.max_attempts,
      });

      const { data: courseRow } = await supabase
        .from("courses")
        .select("id, title, slug")
        .eq("id", cq.course_id)
        .maybeSingle();
      if (!active) return;
      setCourse(courseRow ?? null);

      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", user.id)
        .eq("course_id", cq.course_id)
        .maybeSingle();
      if (!active) return;
      if (!enrollment) {
        setStatus("not-enrolled");
        return;
      }

      // Client-side availability / deadline gates for a clear message; the DB
      // trigger (enforce_course_quiz_attempt) is the real enforcement and
      // rejects an early or late attempt insert regardless.
      if (cq.available_from && Date.now() < Date.parse(cq.available_from)) {
        setStatus("upcoming");
        return;
      }
      if (deadlineStatus(cq.deadline) === "passed") {
        setStatus("deadline-passed");
        return;
      }

      const { data: qs, error } = await supabase.rpc("get_course_quiz_questions", {
        _quiz_id: quizId,
        _limit: 50,
      });
      if (!active) return;
      if (error) {
        toast.error("Could not load the quiz");
        setStatus("error");
        return;
      }
      // Server-random order; re-ordered deterministically per attempt below so
      // a recovered assessment keeps the order it started with.
      const loaded = (qs ?? []) as RunnerQuestion[];
      if (loaded.length === 0) {
        setStatus("not-published");
        return;
      }

      // Resume an existing in-progress, non-expired attempt so a refresh /
      // return continues the same attempt (and does not consume another). Only
      // when there is none do we start a new one — the max-attempts cap is
      // enforced on that insert by enforce_course_quiz_attempt().
      const nowIso = new Date().toISOString();
      const { data: existing } = await supabase
        .from("quiz_attempts")
        .select("id, expires_at")
        .eq("user_id", user.id)
        .eq("course_quiz_id", quizId)
        .is("finished_at", null)
        .gt("expires_at", nowIso)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;

      if (existing) {
        const saved = await loadSavedAnswers(existing.id);
        if (!active) return;
        setQuestions(orderQuestionsForAttempt(loaded, existing.id));
        setRestoredAnswers(saved);
        setAttemptId(existing.id);
        setAttemptExpiresAt(existing.expires_at);
        setDeadlineIso(effectiveQuizDeadline(existing.expires_at, cq.deadline));
        setResumed(true);
        setStatus("ready");
        if (retakeRef.current) {
          navigate({ to: "/course-quiz/$quizId", params: { quizId }, search: {}, replace: true });
        }
        return;
      }

      // No active attempt. If the student already has a graded attempt for this
      // assessment and did NOT explicitly ask for a retry (browser Back from the
      // result page, a direct/bookmarked URL, or a return after the timer lapsed
      // and `finalize_expired_quiz_attempts` graded it), send them to that
      // result — never silently start a new attempt or timer.
      const { data: last } = await supabase
        .from("quiz_attempts")
        .select("id, finished_at")
        .eq("user_id", user.id)
        .eq("course_quiz_id", quizId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (last?.finished_at && !retakeRef.current) {
        navigate({
          to: "/result/$attemptId",
          params: { attemptId: last.id },
          replace: true,
        });
        return;
      }

      // Client-side attempt-cap gate for a clear message. The DB trigger
      // (enforce_course_quiz_attempt) is the authoritative check and counts
      // every attempt row for this student + quiz.
      if (cq.max_attempts != null) {
        const { count } = await supabase
          .from("quiz_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("course_quiz_id", quizId);
        if (!active) return;
        if (!canAttemptCourseQuiz(count ?? 0, cq.max_attempts)) {
          setStatus("limit-reached");
          return;
        }
      }

      const { data: attempt, error: aErr } = await supabase
        .from("quiz_attempts")
        .insert({ user_id: user.id, course_quiz_id: quizId })
        .select("id, expires_at")
        .single();
      if (!active) return;
      if (aErr) {
        // A concurrent load / double-click already created the active attempt
        // (partial unique index quiz_attempts_one_active_general) — resume it.
        if (aErr.code === "23505") {
          const { data: raced } = await supabase
            .from("quiz_attempts")
            .select("id, expires_at")
            .eq("user_id", user.id)
            .eq("course_quiz_id", quizId)
            .is("finished_at", null)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!active) return;
          if (raced) {
            const saved = await loadSavedAnswers(raced.id);
            if (!active) return;
            setQuestions(orderQuestionsForAttempt(loaded, raced.id));
            setRestoredAnswers(saved);
            setAttemptId(raced.id);
            setAttemptExpiresAt(raced.expires_at);
            setDeadlineIso(effectiveQuizDeadline(raced.expires_at, cq.deadline));
            setResumed(true);
            setStatus("ready");
            return;
          }
        }
        // The BEFORE INSERT trigger surfaces deadline / enrolment / attempt-cap
        // errors here — map them to the matching screen.
        if (/not available yet/i.test(aErr.message)) {
          setStatus("upcoming");
          return;
        }
        if (/deadline/i.test(aErr.message)) {
          setStatus("deadline-passed");
          return;
        }
        if (/attempt/i.test(aErr.message)) {
          setStatus("limit-reached");
          return;
        }
        toast.error(aErr.message);
        setStatus("error");
        return;
      }
      setQuestions(orderQuestionsForAttempt(loaded, attempt.id));
      setAttemptId(attempt.id);
      setAttemptExpiresAt(attempt.expires_at);
      setDeadlineIso(effectiveQuizDeadline(attempt.expires_at, cq.deadline));
      setStatus("ready");
      qc.invalidateQueries({ queryKey: ["active-quiz-attempt"] });

      // Consume the one-shot retake flag so a later Back/refresh onto this URL
      // falls through to the redirect above instead of starting another attempt.
      if (retakeRef.current) {
        navigate({ to: "/course-quiz/$quizId", params: { quizId }, search: {}, replace: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [user, quizId, qc, navigate]);

  const { seedSaved } = sync;
  useEffect(() => {
    if (Object.keys(restoredAnswers).length > 0) seedSaved(restoredAnswers);
  }, [restoredAnswers, seedSaved]);

  const onSubmit = async (answers: Record<string, number>, timedOut: boolean) => {
    if (!attemptId) return;
    setSubmitting(true);
    await sync.retryUnsynced();
    const { error } = await supabase.rpc("grade_quiz", {
      _attempt_id: attemptId,
      _answers: answers,
      _timed_out: timedOut,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["active-quiz-attempt"] });
    // `replace` so the just-submitted assessment does not stay as a
    // browser-history entry: Back from the result lands on the page the student
    // came from. Independent visits to the quiz URL are still caught by the
    // completed-attempt guard in the loader above.
    navigate({ to: "/result/$attemptId", params: { attemptId }, replace: true });
  };

  if (status !== "ready" && status !== "loading") {
    const backSlug = course?.slug;
    const heading =
      status === "not-found"
        ? "Assessment not found"
        : status === "not-enrolled"
          ? "Enroll to take this assessment"
          : status === "upcoming"
            ? "Not available yet"
            : status === "deadline-passed"
              ? "Deadline passed"
              : status === "limit-reached"
                ? "Attempt limit reached"
                : status === "not-published"
                  ? `${quiz?.title ?? "This assessment"} isn't ready yet`
                  : "Something went wrong";
    const body =
      status === "not-found"
        ? "This general course assessment no longer exists."
        : status === "not-enrolled"
          ? `Enroll in ${course?.title ?? "this course"} to take its general course assessments.`
          : status === "upcoming"
            ? `This assessment opens ${
                quiz?.availableFrom ? formatDateTime(quiz.availableFrom) : "soon"
              }. Come back then to take it.`
            : status === "deadline-passed"
              ? `This assessment is no longer available because the deadline has passed${
                  quiz?.deadline ? ` (${formatDeadline(quiz.deadline)})` : ""
                }.`
              : status === "limit-reached"
                ? `You have used all ${
                    quiz?.maxAttempts ?? ""
                  } attempt(s) allowed for this assessment. Your previous results are still on your dashboard.`
                : status === "not-published"
                  ? "Your lecturer hasn't added any questions to this assessment yet — check back soon."
                  : "The assessment couldn't be loaded. Please try again.";
    return (
      <main className="container mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-12">
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <h1 className="font-display text-2xl">{heading}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
          <Button
            onClick={() =>
              backSlug
                ? navigate({ to: "/courses/$slug", params: { slug: backSlug } })
                : navigate({ to: "/dashboard" })
            }
            className="mt-6 rounded-full"
          >
            {backSlug ? "Back to course" : "Back to dashboard"}
          </Button>
        </div>
      </main>
    );
  }

  if (resumed && !resumeAccepted && attemptId) {
    return (
      <QuizRecoveryGate
        eyebrow="General Course Assessment"
        title={quiz?.title ?? "this assessment"}
        deadlineIso={deadlineIso}
        answeredCount={Object.keys(restoredAnswers).length}
        totalQuestions={questions.length}
        onResume={() => setResumeAccepted(true)}
      />
    );
  }

  return (
    <QuizRunner
      eyebrow="General Course Assessment"
      title={quiz?.title ?? "General Course Assessment"}
      subtitle={`Created by your lecturer · covers the whole ${
        course?.title ?? "course"
      }. Answer all questions, then submit for instant feedback.`}
      loading={status === "loading"}
      submitting={submitting}
      attemptReady={!!attemptId}
      questions={questions}
      deadlineIso={deadlineIso}
      initialAnswers={restoredAnswers}
      onAnswer={sync.onAnswer}
      unsyncedIds={sync.unsyncedIds}
      onSubmit={onSubmit}
    />
  );
}
