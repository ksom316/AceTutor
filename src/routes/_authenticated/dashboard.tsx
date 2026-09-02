import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock,
  GraduationCap,
  Play,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudentDashboard, type ModuleBreakdownItem } from "@/hooks/use-student-dashboard";
import { COURSE_CTA_LABEL, courseCtaState } from "@/lib/course-progress";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--muted)"];

function formatHours(seconds: number) {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)}`;
  return h.toFixed(1).replace(/\.0$/, "");
}

function Dashboard() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["dash-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: learningPrefs } = useQuery({
    queryKey: ["learning-preferences", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_preferences")
        .select("explanation_style, lesson_format, wrong_answer_help")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });
  const hasPreferences = !!(
    learningPrefs?.explanation_style ||
    learningPrefs?.lesson_format ||
    learningPrefs?.wrong_answer_help
  );

  const { data: avatarUrl } = useQuery({
    queryKey: ["dash-avatar", profile?.avatar_url],
    enabled: !!profile?.avatar_url,
    queryFn: async () => {
      // Google OAuth avatars are stored as full https URLs (synced by
      // /auth/callback) — use them directly. Only storage paths need signing.
      if (profile!.avatar_url!.startsWith("http")) return profile!.avatar_url!;
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile!.avatar_url!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const {
    enrolledCourses,
    perCourse,
    overallPct,
    donut,
    moduleBreakdown,
    continueCourse,
    recommended,
    recentAttempts: attempts,
    quizzes,
    avgScore,
    totalSeconds,
  } = useStudentDashboard(user?.id);

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const displayName = profile?.full_name || user?.email?.split("@")[0] || "Learner";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const donutHasData = donut.some((d) => d.value > 0);

  // The ring is a fill gauge for the same module percentage shown in the centre;
  // the Completed / In Progress / Not Started counts are listed beneath it.
  const ring = [
    { name: "Completed", value: overallPct },
    { name: "Remaining", value: Math.max(0, 100 - overallPct) },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        {/* ----------------------------- MAIN ----------------------------- */}
        <div className="min-w-0 space-y-6">
          {/* Welcome */}
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Dashboard
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl">
              {firstName}'s learning overview
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Progress, study time, and quiz history across every course.
            </p>
          </motion.div>

          {/* Continue learning (full width) with Progress stacked below it — two
              independent cards so neither stretches to match the other. */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="space-y-6"
          >
            {/* Continue learning — full width */}
            <motion.div
              variants={staggerItem}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-6 text-primary-foreground shadow-lg md:p-7"
            >
              <div
                aria-hidden
                className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-2xl"
              />
              <div
                aria-hidden
                className="absolute -bottom-16 -right-4 h-40 w-40 rounded-full bg-white/10 blur-2xl"
              />
              <p className="relative text-xs font-medium uppercase tracking-widest text-primary-foreground/80">
                {continueCourse && courseCtaState(continueCourse.pct) === "review"
                  ? "Course complete"
                  : "Continue learning"}
              </p>
              {continueCourse ? (
                <>
                  <h2 className="relative mt-2 font-display text-2xl leading-tight md:text-3xl">
                    {continueCourse.title}
                  </h2>
                  <p className="relative mt-1 text-sm text-primary-foreground/80">
                    {continueCourse.done}/{continueCourse.total || "—"} lessons complete
                  </p>
                  <div className="relative mt-5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/25">
                    <motion.div
                      className="h-full rounded-full bg-white"
                      initial={{ width: 0 }}
                      animate={{ width: `${continueCourse.pct}%` }}
                      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                    />
                  </div>
                  <p className="relative mt-1.5 text-xs text-primary-foreground/80">
                    {continueCourse.pct}% complete
                  </p>
                  <Link
                    to="/courses/$slug"
                    params={{ slug: continueCourse.slug }}
                    className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
                  >
                    <Play className="h-4 w-4 fill-primary" />{" "}
                    {COURSE_CTA_LABEL[courseCtaState(continueCourse.pct)]}
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="relative mt-2 font-display text-2xl leading-tight md:text-3xl">
                    Start your first course
                  </h2>
                  <p className="relative mt-1 max-w-sm text-sm text-primary-foreground/80">
                    Browse the catalog and enroll to begin tracking your progress here.
                  </p>
                  <Link
                    to="/courses"
                    className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
                  >
                    <BookOpen className="h-4 w-4" /> Browse courses
                  </Link>
                </>
              )}
            </motion.div>

            {/* Progress — full width; donut on the left, module lists on the right */}
            <motion.div
              variants={staggerItem}
              className="rounded-3xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg">Your progress</h2>
                <Target className="h-4 w-4 text-primary" />
              </div>

              <div className="mt-4 grid gap-6 sm:grid-cols-[minmax(0,190px)_1fr] sm:items-start">
                {/* Donut */}
                <div className="relative mx-auto h-40 w-40 shrink-0 sm:mx-0">
                  {donutHasData ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={ring}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={70}
                          paddingAngle={3}
                          stroke="var(--card)"
                          strokeWidth={2}
                          startAngle={90}
                          endAngle={-270}
                        >
                          <Cell fill={CHART_COLORS[0]} />
                          <Cell fill={CHART_COLORS[2]} />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-center">
                      <div>
                        <div className="font-display text-3xl">{overallPct}%</div>
                        <div className="text-[11px] text-muted-foreground">overall</div>
                      </div>
                    </div>
                  )}
                  {donutHasData && (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="text-center">
                        <div className="font-display text-3xl">{overallPct}%</div>
                        <div className="text-[11px] text-muted-foreground">overall</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Module lists */}
                <div className="min-w-0">
                  <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                    {donut.map((d, i) => (
                      <li key={d.name} className="flex items-center gap-2 text-muted-foreground">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: CHART_COLORS[i] }}
                        />
                        <span>{d.name}</span>
                        <span className="font-semibold text-foreground">{d.value}</span>
                      </li>
                    ))}
                  </ul>

                  {moduleBreakdown.completed.length > 0 || moduleBreakdown.inProgress.length > 0 ? (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <ModuleStatusList
                        label="In Progress"
                        color={CHART_COLORS[1]}
                        items={moduleBreakdown.inProgress}
                      />
                      <ModuleStatusList
                        label="Completed"
                        color={CHART_COLORS[0]}
                        items={moduleBreakdown.completed}
                      />
                    </div>
                  ) : (
                    <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                      Take a module quiz to see your completed and in-progress modules here.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* My courses */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl">My courses</h2>
              <Link
                to="/my-courses"
                className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
            {perCourse.length > 0 ? (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                whileInView="show"
                viewport={viewportOnce}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {perCourse.map((c) => (
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
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.total > 0 ? `${c.total} lessons` : "Lessons coming soon"}
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
                      <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">
                        {c.pct}% complete
                      </p>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  You're not enrolled in any course yet.
                </p>
                <Link
                  to="/courses"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
                >
                  Browse courses <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </section>

          {/* Recent quiz attempts */}
          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg">Recent quiz attempts</h2>
              <Trophy className="h-4 w-4 text-primary" />
            </div>
            {attempts && attempts.length > 0 ? (
              <ul className="divide-y divide-border/70">
                {attempts.map((a) => {
                  const pct = a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : 0;
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {a.title}
                          {a.kind === "general" && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              · General
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{a.courseTitle}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          pct >= 70 ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
                        }`}
                      >
                        {a.score ?? 0}/{a.total ?? 0} · {pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No quizzes yet — take one to see your scores here.
              </p>
            )}
          </section>
        </div>

        {/* ----------------------------- RIGHT RAIL ----------------------------- */}
        <motion.aside
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-6 xl:sticky xl:top-24 xl:self-start"
        >
          {/* Profile card */}
          <motion.div
            variants={staggerItem}
            className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"
          >
            <div className="h-20 bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)]" />
            <div className="-mt-10 flex flex-col items-center px-5 pb-5 text-center">
              <Avatar className="h-20 w-20 border-4 border-card shadow-md">
                <AvatarImage src={avatarUrl ?? undefined} alt={displayName} />
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <h3 className="mt-3 font-display text-lg">{displayName}</h3>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              <Link
                to="/profile"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
              >
                Edit profile
              </Link>
            </div>
          </motion.div>

          {/* Stat tiles */}
          <motion.div variants={staggerItem} className="grid grid-cols-2 gap-3">
            <StatTile icon={BookOpen} label="Courses" value={String(enrolledCourses.length)} />
            <StatTile icon={Trophy} label="Quizzes" value={String(quizzes)} />
            {/* <StatTile icon={Clock} label="Hours" value={formatHours(totalSeconds)} /> */}
            <StatTile icon={Target} label="Avg score" value={quizzes ? `${avgScore}%` : "—"} />
          </motion.div>

          {/* Learning preferences nudge */}
          {!hasPreferences && (
            <motion.div variants={staggerItem}>
              <Link
                to="/onboarding/preferences"
                className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/10 p-4 transition-colors hover:bg-primary/15"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">Personalize your learning</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Tell AceTutor how you prefer explanations and lesson formats.
                  </p>
                </div>
              </Link>
            </motion.div>
          )}

          {/* Recommended */}
          {recommended.length > 0 && (
            <motion.div
              variants={staggerItem}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="font-display text-base">Pick up next</h3>
              </div>
              <ul className="space-y-1">
                {recommended.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/courses/$slug"
                      params={{ slug: c.slug }}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-secondary"
                    >
                      <span className="truncate">{c.title}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </motion.aside>
      </div>
    </main>
  );
}

/** Names of the modules behind one donut segment. Rendered straight from
 *  `moduleBreakdown` so the list length always equals the donut count. Scrolls
 *  past a handful of rows so a course with many modules doesn't stretch the card. */
function ModuleStatusList({
  label,
  color,
  items,
}: {
  label: string;
  color: string;
  items: ModuleBreakdownItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
        <span className="font-medium normal-case tracking-normal">({items.length})</span>
      </p>
      <ul className="mt-1.5 max-h-36 space-y-1.5 overflow-y-auto pr-1">
        {items.map((m) => (
          <li key={m.id} className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="truncate text-sm text-foreground">{m.title}</span>
            {m.courseTitle && (
              <span className="shrink-0 truncate text-xs text-muted-foreground">
                {m.courseTitle}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
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
