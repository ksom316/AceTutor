import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BookOpen, ArrowRight } from "lucide-react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { supabase } from "@/integrations/supabase/client";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";

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
          <p className="mt-2 text-muted-foreground">Pick a course to see its topics and lessons.</p>
        </motion.div>

        {isLoading ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl border border-border bg-card/60" />
            ))}
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {data?.map((c) => (
              <motion.div key={c.id} variants={staggerItem} whileHover={{ y: -4 }}>
                <Link
                  to="/courses/$slug"
                  params={{ slug: c.slug }}
                  className="group block h-full rounded-2xl border border-border bg-card p-6 transition-all hover:border-accent/60 hover:shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                      <BookOpen className="h-5 w-5" />
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                  </div>
                  <h2 className="mt-4 font-display text-2xl">{c.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{c.summary}</p>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>
      <Footer />
    </div>
  );
}
