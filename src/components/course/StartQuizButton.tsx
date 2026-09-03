import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveQuiz } from "@/hooks/use-active-quiz";

/**
 * Launches the AI quiz runner (/quiz/$topicId — 10 questions generated from
 * the course/module information, one question per card). Used by the course
 * page's "Start quiz" and "Generate quiz" buttons. Pass `topicId` to quiz a
 * specific module, or just `courseId` to fall back to the course's first
 * module.
 *
 * If the user is not signed in they are sent to /login with a redirect
 * param so they return here after sign-in.
 */
export function StartQuizButton({
  topicId,
  courseId,
  icon,
  children,
  ...buttonProps
}: {
  topicId?: string;
  courseId?: string;
  /** Icon shown before the label; replaced by a spinner while resolving. */
  icon?: ReactNode;
  children?: ReactNode;
} & ButtonProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const activeQuiz = useActiveQuiz();

  // When the student already has an unfinished, non-expired attempt for THIS
  // module quiz, offer to resume it. The /quiz/$topicId runner resumes an
  // existing in-progress attempt, so this consumes no extra retry.
  const isContinue =
    !!topicId && activeQuiz?.kind === "module" && activeQuiz.paramId === topicId;

  const start = async () => {
    if (loading) return;

    // Check the session directly from Supabase instead of relying on the
    // React auth context, which may not have caught up yet on fresh
    // navigations (SSR hydration / hard reloads).
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const redirectTo = topicId
        ? `/quiz/${topicId}`
        : window.location.pathname + window.location.search;
      toast.info("Sign in to start a quiz");
      navigate({ to: "/login", search: { redirect: redirectTo } });
      return;
    }

    // Check enrollment if courseId is provided
    if (courseId) {
      setLoading(true);
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", data.session.user.id)
        .eq("course_id", courseId)
        .maybeSingle();
      setLoading(false);
      
      if (!enrollment) {
        toast.error("You must be enrolled in this course to take a quiz");
        return;
      }
    }

    let target = topicId;
    if (!target && courseId) {
      setLoading(true);
      const { data: topic, error } = await supabase
        .from("topics")
        .select("id")
        .eq("course_id", courseId)
        .order("order_index", { ascending: true })
        .limit(1)
        .maybeSingle();
      setLoading(false);
      if (error || !topic) {
        toast.error("No quiz available for this course yet.");
        return;
      }
      target = topic.id;
    }
    if (!target) {
      toast.error("No quiz available yet.");
      return;
    }
    // A click here is a deliberate "take this quiz now". Unless we're resuming
    // the student's own in-progress attempt, signal an intentional (re)start so
    // the runner route creates a fresh attempt instead of redirecting to an
    // earlier result.
    navigate({
      to: "/quiz/$topicId",
      params: { topicId: target },
      search: isContinue ? {} : { retake: true },
    });
  };

  return (
    <Button {...buttonProps} disabled={loading || buttonProps.disabled} onClick={start}>
      {loading ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : isContinue ? (
        <Play className="mr-1.5 h-4 w-4" />
      ) : (
        icon
      )}
      {isContinue ? "Continue quiz" : children}
    </Button>
  );
}
