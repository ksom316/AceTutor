import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
  Clock,
  History,
  Lightbulb,
  Puzzle,
  Target,
  Timer,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { attemptStatus } from "@/lib/quiz-timer";
import {
  DEFAULT_STATS,
  formatDuration as formatClock,
  GAME_LABELS,
  loadStats,
  type GameStats,
} from "@/lib/game-stats";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";
import { secondsBySurface, SURFACE_LABELS } from "@/lib/study-time";

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

/** Cap the quiz-attempt history to a reasonable page. */
const HISTORY_LIMIT = 100;

type HistoryRow = {
  id: string;
  score: number | null;
  total: number | null;
  answered_count: number | null;
  started_at: string | null;
  finished_at: string | null;
  timed_out: boolean | null;
  expires_at: string | null;
  topic_id: string | null;
  course_quiz_id: string | null;
  topics: { title: string; courses: { title: string } | null } | null;
  course_quizzes: { title: string; courses: { title: string } | null } | null;
};

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
type SessionRow = {
  course_id: string | null;
  surface: string;
  started_at: string;
  seconds: number;
  courses: AnalyticsCourse | null;
};

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

/* Compact stat tile used inside the game summary card. */
function GameTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-1.5 font-display text-xl leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/* A donut segment's members, listed by name. Rendered from the same set that
 * produces the segment count, so the list length always matches the chart.
 * Scrolls past a handful of rows to stay compact. */
function NameList({
  label,
  color,
  names,
  emptyHint,
}: {
  label: string;
  color: string;
  names: string[];
  emptyHint: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
        <span className="font-medium normal-case tracking-normal">({names.length})</span>
      </p>
      {names.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto pr-1 text-xs text-foreground">
          {names.map((n, i) => (
            <li key={`${i}-${n}`} className="truncate">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
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

  // Every quiz attempt (finished or not) per topic — the same data and query
  // key the dashboard uses, so react-query serves it from one cache. Drives the
  // Lesson completion card: a topic is "completed" once it has a finished
  // attempt, "started" once it has any attempt.
  const moduleAttemptsQuery = useQuery({
    queryKey: ["dash-module-attempts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_attempts")
        .select("topic_id, finished_at")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // The student's enrolled courses (same query key/shape the dashboard uses).
  const enrollmentsQuery = useQuery({
    queryKey: ["dash-enrollments", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollments")
        .select("course_id, created_at, courses(id, slug, title, summary)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const enrolledCourseIds = useMemo(
    () =>
      ((enrollmentsQuery.data ?? []) as unknown as { course_id: string | null }[])
        .map((e) => e.course_id)
        .filter((id): id is string => !!id),
    [enrollmentsQuery.data],
  );

  // Topics belonging to the enrolled courses — the only ones the Lesson
  // completion card is allowed to count. Same query pattern as the dashboard.
  const enrolledTopicsQuery = useQuery({
    queryKey: ["dash-topics", enrolledCourseIds],
    enabled: enrolledCourseIds.length > 0,
    queryFn: async () => {
      // Same query key + column set as useStudentDashboard's `dash-topics` so the
      // two share one cache entry. `title` also backs the lesson-completion list.
      const { data, error } = await supabase
        .from("topics")
        .select("id, course_id, title")
        .in("course_id", enrolledCourseIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Active time spent on learning surfaces, recorded by the study-time tracker
  // (see src/hooks/use-study-time.tsx).
  const sessionsQuery = useQuery({
    queryKey: ["analytics-study-sessions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("study_sessions")
        .select("course_id, surface, started_at, seconds, courses(id, title, slug)")
        .eq("user_id", user!.id)
        .gt("seconds", 0)
        .order("started_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Full quiz-attempt history for the signed-in student — module quizzes AND
  // General Course Quizzes, finished or in progress. RLS (`attempts_select_own`)
  // is the boundary; the extra `.eq("user_id", …)` is defence in depth. Capped
  // at a sensible page so a very active account doesn't pull an unbounded set.
  const historyQuery = useQuery({
    queryKey: ["analytics-attempt-history", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_attempts")
        .select(
          "id, score, total, answered_count, started_at, finished_at, timed_out, expires_at, topic_id, course_quiz_id, topics(title, courses(title)), course_quizzes(title, courses(title))",
        )
        .eq("user_id", user!.id)
        .order("started_at", { ascending: false })
        .limit(HISTORY_LIMIT);
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    progressQuery,
    attemptsQuery,
    moduleAttemptsQuery,
    enrolledTopicsQuery,
    sessionsQuery,
    historyQuery,
  };
}

/**
 * Crossword results are kept per-user in localStorage (see src/lib/game-stats.ts),
 * so they're read on the client after mount rather than fetched.
 */
function useGameStats(): GameStats {
  const { user } = useAuth();
  const [stats, setStats] = useState<GameStats>(DEFAULT_STATS);

  useEffect(() => {
    if (user) setStats(loadStats(user.id));
  }, [user]);

  return stats;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function AnalyticsPage() {
  const {
    progressQuery,
    attemptsQuery,
    moduleAttemptsQuery,
    enrolledTopicsQuery,
    sessionsQuery,
    historyQuery,
  } = useAnalyticsData();
  const gameStats = useGameStats();
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
  const moduleAttempts = useMemo(
    () =>
      (moduleAttemptsQuery.data ?? []) as unknown as {
        topic_id: string | null;
        finished_at: string | null;
      }[],
    [moduleAttemptsQuery.data],
  );
  const sessions = useMemo(
    () => (sessionsQuery.data ?? []) as unknown as SessionRow[],
    [sessionsQuery.data],
  );
  // Topics that belong to the student's enrolled courses (id + title).
  const enrolledTopics = useMemo(
    () =>
      (enrolledTopicsQuery.data ?? []) as unknown as {
        id: string;
        course_id: string;
        title: string;
      }[],
    [enrolledTopicsQuery.data],
  );
  const enrolledTopicIds = useMemo(
    () => new Set(enrolledTopics.map((t) => t.id)),
    [enrolledTopics],
  );
  const topicTitleById = useMemo(
    () => new Map(enrolledTopics.map((t) => [t.id, t.title])),
    [enrolledTopics],
  );
  const loading = progressQuery.isLoading || attemptsQuery.isLoading || sessionsQuery.isLoading;

  const history = useMemo<HistoryRow[]>(
    () => (historyQuery.data ?? []) as unknown as HistoryRow[],
    [historyQuery.data],
  );

  /* ---- Derived datasets ---------------------------------------- */

  // Where the time went: modules, course pages, quizzes, games.
  const perSurface = useMemo(
    () =>
      secondsBySurface(sessions).map(({ surface, seconds }) => ({
        name: SURFACE_LABELS[surface],
        seconds,
      })),
    [sessions],
  );

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

  // Quiz score trend over time
  const scoreTrend = useMemo(() => {
    return attempts.map((a, i) => ({
      idx: i + 1,
      label: a.finished_at ? dayKey(new Date(a.finished_at)) : `#${i + 1}`,
      score: a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : 0,
      topic: a.topics?.title ?? "Quiz",
    }));
  }, [attempts]);

  // Puzzle solves, oldest first, for the time-trend chart.
  const gameTrend = useMemo(
    () =>
      [...gameStats.history].reverse().map((h, i) => ({
        idx: i + 1,
        label: dayKey(new Date(h.at)),
        seconds: h.seconds,
        minutes: Math.round((h.seconds / 60) * 10) / 10,
        hints: h.hints,
        course: `${h.course} · ${GAME_LABELS[h.game ?? "crossword"]}`,
      })),
    [gameStats.history],
  );

  // Solves split by game, so the summary can show what's been played.
  const solvesByGame = useMemo(() => {
    const counts = { crossword: 0, wordsearch: 0 };
    for (const h of gameStats.history) counts[h.game ?? "crossword"] += 1;
    return counts;
  }, [gameStats.history]);

  // Best time per course *and* game — the stored key already reads as a label.
  const gameBest = useMemo(
    () =>
      Object.entries(gameStats.best)
        .map(([name, seconds]) => ({ name, seconds }))
        .sort((a, b) => a.seconds - b.seconds),
    [gameStats.best],
  );

  const gameAvgSeconds = useMemo(() => {
    if (gameStats.history.length === 0) return 0;
    const sum = gameStats.history.reduce((s, h) => s + h.seconds, 0);
    return Math.round(sum / gameStats.history.length);
  }, [gameStats.history]);

  const hasGameData = gameStats.solved > 0;

  /* ---- KPIs ----------------------------------------------------- */

  const totalQuizzes = attempts.length;
  const avgScore = useMemo(() => {
    if (!attempts.length) return 0;
    const sum = attempts.reduce((s, a) => s + (a.total ? ((a.score ?? 0) / a.total) * 100 : 0), 0);
    return Math.round(sum / attempts.length);
  }, [attempts]);

  // Lesson completion — same topic/quiz-attempt classification the dashboard
  // uses, restricted to topics of the student's ENROLLED courses. A topic is
  // "completed" once it has a finished quiz attempt and "started" once it has
  // any attempt (finished ones included), so completed can never exceed started.
  // Multiple attempts on one topic count once (Set). The `progress` table is
  // deliberately NOT used here. The ring and the centre percentage both read
  // `pct`.
  const lessonStats = useMemo(() => {
    const started = new Set<string>();
    const completed = new Set<string>();
    for (const a of moduleAttempts) {
      if (!a.topic_id || !enrolledTopicIds.has(a.topic_id)) continue;
      started.add(a.topic_id);
      if (a.finished_at) completed.add(a.topic_id);
    }
    const pct = started.size > 0 ? Math.round((completed.size / started.size) * 100) : 0;
    // Name lists straight from the same sets that produce the counts, so the
    // lists can never disagree with the donut. "In progress" is the started set
    // minus the completed set (completed + inProgress === started).
    const nameOf = (id: string) => topicTitleById.get(id) ?? "Untitled module";
    const completedList = [...completed].map(nameOf).sort((a, b) => a.localeCompare(b));
    const inProgressList = [...started]
      .filter((id) => !completed.has(id))
      .map(nameOf)
      .sort((a, b) => a.localeCompare(b));
    return {
      started: started.size,
      completed: completed.size,
      pct,
      completedList,
      inProgressList,
    };
  }, [moduleAttempts, enrolledTopicIds, topicTitleById]);

  const completionData = useMemo(
    () => [{ name: "Completed", value: lessonStats.pct, fill: "var(--chart-1)" }],
    [lessonStats.pct],
  );

  // Full attempt history — one row per quiz_attempts row, newest first.
  const historyRows = useMemo(
    () =>
      history.map((r) => {
        const isModule = !!r.topic_id;
        const rel = isModule ? r.topics : r.course_quizzes;
        const title = rel?.title ?? (isModule ? "Module quiz" : "General Course Quiz");
        const finished = !!r.finished_at;
        const pct = finished && r.total ? Math.round(((r.score ?? 0) / r.total) * 100) : null;
        const expired = !finished && !!r.expires_at && Date.now() >= Date.parse(r.expires_at);
        return {
          id: r.id,
          title,
          courseTitle: rel?.courses?.title ?? null,
          isModule,
          finished,
          score: r.score,
          total: r.total,
          pct,
          status: attemptStatus({
            finished,
            answered: r.answered_count,
            total: r.total,
            timedOut: r.timed_out ?? false,
            expired,
          }),
          date: r.finished_at ?? r.started_at,
        };
      }),
    [history],
  );

  const kpis = [
    {
      label: "Quizzes completed",
      icon: Trophy,
      value: totalQuizzes,
      fmt: (n: number) => `${Math.round(n)}`,
    },
    {
      label: "Average quiz score",
      icon: Target,
      value: avgScore,
      fmt: (n: number) => `${Math.round(n)}%`,
    },
    {
      label: "Puzzles solved",
      icon: Puzzle,
      value: gameStats.solved,
      fmt: (n: number) => `${Math.round(n)}`,
    },
  ];

  const hasData =
    !loading &&
    (progress.length > 0 ||
      attempts.length > 0 ||
      moduleAttempts.length > 0 ||
      historyRows.length > 0 ||
      hasGameData ||
      sessions.length > 0);

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
        <div className="mt-12 grid gap-6 md:grid-cols-2">
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
            Start a lesson, take a quiz, or solve a puzzle in Games — your time spent, scores and
            usage analytics will appear here automatically.
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
            className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3"
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
            className="mt-6 grid gap-6 md:grid-cols-2"
          >
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
              <div className="mt-3 flex items-center justify-center gap-6 text-xs text-muted-foreground">
                <span>
                  Completed:{" "}
                  <span className="font-semibold text-foreground">
                    {lessonStats.completed} {lessonStats.completed === 1 ? "lesson" : "lessons"}
                  </span>
                </span>
                <span>
                  Started:{" "}
                  <span className="font-semibold text-foreground">
                    {lessonStats.started} {lessonStats.started === 1 ? "lesson" : "lessons"}
                  </span>
                </span>
              </div>

              {lessonStats.started > 0 && (
                <div className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                  <NameList
                    label="Completed"
                    color="var(--chart-1)"
                    names={lessonStats.completedList}
                    emptyHint="None completed yet"
                  />
                  <NameList
                    label="In progress"
                    color="var(--chart-2)"
                    names={lessonStats.inProgressList}
                    emptyHint="Nothing in progress"
                  />
                </div>
              )}
            </ChartCard>

            {/* Where the time goes — Column */}
            {perSurface.length > 0 && (
              <ChartCard
                title="Where your time goes"
                subtitle="Active minutes by part of the app"
                icon={Activity}
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={perSurface.map((s) => ({
                        name: s.name,
                        minutes: Math.round(s.seconds / 60),
                      }))}
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
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        cursor={{ fill: "var(--secondary)", opacity: 0.4 }}
                        formatter={(v: number) => [`${v} min`, "Studied"]}
                      />
                      <Bar dataKey="minutes" radius={[0, 6, 6, 0]} animationDuration={900}>
                        {perSurface.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            )}

            {/* Quiz score trend — Line */}
            {scoreTrend.length > 0 && (
              <ChartCard
                title="Quiz score trend"
                subtitle="Your score % across quizzes over time"
                icon={TrendingUp}
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

          {/* Quiz attempt history — the signed-in student's own attempts only
              (RLS `attempts_select_own`); module quizzes + General Course
              Quizzes, finished or in progress. */}
          <motion.section
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="mt-6 rounded-2xl border border-border bg-card p-5"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-display text-xl leading-tight">Quiz attempt history</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Every module quiz and General Course Quiz attempt on your account
                </p>
              </div>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <History className="h-4 w-4" />
              </span>
            </div>

            {historyQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/60" />
                ))}
              </div>
            ) : historyQuery.isError ? (
              <p className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-destructive">
                Couldn&apos;t load your quiz history. Please refresh to try again.
              </p>
            ) : historyRows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
                No quiz attempts yet — take a quiz and it&apos;ll show up here.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 font-medium">Quiz</th>
                        <th className="pb-2 font-medium">Course</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 text-right font-medium">Score</th>
                        <th className="pb-2 text-right font-medium">%</th>
                        <th className="pb-2 pl-3 font-medium">Status</th>
                        <th className="pb-2 pl-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {historyRows.map((r) => (
                        <tr key={r.id}>
                          <td className="max-w-[10rem] truncate py-2 pr-2 font-medium">
                            {r.title}
                          </td>
                          <td className="max-w-[9rem] truncate py-2 pr-2 text-muted-foreground">
                            {r.courseTitle ?? "—"}
                          </td>
                          <td className="py-2 pr-2">
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                              {r.isModule ? "Module" : "General"}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {r.finished ? `${r.score ?? 0}/${r.total ?? 0}` : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {r.pct == null ? "—" : `${r.pct}%`}
                          </td>
                          <td className="py-2 pl-3">
                            <span
                              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
                                r.status.key === "completed-full"
                                  ? "border-success/40 bg-success/10 text-success"
                                  : r.status.key === "completed-incomplete"
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                                    : "border-border bg-muted text-muted-foreground"
                              }`}
                            >
                              {r.status.marker} {r.status.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-2 pl-3 text-muted-foreground">
                            {r.date
                              ? new Date(r.date).toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {historyRows.length >= HISTORY_LIMIT && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing your most recent {HISTORY_LIMIT} attempts.
                  </p>
                )}
              </>
            )}
          </motion.section>

          {/* Word games */}
          {hasGameData && (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={viewportOnce}
              className="mt-6 grid gap-6 lg:grid-cols-3"
            >
              {/* Solve-time trend */}
              <ChartCard
                title="Puzzle solve times"
                subtitle="How quickly you finish each crossword and word search"
                icon={Puzzle}
                className="lg:col-span-2"
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={gameTrend} margin={{ left: -18, right: 8, top: 6 }}>
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
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        unit="m"
                      />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(
                          _v: number,
                          _n,
                          p: { payload?: { seconds?: number; course?: string } },
                        ) => [formatClock(p?.payload?.seconds ?? 0), p?.payload?.course ?? "Solve"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="minutes"
                        stroke="var(--chart-3)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "var(--chart-3)" }}
                        activeDot={{ r: 6 }}
                        animationDuration={1000}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              {/* Game summary */}
              <ChartCard title="Game summary" subtitle="Your puzzle record so far" icon={Trophy}>
                <div className="grid grid-cols-2 gap-3">
                  <GameTile icon={Puzzle} label="Solved" value={String(gameStats.solved)} />
                  <GameTile
                    icon={Timer}
                    label="Best time"
                    value={gameBest.length > 0 ? formatClock(gameBest[0].seconds) : "—"}
                  />
                  <GameTile
                    icon={Clock}
                    label="Average"
                    value={gameAvgSeconds ? formatClock(gameAvgSeconds) : "—"}
                  />
                  <GameTile
                    icon={Lightbulb}
                    label="Hints used"
                    value={String(gameStats.hintsUsed)}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {solvesByGame.crossword} crossword
                  {solvesByGame.crossword === 1 ? "" : "s"} · {solvesByGame.wordsearch} word search
                  {solvesByGame.wordsearch === 1 ? "" : "es"}
                </p>
                {gameBest.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Best time by course &amp; game
                    </p>
                    {gameBest.slice(0, 4).map((g, i) => (
                      <div
                        key={g.name}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-6 w-1.5 shrink-0 rounded-full"
                            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                          <span className="truncate">{g.name}</span>
                        </span>
                        <span className="shrink-0 font-semibold text-primary">
                          {formatClock(g.seconds)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ChartCard>
            </motion.div>
          )}
        </>
      )}
    </main>
  );
}
