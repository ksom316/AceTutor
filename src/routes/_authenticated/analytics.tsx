import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BarChart3,
  BookOpen,
  Clock,
  Flame,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                  */
/* ------------------------------------------------------------------ */

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const DAY_MS = 24 * 60 * 60 * 1000;

type AnalyticsCourse = { id: string; title: string; slug: string };
type ProgressRow = {
  watched_seconds: number | null;
  completed_at: string | null;
  updated_at: string | null;
  lessons: {
    title: string;
    duration_sec: number | null;
    topics: { title: string; courses: AnalyticsCourse | null } | null;
  } | null;
};
type AttemptRow = {
  score: number | null;
  total: number | null;
  started_at: string | null;
  finished_at: string | null;
  topics: { title: string; courses: AnalyticsCourse | null } | null;
};

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function dayKey(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* Animated number that counts up when scrolled into view. */
function Counter({
  value,
  format = (n: number) => Math.round(n).toLocaleString(),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (latest) => format(latest));
  const [display, setDisplay] = useState(format(0));

  useEffect(() => {
    const unsub = rounded.on("change", setDisplay);
    return unsub;
  }, [rounded]);

  useEffect(() => {
    if (inView) {
      const controls = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
      return controls.stop;
    }
  }, [inView, value, mv]);

  return <span ref={ref}>{display}</span>;
}

/* Card wrapper with a scroll reveal + hover lift. */
function ChartCard({
  title,
  subtitle,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      variants={staggerItem}
      whileHover={{ y: -4 }}
      className={`group rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-lg ${className}`}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl leading-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {children}
    </motion.section>
  );
}

/* Shared recharts tooltip styling. */
const tooltipStyle = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "0.75rem",
    fontSize: "0.8rem",
    boxShadow: "0 10px 30px -12px rgba(0,0,0,0.35)",
  },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--muted-foreground)" },
};

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function useAnalyticsData() {
  const { user } = useAuth();

  const progressQuery = useQuery({
    queryKey: ["analytics-progress", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progress")
        .select(
          "watched_seconds, completed_at, updated_at, lessons(title, duration_sec, topics(title, courses(id, title, slug)))",
        )
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const attemptsQuery = useQuery({
    queryKey: ["analytics-attempts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_attempts")
        .select("score, total, started_at, finished_at, topics(title, courses(id, title, slug))")
        .eq("user_id", user!.id)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return { progressQuery, attemptsQuery };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function AnalyticsPage() {
  const { progressQuery, attemptsQuery } = useAnalyticsData();
  // Memoize the fallbacks so the empty-array reference is stable across renders
  // (otherwise every dependent useMemo re-runs on each render while loading).
  const progress = useMemo(
    () => (progressQuery.data ?? []) as unknown as ProgressRow[],
    [progressQuery.data],
  );
  const attempts = useMemo(
    () => (attemptsQuery.data ?? []) as unknown as AttemptRow[],
    [attemptsQuery.data],
  );
  const loading = progressQuery.isLoading || attemptsQuery.isLoading;

  /* ---- Derived datasets ---------------------------------------- */

  // Time spent per course (sum watched_seconds across lessons in course)
  const perCourse = useMemo(() => {
    const map = new Map<
      string,
      { name: string; seconds: number; lessons: number; completed: number }
    >();
    for (const row of progress) {
      const course = row.lessons?.topics?.courses;
      if (!course) continue;
      const entry = map.get(course.id) ?? {
        name: course.title,
        seconds: 0,
        lessons: 0,
        completed: 0,
      };
      entry.seconds += row.watched_seconds ?? 0;
      entry.lessons += 1;
      if (row.completed_at) entry.completed += 1;
      map.set(course.id, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [progress]);

  // Quiz performance per course (avg score %)
  const scorePerCourse = useMemo(() => {
    const map = new Map<string, { name: string; pct: number[] }>();
    for (const a of attempts) {
      const course = a.topics?.courses;
      if (!course || !a.total) continue;
      const entry = map.get(course.id) ?? { name: course.title, pct: [] as number[] };
      entry.pct.push(((a.score ?? 0) / a.total) * 100);
      map.set(course.id, entry);
    }
    return Array.from(map.values()).map((e) => ({
      name: e.name,
      avg: Math.round(e.pct.reduce((s, v) => s + v, 0) / e.pct.length),
      attempts: e.pct.length,
    }));
  }, [attempts]);

  // Study activity over the last 14 days (active lessons touched + minutes)
  const activity = useMemo(() => {
    const days: { key: string; minutes: number; sessions: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = new Map<string, { minutes: number; sessions: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY_MS);
      const key = dayKey(d);
      buckets.set(key, { minutes: 0, sessions: 0 });
      days.push({ key, minutes: 0, sessions: 0 });
    }
    for (const row of progress) {
      if (!row.updated_at) continue;
      const d = new Date(row.updated_at);
      d.setHours(0, 0, 0, 0);
      const key = dayKey(d);
      const b = buckets.get(key);
      if (b) {
        b.minutes += Math.round((row.watched_seconds ?? 0) / 60);
        b.sessions += 1;
      }
    }
    return days.map((d) => ({ key: d.key, ...buckets.get(d.key)! }));
  }, [progress]);

  // Quiz score trend over time
  const scoreTrend = useMemo(() => {
    return attempts.map((a, i) => ({
      idx: i + 1,
      label: a.finished_at ? dayKey(new Date(a.finished_at)) : `#${i + 1}`,
      score: a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : 0,
      topic: a.topics?.title ?? "Quiz",
    }));
  }, [attempts]);

  /* ---- KPIs ----------------------------------------------------- */
  const totalSeconds = useMemo(() => perCourse.reduce((s, c) => s + c.seconds, 0), [perCourse]);
  const activeCourses = perCourse.length;
  const totalQuizzes = attempts.length;
  const avgScore = useMemo(() => {
    if (!attempts.length) return 0;
    const sum = attempts.reduce((s, a) => s + (a.total ? ((a.score ?? 0) / a.total) * 100 : 0), 0);
    return Math.round(sum / attempts.length);
  }, [attempts]);

  // Study streak: count of distinct active days in last 14 with minutes > 0
  const streak = useMemo(
    () => activity.filter((d) => d.minutes > 0 || d.sessions > 0).length,
    [activity],
  );

  const completionData = useMemo(() => {
    const totalLessons = perCourse.reduce((s, c) => s + c.lessons, 0);
    const completed = perCourse.reduce((s, c) => s + c.completed, 0);
    const pct = totalLessons ? Math.round((completed / totalLessons) * 100) : 0;
    return [{ name: "Completed", value: pct, fill: "var(--chart-1)" }];
  }, [perCourse]);

  const kpis = [
    {
      label: "Total time learning",
      icon: Clock,
      value: totalSeconds,
      fmt: (n: number) => formatDuration(n),
      tint: "text-chart-1",
    },
    {
      label: "Active courses",
      icon: BookOpen,
      value: activeCourses,
      fmt: (n: number) => `${Math.round(n)}`,
    },
    {
      label: "Quizzes completed",
      icon: Trophy,
      value: totalQuizzes,
      fmt: (n: number) => `${Math.round(n)}`,
    },
    {
      label: "Average score",
      icon: Target,
      value: avgScore,
      fmt: (n: number) => `${Math.round(n)}%`,
    },
    {
      label: "Active days (14d)",
      icon: Flame,
      value: streak,
      fmt: (n: number) => `${Math.round(n)}`,
    },
  ];

  const hasData = !loading && (progress.length > 0 || attempts.length > 0);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-12">
      {/* Header */}
      <motion.div variants={fadeUp} initial="hidden" animate="show">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <BarChart3 className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">Your learning insights</p>
            <h1 className="font-display text-4xl leading-tight md:text-5xl">
              Progress &amp; Analytics
            </h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Track the time you spend on each course, see how your quiz scores trend over time, and
          understand how you use AceTutor — all in one place.
        </p>
      </motion.div>

      {loading && (
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl border border-border bg-card/60"
            />
          ))}
        </div>
      )}

      {!loading && !hasData && (
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-16 rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center"
        >
          <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 font-display text-2xl">No activity yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Start a lesson or take a quiz and your time spent, scores and usage analytics will
            appear here automatically.
          </p>
        </motion.div>
      )}

      {hasData && (
        <>
          {/* KPI row */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5"
          >
            {kpis.map((k) => {
              const Icon = k.icon;
              return (
                <motion.div
                  key={k.label}
                  variants={staggerItem}
                  whileHover={{ y: -4 }}
                  className="group rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-4 w-4 text-primary transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <div className="mt-3 font-display text-3xl">
                    <Counter value={k.value} format={k.fmt} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{k.label}</p>
                </motion.div>
              );
            })}
          </motion.div>

          {/* Charts grid */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="mt-6 grid gap-6 lg:grid-cols-3"
          >
            {/* Time per course — Pie */}
            <ChartCard
              title="Time spent per course"
              subtitle="Share of your total learning time"
              icon={Clock}
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={perCourse}
                      dataKey="seconds"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {perCourse.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: number) => [formatDuration(v), "Time"]}
                    />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: "0.72rem", color: "var(--muted-foreground)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            {/* Study activity — Area (14 days) */}
            <ChartCard
              title="Study activity"
              subtitle="Minutes per day over the last 14 days"
              icon={TrendingUp}
              className="lg:col-span-2"
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activity} margin={{ left: -18, right: 8, top: 6 }}>
                    <defs>
                      <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.55} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="key"
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} min`, "Studied"]} />
                    <Area
                      type="monotone"
                      dataKey="minutes"
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      fill="url(#actGrad)"
                      animationDuration={900}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            {/* Time per course — Column */}
            <ChartCard
              title="Minutes by course"
              subtitle="Total minutes watched per course"
              icon={BarChart3}
              className="lg:col-span-2"
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={perCourse.map((c) => ({
                      name: c.name,
                      minutes: Math.round(c.seconds / 60),
                    }))}
                    margin={{ left: -18, right: 8, top: 6 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      {...tooltipStyle}
                      cursor={{ fill: "var(--secondary)", opacity: 0.4 }}
                      formatter={(v: number) => [`${v} min`, "Watched"]}
                    />
                    <Bar dataKey="minutes" radius={[6, 6, 0, 0]} animationDuration={900}>
                      {perCourse.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            {/* Overall completion — Radial */}
            <ChartCard
              title="Lesson completion"
              subtitle="Lessons completed vs started"
              icon={Target}
            >
              <div className="relative h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    innerRadius="68%"
                    outerRadius="100%"
                    data={completionData}
                    startAngle={90}
                    endAngle={-270}
                  >
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar
                      background
                      dataKey="value"
                      cornerRadius={20}
                      animationDuration={1100}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <div className="font-display text-4xl">
                      <Counter
                        value={completionData[0].value}
                        format={(n) => `${Math.round(n)}%`}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">complete</p>
                  </div>
                </div>
              </div>
            </ChartCard>

            {/* Quiz score trend — Line */}
            {scoreTrend.length > 0 && (
              <ChartCard
                title="Quiz score trend"
                subtitle="Your score % across quizzes over time"
                icon={TrendingUp}
                className="lg:col-span-2"
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scoreTrend} margin={{ left: -18, right: 8, top: 6 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(v: number, _n, p: { payload?: { topic?: string } }) => [
                          `${v}%`,
                          p?.payload?.topic ?? "Score",
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="var(--chart-2)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "var(--chart-2)" }}
                        activeDot={{ r: 6 }}
                        animationDuration={1000}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            )}

            {/* Avg score per course — Column */}
            {scorePerCourse.length > 0 && (
              <ChartCard
                title="Average score by course"
                subtitle="How you perform across courses"
                icon={Trophy}
                className={scoreTrend.length > 0 ? "" : "lg:col-span-2"}
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={scorePerCourse}
                      margin={{ left: -18, right: 8, top: 6 }}
                      layout="vertical"
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={90}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        cursor={{ fill: "var(--secondary)", opacity: 0.4 }}
                        formatter={(v: number) => [`${v}%`, "Avg score"]}
                      />
                      <Bar dataKey="avg" radius={[0, 6, 6, 0]} animationDuration={900}>
                        {scorePerCourse.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[(i + 1) % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            )}
          </motion.div>

          {/* Per-course breakdown table */}
          <motion.section
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-display text-xl">Course breakdown</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Time spent and lessons completed per course
              </p>
            </div>
            <div className="divide-y divide-border">
              {perCourse.map((c, i) => {
                const pct = c.lessons ? Math.round((c.completed / c.lessons) * 100) : 0;
                return (
                  <motion.div
                    key={c.name}
                    initial={{ opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.05, duration: 0.4 }}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/40"
                  >
                    <span
                      className="h-9 w-1.5 shrink-0 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{c.name}</span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {formatDuration(c.seconds)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${pct}%` }}
                          viewport={{ once: true }}
                          transition={{
                            delay: i * 0.05 + 0.2,
                            duration: 0.7,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {c.completed}/{c.lessons} lessons complete · {pct}%
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.section>
        </>
      )}
    </main>
  );
}
