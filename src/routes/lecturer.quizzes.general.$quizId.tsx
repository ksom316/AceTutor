import { createFileRoute } from "@tanstack/react-router";
import { QuizBuilder } from "@/components/lecturer/QuizBuilder";
import { useRole } from "@/hooks/use-role";

export const Route = createFileRoute("/lecturer/quizzes/general/$quizId")({
  component: GeneralCourseQuizBuilderRoute,
});

function GeneralCourseQuizBuilderRoute() {
  // The /lecturer layout guard already blocks non-lecturers. The quiz id only
  // selects which of the lecturer's course quizzes is being edited — QuizBuilder
  // verifies it belongs to their assigned course (course_quizzes.course_id ===
  // current_lecturer_course()) before allowing any change.
  const { quizId } = Route.useParams();
  const { lecturerCourseId, loading } = useRole();

  if (loading || !lecturerCourseId) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-16 text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }
  return <QuizBuilder scope={{ kind: "course", courseQuizId: quizId }} />;
}
