import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import logoAsset from "@/assets/ace-logo.jpg";
import { AIQuizDialog } from "@/components/course/AIQuizDialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { askCourse, type AIQuizQuestion } from "@/lib/course-chat.functions";

type TopicWithCourse = {
  title?: string;
  summary?: string;
  courses?: {
    title?: string;
    summary?: string;
  } | null;
} | null;

export const Route = createFileRoute("/_authenticated/quiz/$topicId")({
  component: QuizRunner,
});

const EASE = [0.22, 1, 0.36, 1] as const;

// Every quiz is freshly generated from the course/module information, so each
// run produces a different randomized set of questions.
function QuizRunner() {
  const { topicId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ask = useServerFn(askCourse);

  const [questions, setQuestions] = useState<AIQuizQuestion[] | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [courseTitle, setCourseTitle] = useState("AceTutor");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    let active = true;

    (async () => {
      setQuestions(null);
      setError(null);

      const { data: topic } = await supabase
        .from("topics")
        .select("title, summary, courses(title, summary)")
        .eq("id", topicId)
        .maybeSingle();

      if (!active) return;

      const topicRow = topic as TopicWithCourse;
      const course = topicRow?.courses;
      setTopicTitle(topicRow?.title ?? "");
      setCourseTitle(course?.title ?? "AceTutor");

      try {
        const res = await ask({
          data: {
            courseTitle: course?.title ?? topicRow?.title ?? "This course",
            courseSummary: course?.summary ?? undefined,
            mode: "quiz_json",
            moduleTitle: topicRow?.title ?? undefined,
            moduleSummary: topicRow?.summary ?? undefined,
          },
        });

        if (!active) return;

        const quiz = "quiz" in res && Array.isArray(res.quiz) ? res.quiz : [];
        if (quiz.length === 0) throw new Error("No questions were generated.");
        setQuestions(quiz);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Could not generate a quiz.");
      }
    })();

    return () => {
      active = false;
    };
  }, [user, topicId, ask]);

  const handleClose = () => navigate({ to: "/topic/$topicId", params: { topicId } });

  if (error) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="max-w-md rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center"
        >
          <img
            src={logoAsset}
            alt="AceTutor"
            width={48}
            height={48}
            className="mx-auto rounded-xl object-contain"
          />
          <h1 className="mt-4 font-display text-2xl">Couldn't generate your quiz</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button onClick={handleClose} className="mt-6 rounded-full">
            Back to module
          </Button>
        </motion.div>
      </main>
    );
  }

  if (!questions) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Generating a fresh quiz on {topicTitle || "this topic"}...
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6">
      <p className="text-sm text-muted-foreground">Starting your quiz...</p>
      <AIQuizDialog
        open
        onClose={handleClose}
        courseTitle={courseTitle}
        moduleTitle={topicTitle || "This topic"}
        topicId={topicId}
        userId={user!.id}
        questions={questions}
        onCompleted={() => {
          qc.invalidateQueries({ queryKey: ["dash-attempts", user!.id] });
          qc.invalidateQueries({ queryKey: ["dash-progress", user!.id] });
        }}
      />
    </main>
  );
}
