import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock,
  Compass,
  GraduationCap,
  Play,
  Plus,
  Target,
  Trophy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/my-courses")({
  component: MyCoursesPage,
});

function formatHours(seconds: number) {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)}`;
  return h.toFixed(1).replace(/\.0$/, "");
}

function MyCoursesPage() {
  const { user } = useAuth();

  // Shared query keys with the dashboard so navigation is instant (cache reuse).
  const { data: enrollments } = useQuery({
    queryKey: ["dash-enrollments", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollments")
        .select("course_id, created_at, courses(id, slug, title, summary)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const enrolledCourses = useMemo(
    () => (enrollments ?? []).map((e: any) => e.courses).filter(Boolean),
    [enrollments],
  );
  const enrolledIds = useMemo(() => enrolledCourses.map((c: any) => c.id), [enrolledCourses]);

  const { data: allCourses } = useQuery({
    queryKey: ["all-courses"],
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, slug, title, summary, order_index")
        .order("order_index");
      return (data ?? []) as any[];
    },
  });

  const { data: courseLessons } = useQuery({
    queryKey: ["dash-lessons", enrolledIds],
    enabled: enrolledIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("lessons")
        .select("id, topics!inner(course_id)")
        .in("topics.course_id", enrolledIds);
      return (data ?? []) as any[];
    },
  });

  const { data: progressRows } = useQuery({
    queryKey: ["dash-progress", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress")
        .select("completed_at, watched_seconds, lessons!inner(id, topics!inner(course_id))")
        .eq("user_id", user!.id);
      return (data ?? []) as any[];
    },
  });

  const { data: attempts } = useQuery({
    queryKey: ["dash-attempts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("score, total, finished_at")
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(20);
      return (data ?? []) as any[];
    },
  });

  const stats = useMemo(() => {
    const lessons = courseLessons ?? [];
    const prog = progressRows ?? [];

    const totalByCourse = new Map<string, number>();
    for (const l of lessons) {
      const cid = l.topics?.course_id;
      if (cid) totalByCourse.set(cid, (totalByCourse.get(cid) ?? 0) + 1);
    }

    const completedByCourse = new Map<string, number>();
    const touchedByCourse = new Map<string, number>();
    let totalSeconds = 0;
    let completedLessons = 0;
    for (const p of prog) {
      const cid = p.lessons?.topics?.course_id;
      totalSeconds += p.watched_seconds ?? 0;
      if (cid) {
        touchedByCourse.set(cid, (touchedByCourse.get(cid) ?? 0) + 1);
        if (p.completed_at) {
          completedByCourse.set(cid, (completedByCourse.get(cid) ?? 0) + 1);
          completedLessons += 1;
        }
      }
    }

    const perCourse = enrolledCourses.map((c: any) => {
      const total = totalByCourse.get(c.id) ?? 0;
      const done = completedByCourse.get(c.id) ?? 0;
      const touched = touchedByCourse.get(c.id) ?? 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return { ...c, total, done, touched, pct };
    });

    const att = attempts ?? [];
    const avgScore = att.length
      ? Math.round(att.reduce((s, a) => s + (a.total ? (a.score / a.total) * 100 : 0), 0) / att.length)
      : 0;

    return { perCourse, totalSeconds, completedLessons, avgScore, quizzes: att.length };
  }, [courseLessons, progressRows, enrolledCourses, attempts]);

  const continueCourse = useMemo(() => {
    const touched = stats.perCourse.filter((c: any) => c.touched > 0).sort((a: any, b: any) => b.pct - a.pct);
    return touched[0] ?? stats.perCourse[0] ?? null;
  }, [stats.perCourse]);

  const exploreCourses = useMemo(
    () => (allCourses ?? []).filter((c: any) => !enrolledIds.includes(c.id)),
    [allCourses, enrolledIds],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        {/* ----------------------------- MAIN ----------------------------- */}
        <div className="min-w-0 space-y-6">
          {/* Header */}
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <h1 className="font-display text-3xl md:text-4xl">My Courses</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick up where you left off and explore what's next.
            </p>
          </motion.div>

          {/* Continue learning hero */}
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-6 text-primary-foreground shadow-lg md:p-7">
              <div aria-hidden className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
              <div aria-hidden className="absolute -bottom-16 -right-4 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
              <p className="relative text-xs font-medium uppercase tracking-widest text-primary-foreground/80">
                Continue learning
              </p>
              {continueCourse ? (
                <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
                  <div className="min-w-0">
                    <h2 className="mt-2 font-display text-2xl leading-tight md:text-3xl">{continueCourse.title}</h2>
                    <p className="mt-1 text-sm text-primary-foreground/80">
                      {continueCourse.done}/{continueCourse.total || "—"} lessons complete · {continueCourse.pct}%
                    </p>
                    <div className="mt-4 h-2 w-full max-w-md overflow-hidden rounded-full bg-white/25">
                      <motion.div
                        className="h-full rounded-full bg-white"
                        initial={{ width: 0 }}
                        animate={{ width: `${continueCourse.pct}%` }}
                        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                      />
                    </div>
                  </div>
                  <Link
                    to="/courses/$slug"
                    params={{ slug: continueCourse.slug }}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
                  >
                    <Play className="h-4 w-4 fill-primary" /> Resume
                  </Link>
                </div>
              ) : (
                <div className="relative">
                  <h2 className="mt-2 font-display text-2xl leading-tight md:text-3xl">Start your first course</h2>
                  <p className="mt-1 max-w-md text-sm text-primary-foreground/80">
                    Enroll below to begin tracking your progress here.
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Enrolled / in progress */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl">Enrolled courses</h2>
              <span className="text-sm text-muted-foreground">{stats.perCourse.length} active</span>
            </div>
            {stats.perCourse.length > 0 ? (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                whileInView="show"
                viewport={viewportOnce}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {stats.perCourse.map((c: any) => (
                  <motion.div key={c.id} variants={staggerItem} whileHover={{ y: -4 }}>
                    <Link
                      to="/courses/$slug"
                      params={{ slug: c.slug }}
                      className="group block h-full rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-lg"
                    >
                      <div className="flex items-center justify-between">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                          <BookOpen className="h-5 w-5" />
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </div>
                      <h3 className="mt-3 line-clamp-1 font-display text-lg">{c.title}</h3>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {c.total > 0 ? `${c.total} lessons` : c.summary || "Lessons coming soon"}
                      </p>
                      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: 0 }}
                          whileInView={{ width: `${c.pct}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{c.pct}% complete</p>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
                <p className="text-sm text-muted-foreground">You haven't enrolled in any course yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">Explore the catalog below to get started.</p>
              </div>
            )}
          </section>

          {/* Explore more */}
          {exploreCourses.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Compass className="h-5 w-5 text-primary" />
                <h2 className="font-display text-xl">Explore more courses</h2>
              </div>
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                whileInView="show"
                viewport={viewportOnce}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {exploreCourses.map((c: any) => (
                  <motion.div key={c.id} variants={staggerItem} whileHover={{ y: -4 }}>
                    <Link
                      to="/courses/$slug"
                      params={{ slug: c.slug }}
                      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-lg"
                    >
                      <div className="flex items-center justify-between">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                          <BookOpen className="h-5 w-5" />
                        </span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          New
                        </span>
                      </div>
                      <h3 className="mt-3 line-clamp-1 font-display text-lg">{c.title}</h3>
                      <p className="mt-0.5 line-clamp-2 flex-1 text-xs text-muted-foreground">{c.summary}</p>
                      <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Plus className="h-3.5 w-3.5" /> Enroll & start
                      </span>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            </section>
          )}
        </div>

        {/* ----------------------------- RIGHT RAIL ----------------------------- */}
        <motion.aside
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-6 xl:sticky xl:top-24 xl:self-start"
        >
          {/* Learning snapshot */}
          <motion.div variants={staggerItem} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <h3 className="font-display text-base">Learning snapshot</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StatTile icon={BookOpen} label="Enrolled" value={String(enrolledCourses.length)} />
              <StatTile icon={GraduationCap} label="Lessons done" value={String(stats.completedLessons)} />
              <StatTile icon={Clock} label="Hours" value={formatHours(stats.totalSeconds)} />
              <StatTile icon={Target} label="Avg score" value={stats.quizzes ? `${stats.avgScore}%` : "—"} />
            </div>
          </motion.div>

          {/* Quick links */}
          <motion.div variants={staggerItem} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <h3 className="font-display text-base">Quick links</h3>
            <div className="mt-3 space-y-2">
              <Link
                to="/analytics"
                className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-secondary"
              >
                <span className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" /> Progress & Analytics
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link
                to="/courses"
                className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-secondary"
              >
                <span className="flex items-center gap-2">
                  <Compass className="h-4 w-4 text-primary" /> Full catalog
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </div>
          </motion.div>
        </motion.aside>
      </div>
    </main>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-2 font-display text-2xl leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
