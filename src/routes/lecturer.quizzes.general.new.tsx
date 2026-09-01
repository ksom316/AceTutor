import { createFileRoute } from "@tanstack/react-router";
import { QuizBuilder } from "@/components/lecturer/QuizBuilder";
import { useRole } from "@/hooks/use-role";

export const Route = createFileRoute("/lecturer/quizzes/general/new")({
  component: NewGeneralCourseQuizRoute,
});

function NewGeneralCourseQuizRoute() {
  // The /lecturer layout guard already blocks non-lecturers. QuizBuilder's
  // "course-new" state holds the title / time limit / questions locally and
  // only persists via create_course_quiz_with_questions() (which re-checks
  // ownership + the >= 1 question rule server-side), then hands off to the
  // persisted /lecturer/quizzes/general/$quizId builder.
  const { lecturerCourseId, loading } = useRole();

  if (loading || !lecturerCourseId) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-16 text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }
  return <QuizBuilder scope={{ kind: "course-new" }} />;
}
