import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";

export const Route = createFileRoute("/lecturer/")({
  component: LecturerHome,
});

function LecturerHome() {
  const { lecturerCourseId } = useRole();

  const { data: course } = useQuery({
    queryKey: ["lecturer-course", lecturerCourseId],
    enabled: !!lecturerCourseId,
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("title, summary")
        .eq("id", lecturerCourseId!)
        .maybeSingle();
      return data;
    },
  });

  return (
    <main className="container mx-auto max-w-4xl px-4 py-16">
      <p className="text-sm text-muted-foreground">Lecturer workspace</p>
      <h1 className="mt-1 font-display text-4xl">{course?.title ?? "Your course"}</h1>
      {course?.summary && (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{course.summary}</p>
      )}
      <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/50 p-8 text-sm text-muted-foreground">
        Your lecturer tools — enrolled students, course materials, quizzes and quiz
        performance — arrive in the next update. Your account is permanently linked to
        this course; that assignment can&apos;t be changed here.
      </div>
    </main>
  );
}
