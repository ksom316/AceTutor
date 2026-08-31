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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { QuizRunner, type RunnerQuestion } from "@/components/course/QuizRunner";

export const Route = createFileRoute("/_authenticated/quiz/$topicId")({
  component: ModuleQuizRoute,
});

function ModuleQuizRoute() {
  const { topicId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<RunnerQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noQuiz, setNoQuiz] = useState(false);

  // Time spent on the quiz counts towards the topic's course.
  useStudyCourse(courseId);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: topic } = await supabase
        .from("topics")
        .select("title, course_id")
        .eq("id", topicId)
        .maybeSingle();
      if (!active) return;
      setTopicTitle(topic?.title ?? "");
      setCourseId(topic?.course_id ?? null);

      const { data: qs, error } = await supabase.rpc("get_quiz_questions", {
        _topic_id: topicId,
        _limit: 30,
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

      const { data: attempt, error: aErr } = await supabase
        .from("quiz_attempts")
        .insert({ user_id: user.id, topic_id: topicId })
        .select("id")
        .single();
      if (!active) return;
      if (aErr) toast.error(aErr.message);
      else setAttemptId(attempt.id);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, topicId]);

  const onSubmit = async (answers: Record<string, number>) => {
    if (!attemptId) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("grade_quiz", {
      _attempt_id: attemptId,
      _answers: answers,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/result/$attemptId", params: { attemptId } });
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

  return (
    <QuizRunner
      eyebrow="Quiz"
      title={topicTitle}
      loading={loading}
      submitting={submitting}
      attemptReady={!!attemptId}
      questions={questions}
      onSubmit={onSubmit}
    />
  );
}
