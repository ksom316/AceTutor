import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { QuizRunner, type RunnerQuestion } from "@/components/course/QuizRunner";
import { canAttemptCourseQuiz, deadlineStatus, formatDeadline } from "@/lib/course-quiz";

export const Route = createFileRoute("/_authenticated/course-quiz/$quizId")({
  component: GeneralCourseQuizRoute,
});

type Status =
  | "loading"
  | "not-found"
  | "not-enrolled"
  | "not-published"
  | "deadline-passed"
  | "limit-reached"
  | "ready"
  | "error";

function GeneralCourseQuizRoute() {
  const { quizId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [status, setStatus] = useState<Status>("loading");
  const [quiz, setQuiz] = useState<{
    title: string;
    deadline: string | null;
    maxAttempts: number | null;
  } | null>(null);
  const [course, setCourse] = useState<{ id: string; title: string; slug: string } | null>(null);
  const [questions, setQuestions] = useState<RunnerQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [deadlineIso, setDeadlineIso] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useStudyCourse(course?.id ?? null);

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
        .select("id, title, deadline, max_attempts, course_id")
        .eq("id", quizId)
        .maybeSingle();
      if (!active) return;
      if (!cq) {
        setStatus("not-found");
        return;
      }
      setQuiz({ title: cq.title, deadline: cq.deadline, maxAttempts: cq.max_attempts });

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

      // Client-side deadline gate for a clear message; the DB trigger is the
      // real enforcement and rejects a late attempt insert regardless.
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
      const loaded = (qs ?? []) as RunnerQuestion[];
      setQuestions(loaded);
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
        setAttemptId(existing.id);
        setDeadlineIso(existing.expires_at);
        setStatus("ready");
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
        // The BEFORE INSERT trigger surfaces deadline / enrolment / attempt-cap
        // errors here — map them to the matching screen.
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
      setAttemptId(attempt.id);
      setDeadlineIso(attempt.expires_at);
      setStatus("ready");
      qc.invalidateQueries({ queryKey: ["active-quiz-attempt"] });
    })();
    return () => {
      active = false;
    };
  }, [user, quizId, qc]);

  const onSubmit = async (answers: Record<string, number>, timedOut: boolean) => {
    if (!attemptId) return;
    setSubmitting(true);
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
    navigate({ to: "/result/$attemptId", params: { attemptId } });
  };

  if (status !== "ready" && status !== "loading") {
    const backSlug = course?.slug;
    const heading =
      status === "not-found"
        ? "Assessment not found"
        : status === "not-enrolled"
          ? "Enroll to take this assessment"
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
      onSubmit={onSubmit}
    />
  );
}
