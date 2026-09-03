import { createFileRoute } from "@tanstack/react-router";
import { QuizBuilder } from "@/components/lecturer/QuizBuilder";

export const Route = createFileRoute("/lecturer/quizzes/$topicId")({
  component: ModuleQuizBuilderRoute,
});

function ModuleQuizBuilderRoute() {
  const { topicId } = Route.useParams();
  return <QuizBuilder scope={{ kind: "topic", topicId }} />;
}
