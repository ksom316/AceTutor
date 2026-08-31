import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BarChart3, CheckCircle2, Clock, Target, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { fadeUp } from "@/lib/motion";

export const Route = createFileRoute("/lecturer/performance")({
  component: LecturerPerformance,
});

/**
 * One row from get_course_quiz_performance() — one module-quiz attempt in the
 * lecturer's own course. The RPC is SECURITY DEFINER and derives the course from
 * current_lecturer_course(); it never accepts a course id and never returns
 * email / VARK. General Course Quiz attempts (topic_id NULL) are excluded by the
 * RPC's join, so this page is module quizzes only. `finished_at` is null while an
 * attempt is in progress (the generated type flattens it to string).
 */
type QuizPerfRow = {
  attempt_id: string;
  student: string;
  topic: string;
  topic_id: string;
  score: number;
  total: number;
  pct: number;
  started_at: string;
  finished_at: string | null;
  completed: boolean;
};

type StatusFilter = "all" | "completed" | "in-progress";
type SortKey = "recent" | "pct-desc" | "pct-asc" | "student";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Monday 00:00 of the week containing `iso`, as a sortable yyyy-mm-dd key. */
function weekStartKey(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function StatTile({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-14 animate-pulse rounded bg-muted" />
      ) : (
        <p className="mt-2 font-display text-3xl tabular-nums">{value}</p>
      )}
    </div>
  );
}

function LecturerPerformance() {
  const { lecturerCourseId } = useRole();
  const enabled = !!lecturerCourseId;

  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  // Shared query keys with the lecturer dashboard / students page so navigating
  // between them reuses the warm cache.
  const courseQuery = useQuery({
    queryKey: ["lecturer-course", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("title, summary")
        .eq("id", lecturerCourseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const perfQuery = useQuery({
    queryKey: ["lecturer-quiz-performance", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_course_quiz_performance");
      if (error) throw error;
      return (data ?? []) as QuizPerfRow[];
    },
  });

  const studentsQuery = useQuery({
    queryKey: ["lecturer-students", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_course_students");
      if (error) throw error;
      return data ?? [];
    },
  });

  const perf = useMemo<QuizPerfRow[]>(() => perfQuery.data ?? [], [perfQuery.data]);
  const enrolledCount = studentsQuery.data?.length ?? 0;

  const modules = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of perf) map.set(r.topic_id, r.topic);
    return Array.from(map, ([id, title]) => ({ id, title })).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [perf]);

  const summary = useMemo(() => {
    const completed = perf.filter((r) => r.completed);
    const students = new Set(perf.map((r) => r.student));
    const avg = completed.length
      ? Math.round(completed.reduce((s, r) => s + r.pct, 0) / completed.length)
      : 0;
    return {
      total: perf.length,
      completed: completed.length,
      inProgress: perf.length - completed.length,
      avg,
      studentsAssessed: students.size,
    };
  }, [perf]);

  const byModule = useMemo(() => {
    const map = new Map<
      string,
      { topic: string; attempts: number; completed: number; sum: number }
    >();
    for (const r of perf) {
      const e = map.get(r.topic_id) ?? { topic: r.topic, attempts: 0, completed: 0, sum: 0 };
      e.attempts += 1;
      if (r.completed) {
        e.completed += 1;
        e.sum += r.pct;
      }
      map.set(r.topic_id, e);
    }
    return Array.from(map.values())
      .map((e) => ({
        topic: e.topic,
        attempts: e.attempts,
        completed: e.completed,
        avg: e.completed ? Math.round(e.sum / e.completed) : null,
      }))
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
  }, [perf]);

  const byStudent = useMemo(() => {
    const map = new Map<
      string,
      { student: string; attempts: number; completed: number; sum: number; last: string }
    >();
    for (const r of perf) {
      const e = map.get(r.student) ?? {
        student: r.student,
        attempts: 0,
        completed: 0,
        sum: 0,
        last: r.started_at,
      };
      e.attempts += 1;
      const activity = r.completed && r.finished_at ? r.finished_at : r.started_at;
      if (new Date(activity) > new Date(e.last)) e.last = activity;
      if (r.completed) {
        e.completed += 1;
        e.sum += r.pct;
      }
      map.set(r.student, e);
    }
    return Array.from(map.values())
      .map((e) => ({
        student: e.student,
        attempts: e.attempts,
        completed: e.completed,
        avg: e.completed ? Math.round(e.sum / e.completed) : null,
        last: e.last,
      }))
      .sort((a, b) => a.student.localeCompare(b.student));
  }, [perf]);

  // Weekly trend of completed-attempt averages — clean to derive from finished_at
  // alone. Shows the most recent 8 weeks that have at least one completed attempt.
  const trend = useMemo(() => {
    const map = new Map<string, { sum: number; n: number }>();
    for (const r of perf) {
      if (!r.completed || !r.finished_at) continue;
      const key = weekStartKey(r.finished_at);
      const e = map.get(key) ?? { sum: 0, n: 0 };
      e.sum += r.pct;
      e.n += 1;
      map.set(key, e);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([key, e]) => ({
        label: new Date(key).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        avg: Math.round(e.sum / e.n),
        count: e.n,
      }));
  }, [perf]);

  const attempts = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = perf.filter((r) => {
      if (term && !r.student.toLowerCase().includes(term)) return false;
      if (moduleFilter !== "all" && r.topic_id !== moduleFilter) return false;
      if (statusFilter === "completed" && !r.completed) return false;
      if (statusFilter === "in-progress" && r.completed) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      switch (sort) {
        case "pct-desc":
          return (b.completed ? b.pct : -1) - (a.completed ? a.pct : -1);
        case "pct-asc":
          return (a.completed ? a.pct : 101) - (b.completed ? b.pct : 101);
        case "student":
          return a.student.localeCompare(b.student);
        case "recent":
        default:
          return (
            new Date(b.finished_at ?? b.started_at).getTime() -
            new Date(a.finished_at ?? a.started_at).getTime()
          );
      }
    });
    return list;
  }, [perf, search, moduleFilter, statusFilter, sort]);

  const courseName = courseQuery.data?.title;
  const loading = perfQuery.isLoading;

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-6xl px-4 py-10"
    >
      <h1 className="font-display text-4xl">Performance</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Module-quiz results for students enrolled in{" "}
        <span className="font-medium text-foreground">{courseName ?? "your assigned course"}</span>.
        {studentsQuery.isSuccess && enrolledCount > 0 && (
          <>
            {" "}
            {summary.studentsAssessed} of {enrolledCount}{" "}
            {enrolledCount === 1 ? "student has" : "students have"} attempted a quiz.
          </>
        )}
      </p>

      {perfQuery.isError ? (
        <div className="mt-8 rounded-2xl border border-border bg-card/50 p-10 text-center">
          <h2 className="font-display text-xl">Couldn&apos;t load performance data</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Please try again in a moment.
          </p>
          <Button
            variant="outline"
            className="mt-5 rounded-full"
            onClick={() => perfQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile
              icon={BarChart3}
              label="Total attempts"
              value={String(summary.total)}
              loading={loading}
            />
            <StatTile
              icon={CheckCircle2}
              label="Completed"
              value={String(summary.completed)}
              loading={loading}
            />
            <StatTile
              icon={Clock}
              label="In progress"
              value={String(summary.inProgress)}
              loading={loading}
            />
            <StatTile
              icon={Target}
              label="Average score"
              value={summary.completed ? `${summary.avg}%` : "—"}
              loading={loading}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Average score per module */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Average score per module</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonRows />
                ) : byModule.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No quiz attempts yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {byModule.map((m) => (
                      <li key={m.topic}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">{m.topic}</span>
                          <span className="shrink-0 tabular-nums font-semibold">
                            {m.avg == null ? "—" : `${m.avg}%`}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${m.avg ?? 0}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {m.completed}/{m.attempts} attempts completed
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Weekly trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Score trend</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Average of completed attempts, by week
                </p>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonRows />
                ) : trend.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Not enough completed attempts yet.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {trend.map((w) => (
                      <li key={w.label}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Week of {w.label}</span>
                          <span className="shrink-0 tabular-nums font-semibold">{w.avg}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${w.avg}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {w.count} {w.count === 1 ? "attempt" : "attempts"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Per-student summary */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg">By student</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <SkeletonRows />
              ) : byStudent.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No student has attempted a quiz yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 font-medium">Student</th>
                        <th className="pb-2 text-right font-medium">Attempts</th>
                        <th className="pb-2 text-right font-medium">Completed</th>
                        <th className="pb-2 text-right font-medium">Avg %</th>
                        <th className="pb-2 pl-3 font-medium">Last activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {byStudent.map((s) => (
                        <tr key={s.student}>
                          <td className="max-w-[12rem] truncate py-2 pr-2">{s.student}</td>
                          <td className="py-2 text-right tabular-nums">{s.attempts}</td>
                          <td className="py-2 text-right tabular-nums">{s.completed}</td>
                          <td className="py-2 text-right tabular-nums">
                            {s.avg == null ? "—" : `${s.avg}%`}
                          </td>
                          <td className="py-2 pl-3 text-muted-foreground">{formatDate(s.last)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* All attempts */}
          <Card className="mt-6">
            <CardHeader className="space-y-3">
              <CardTitle className="text-lg">All quiz attempts</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by student"
                  className="rounded-xl sm:w-52"
                  aria-label="Search attempts by student"
                />
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                  <SelectTrigger className="rounded-xl sm:w-48" aria-label="Filter by module">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All modules</SelectItem>
                    {modules.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  <SelectTrigger className="rounded-xl sm:w-40" aria-label="Filter by status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="in-progress">In progress</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  <SelectTrigger className="rounded-xl sm:w-44" aria-label="Sort attempts">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Sort: Most recent</SelectItem>
                    <SelectItem value="pct-desc">Sort: Score high–low</SelectItem>
                    <SelectItem value="pct-asc">Sort: Score low–high</SelectItem>
                    <SelectItem value="student">Sort: Student</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <SkeletonRows rows={6} />
              ) : perf.length === 0 ? (
                <p className="text-sm text-muted-foreground">No quiz attempts yet.</p>
              ) : attempts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
                  No attempts match your filters.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    {attempts.length} of {perf.length} attempts
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="pb-2 font-medium">Student</th>
                          <th className="pb-2 font-medium">Module</th>
                          <th className="pb-2 text-right font-medium">Score</th>
                          <th className="pb-2 text-right font-medium">%</th>
                          <th className="pb-2 pl-3 font-medium">Status</th>
                          <th className="pb-2 pl-3 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {attempts.map((r) => (
                          <tr key={r.attempt_id}>
                            <td className="max-w-[10rem] truncate py-2 pr-2">{r.student}</td>
                            <td className="max-w-[10rem] truncate py-2 pr-2">{r.topic}</td>
                            <td className="py-2 text-right tabular-nums">
                              {r.completed ? `${r.score}/${r.total}` : "—"}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {r.completed ? `${r.pct}%` : "—"}
                            </td>
                            <td className="py-2 pl-3">
                              {r.completed ? (
                                <Badge variant={r.pct >= 70 ? "default" : "destructive"}>
                                  Completed
                                </Badge>
                              ) : (
                                <Badge variant="secondary">Started but did not finish</Badge>
                              )}
                            </td>
                            <td className="py-2 pl-3 text-muted-foreground">
                              {formatDate(r.finished_at ?? r.started_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </motion.main>
  );
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}
