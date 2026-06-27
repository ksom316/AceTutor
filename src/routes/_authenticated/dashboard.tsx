import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const { data: attempts } = useQuery({
    queryKey: ["recent-attempts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_attempts")
        .select("id, topic_id, score, total, finished_at, topics(title, slug, courses(slug, title))")
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name, vark_primary").eq("id", user!.id).maybeSingle();
      return data;
    },
  });

  return (
    <main className="container mx-auto max-w-5xl px-4 py-12">
      <motion.div variants={fadeUp} initial="hidden" animate="show">
        <p className="text-sm text-muted-foreground">Welcome back</p>
        <h1 className="mt-1 font-display text-5xl">{profile?.full_name?.split(" ")[0] ?? "Student"}</h1>
      </motion.div>

      {!profile?.vark_primary && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45 }}
        >
          <Link
            to="/onboarding/vark"
            className="group mt-6 inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground transition-colors hover:bg-accent/15"
          >
            Take the 16-question VARK intake to personalize your lessons{" "}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </motion.div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mt-12 grid gap-6 md:grid-cols-2"
      >
        <motion.section
          variants={staggerItem}
          whileHover={{ y: -4 }}
          className="group rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-lg"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">Jump back in</h2>
            <BookOpen className="h-5 w-5 text-primary transition-transform duration-300 group-hover:scale-110" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Browse the catalog and pick a topic.</p>
          <Link
            to="/courses"
            className="mt-4 inline-flex items-center text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            See all courses <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </motion.section>

        <motion.section
          variants={staggerItem}
          whileHover={{ y: -4 }}
          className="group rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-lg"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">Recent quizzes</h2>
            <Trophy className="h-5 w-5 text-accent transition-transform duration-300 group-hover:scale-110" />
          </div>
          {attempts && attempts.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {attempts.map((a: any) => (
                <li key={a.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0 transition-colors hover:text-primary">
                  <span className="truncate">{a.topics?.title}</span>
                  <span className="text-muted-foreground">
                    {a.score} / {a.total}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No quizzes yet — take one to see your progress.</p>
          )}
        </motion.section>
      </motion.div>
    </main>
  );
}
