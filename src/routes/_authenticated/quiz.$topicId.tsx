// import { createFileRoute, useNavigate } from "@tanstack/react-router";
// import { useQueryClient } from "@tanstack/react-query";
// import { useServerFn } from "@tanstack/react-start";
// import { motion } from "framer-motion";
// import { Loader2 } from "lucide-react";
// import { useEffect, useState } from "react";
// import logoAsset from "@/assets/ace-logo.jpg";
// import { AIQuizDialog } from "@/components/course/AIQuizDialog";
// import { Button } from "@/components/ui/button";
// import { useAuth } from "@/hooks/use-auth";
// import { supabase } from "@/integrations/supabase/client";
// import { askCourse, type AIQuizQuestion } from "@/lib/course-chat.functions";

// type TopicWithCourse = {
//   title?: string;
//   summary?: string;
//   courses?: {
//     title?: string;
//     summary?: string;
//   } | null;
// } | null;

// export const Route = createFileRoute("/_authenticated/quiz/$topicId")({
//   component: QuizRunner,
// });

// const EASE = [0.22, 1, 0.36, 1] as const;

// // Every quiz is freshly generated from the course/module information, so each
// // run produces a different randomized set of questions.
// function QuizRunner() {
//   const { topicId } = Route.useParams();
//   const { user } = useAuth();
//   const navigate = useNavigate();
//   const qc = useQueryClient();
//   const ask = useServerFn(askCourse);

//   const [questions, setQuestions] = useState<AIQuizQuestion[] | null>(null);
//   const [topicTitle, setTopicTitle] = useState("");
//   const [courseTitle, setCourseTitle] = useState("AceTutor");
//   const [error, setError] = useState<string | null>(null);

//   useEffect(() => {
//     if (!user) return;

//     let active = true;

//     (async () => {
//       setQuestions(null);
//       setError(null);

//       const { data: topic } = await supabase
//         .from("topics")
//         .select("title, summary, courses(title, summary)")
//         .eq("id", topicId)
//         .maybeSingle();

//       if (!active) return;

//       const topicRow = topic as TopicWithCourse;
//       const course = topicRow?.courses;
//       setTopicTitle(topicRow?.title ?? "");
//       setCourseTitle(course?.title ?? "AceTutor");

//       try {
//         const res = await ask({
//           data: {
//             courseTitle: course?.title ?? topicRow?.title ?? "This course",
//             courseSummary: course?.summary ?? undefined,
//             mode: "quiz_json",
//             moduleTitle: topicRow?.title ?? undefined,
//             moduleSummary: topicRow?.summary ?? undefined,
//           },
//         });

//         if (!active) return;

//         const quiz = "quiz" in res && Array.isArray(res.quiz) ? res.quiz : [];
//         if (quiz.length === 0) throw new Error("No questions were generated.");
//         setQuestions(quiz);
//       } catch (e) {
//         if (!active) return;
//         setError(e instanceof Error ? e.message : "Could not generate a quiz.");
//       }
//     })();

//     return () => {
//       active = false;
//     };
//   }, [user, topicId, ask]);

//   const handleClose = () => navigate({ to: "/topic/$topicId", params: { topicId } });

//   if (error) {
//     return (
//       <main className="flex min-h-[60vh] items-center justify-center px-6">
//         <motion.div
//           initial={{ opacity: 0, y: 16 }}
//           animate={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.5, ease: EASE }}
//           className="max-w-md rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center"
//         >
//           <img
//             src={logoAsset}
//             alt="AceTutor"
//             width={48}
//             height={48}
//             className="mx-auto rounded-xl object-contain"
//           />
//           <h1 className="mt-4 font-display text-2xl">Couldn't generate your quiz</h1>
//           <p className="mt-2 text-sm text-muted-foreground">{error}</p>
//           <Button onClick={handleClose} className="mt-6 rounded-full">
//             Back to module
//           </Button>
//         </motion.div>
//       </main>
//     );
//   }

//   if (!questions) {
//     return (
//       <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
//         <Loader2 className="h-6 w-6 animate-spin text-primary" />
//         <p className="text-sm text-muted-foreground">
//           Generating a fresh quiz on {topicTitle || "this topic"}...
//         </p>
//       </main>
//     );
//   }

//   return (
//     <main className="flex min-h-[60vh] items-center justify-center px-6">
//       <p className="text-sm text-muted-foreground">Starting your quiz...</p>
//       <AIQuizDialog
//         open
//         onClose={handleClose}
//         courseTitle={courseTitle}
//         moduleTitle={topicTitle || "This topic"}
//         topicId={topicId}
//         userId={user!.id}
//         questions={questions}
//         onCompleted={() => {
//           qc.invalidateQueries({ queryKey: ["dash-attempts", user!.id] });
//           qc.invalidateQueries({ queryKey: ["dash-progress", user!.id] });
//         }}
//       />
//     </main>
//   );
// }

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { QuizRunner, type RunnerQuestion } from "@/components/course/QuizRunner";

export const Route = createFileRoute("/_authenticated/quiz/$topicId")({
  component: ModuleQuizRoute,
  // `?retake=1` is a one-shot signal from a deliberate "start / retake" action
  // (StartQuizButton, the result page "Retry", the Study Path "Retake quiz").
  // Without it, landing here for a module that already has a graded attempt
  // (browser Back, a bookmarked URL) redirects to that result instead of
  // starting a fresh attempt + timer.
  validateSearch: (search: Record<string, unknown>): { retake?: boolean } => ({
    retake: search.retake === true || search.retake === "1" || search.retake === 1 ? true : undefined,
  }),
});

function ModuleQuizRoute() {
  const { topicId } = Route.useParams();
  const { retake } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // The retake intent is read once. It must NOT be an effect dependency: the
  // loader below re-runs whenever the auth context hands back a new `user`
  // object (Supabase fires several auth events on load), and consuming the
  // one-shot `?retake` param via navigate() also changes the search. Keeping it
  // out of the deps lets the loader re-run and finish normally.
  const retakeRef = useRef(retake === true);
  const [questions, setQuestions] = useState<RunnerQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [deadlineIso, setDeadlineIso] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noQuiz, setNoQuiz] = useState(false);
  const [notEnrolled, setNotEnrolled] = useState(false);

  // Time spent on the quiz counts towards the topic's course.
  useStudyCourse(courseId);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);

      // Server finalises any of the student's module attempts whose timer ran
      // out while they were away (closed tab) — so a late return is graded and
      // never left dangling.
      await supabase.rpc("finalize_expired_quiz_attempts");
      if (!active) return;

      const { data: topic } = await supabase
        .from("topics")
        .select("title, course_id")
        .eq("id", topicId)
        .maybeSingle();
      if (!active) return;
      setTopicTitle(topic?.title ?? "");
      setCourseId(topic?.course_id ?? null);

      // Check if user is enrolled in the course
      if (topic?.course_id) {
        const { data: enrollment } = await supabase
          .from("enrollments")
          .select("id")
          .eq("user_id", user.id)
          .eq("course_id", topic.course_id)
          .maybeSingle();
        if (!active) return;
        if (!enrollment) {
          setNotEnrolled(true);
          setLoading(false);
          return;
        }
      }

      const { data: qs, error } = await supabase.rpc("get_quiz_questions", {
        _topic_id: topicId,
        _limit: 50,
      });
      if (!active) return;
      if (error) {
        toast.error("Could not load questions");
        setLoading(false);
        return;
      }
      const loaded = (qs ?? []) as RunnerQuestion[];
      setQuestions(loaded);

      // A module without a published quiz can't be started or completed — the
      // lecturer hasn't added questions yet. Don't record an attempt.
      if (loaded.length === 0) {
        setNoQuiz(true);
        setLoading(false);
        return;
      }

      // Resume an existing in-progress, non-expired attempt so a refresh / return
      // does not reset the timer.
      const nowIso = new Date().toISOString();
      const { data: existing } = await supabase
        .from("quiz_attempts")
        .select("id, expires_at")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .is("finished_at", null)
        .gt("expires_at", nowIso)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;

      if (existing) {
        setAttemptId(existing.id);
        setDeadlineIso(existing.expires_at);
        setLoading(false);
        if (retakeRef.current) {
          navigate({ to: "/quiz/$topicId", params: { topicId }, search: {}, replace: true });
        }
        return;
      }

      // No active attempt. If the student already has a graded attempt for this
      // module and did NOT explicitly ask for a retake (browser Back from the
      // result page, a direct/bookmarked URL, or a return after the timer
      // lapsed and `finalize_expired_quiz_attempts` graded it), send them to
      // that result — never silently start a new attempt or timer.
      const { data: last } = await supabase
        .from("quiz_attempts")
        .select("id, finished_at")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
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

      // A genuine first attempt, or a deliberate retake → start a new attempt
      // (the DB trigger stamps expires_at = started_at + the module's quiz
      // duration). Module retakes are unlimited by design.
      const { data: attempt, error: aErr } = await supabase
        .from("quiz_attempts")
        .insert({ user_id: user.id, topic_id: topicId })
        .select("id, expires_at")
        .single();
      if (!active) return;
      if (aErr) {
        toast.error(aErr.message);
        setLoading(false);
        return;
      }
      setAttemptId(attempt.id);
      setDeadlineIso(attempt.expires_at);
      qc.invalidateQueries({ queryKey: ["active-quiz-attempt"] });
      setLoading(false);

      // Consume the one-shot retake flag so a later Back/refresh onto this URL
      // falls through to the redirect above instead of starting another attempt.
      if (retakeRef.current) {
        navigate({ to: "/quiz/$topicId", params: { topicId }, search: {}, replace: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [user, topicId, qc, navigate]);

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
    // `replace` so the just-submitted quiz does not stay as a browser-history
    // entry: pressing Back from the result lands on the page the student came
    // from, not the (now completed) quiz route. Independent visits to the quiz
    // URL are still caught by the completed-attempt guard in the loader above.
    navigate({ to: "/result/$attemptId", params: { attemptId }, replace: true });
  };

  if (noQuiz) {
    return (
      <main className="container mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-12">
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <h1 className="font-display text-2xl">Quiz not published yet</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {topicTitle ? `"${topicTitle}"` : "This module"} doesn&apos;t have a quiz yet.
            You&apos;ll need to complete its quiz to finish the module — check back soon.
          </p>
          <Button
            onClick={() => navigate({ to: "/topic/$topicId", params: { topicId } })}
            className="mt-6 rounded-full"
          >
            Back to module
          </Button>
        </div>
      </main>
    );
  }

  if (notEnrolled) {
    return (
      <main className="container mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-12">
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <h1 className="font-display text-2xl">Enroll to take this quiz</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            You must be enrolled in this course before you can take quizzes. Please enroll first to proceed.
          </p>
          <Button
            onClick={() => navigate({ to: "/courses" })}
            className="mt-6 rounded-full"
          >
            View courses and enroll
          </Button>
        </div>
      </main>
    );
  }

  return (
    <QuizRunner
      eyebrow="Quiz"
      title={topicTitle}
      loading={loading}
      submitting={submitting}
      attemptReady={!!attemptId}
      questions={questions}
      deadlineIso={deadlineIso}
      onSubmit={onSubmit}
    />
  );
}
