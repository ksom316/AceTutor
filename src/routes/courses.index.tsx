import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { CourseCard } from "@/components/site/CourseCard";
import { useEnrolledCourses } from "@/hooks/use-enrolled-courses";
import { supabase } from "@/integrations/supabase/client";
import { fadeUp, staggerContainer } from "@/lib/motion";

export const Route = createFileRoute("/courses/")({
  head: () => ({
    meta: [
      { title: "Courses — AceTutor" },
      { name: "description", content: "Five CS/IT university courses with adaptive multimodal lessons and quizzes." },
    ],
  }),
  component: CoursesPage,
});

function CoursesPage() {
  const { loggedIn, isEnrolled, enroll } = useEnrolledCourses();

  const { data, isLoading } = useQuery({
    queryKey: ["courses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, slug, title, summary, order_index")
        .order("order_index");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto max-w-6xl px-4 py-12">
        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <h1 className="font-display text-5xl">All courses</h1>
          <p className="mt-2 text-muted-foreground">
            {loggedIn ? "Enroll, then jump back into the courses you're taking." : "Pick a course to see its topics and lessons."}
          </p>
        </motion.div>

        {isLoading ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl border border-border bg-card/60" />
            ))}
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {data?.map((c, i) => (
              <CourseCard
                key={c.id}
                course={c}
                index={i}
                loggedIn={loggedIn}
                enrolled={isEnrolled(c.id)}
                enrolling={enroll.isPending && enroll.variables === c.id}
                onEnroll={() => enroll.mutate(c.id)}
              />
            ))}
          </motion.div>
        )}
      </main>
      <Footer />
    </div>
  );
}
