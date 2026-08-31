import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, HelpCircle, Layers, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { fadeUp } from "@/lib/motion";

export const Route = createFileRoute("/lecturer/")({
  component: LecturerDashboard,
});

/** One row from get_course_quiz_performance(). `finished_at` is null while an
 *  attempt is in progress (the generated type flattens it to string). */
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

const RECENT_LIMIT = 6;
const ACTIVITY_LIMIT = 5;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatTile({
  icon: Icon,
  label,
  value,
  loading,
  error,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  loading: boolean;
  error: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-12 animate-pulse rounded bg-muted" />
      ) : (
        <p className="mt-2 font-display text-3xl">{error ? "—" : value}</p>
      )}
    </div>
  );
}

function SectionFallback() {
  return <p className="text-sm text-muted-foreground">Couldn&apos;t load this section right now.</p>;
}

function SkeletonLines({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-6 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function LecturerDashboard() {
  const { lecturerCourseId } = useRole();
  const enabled = !!lecturerCourseId;

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

  // Course content counts, scoped to the lecturer's course on the server:
  //   Modules          = topics WHERE course_id = <lecturer's course>
  //   Learning materials = lessons WHERE topic_id IN (those topics)  (3 modalities per topic)
  //   Quiz questions    = questions WHERE topic_id IN (those topics)
  // Row ids are fetched and counted rather than a HEAD `count` request, which
  // can return a null count depending on PostgREST config; these sets are small.
  const countsQuery = useQuery({
    queryKey: ["lecturer-content-counts", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const topicsRes = await supabase
        .from("topics")
        .select("id")
        .eq("course_id", lecturerCourseId!);
      if (topicsRes.error) throw topicsRes.error;
      const topicIds = (topicsRes.data ?? []).map((t) => t.id);
      if (topicIds.length === 0) return { topics: 0, lessons: 0, questions: 0 };
      const [lessonsRes, questionsRes] = await Promise.all([
        supabase.from("lessons").select("id").in("topic_id", topicIds),
        supabase.from("questions").select("id").in("topic_id", topicIds),
      ]);
      if (lessonsRes.error) throw lessonsRes.error;
      if (questionsRes.error) throw questionsRes.error;
      return {
        topics: topicIds.length,
        lessons: (lessonsRes.data ?? []).length,
        questions: (questionsRes.data ?? []).length,
      };
    },
  });

  // Enrolled students — the secure function derives the course from
  // current_lecturer_course(); we only use the row count here.
  const studentsQuery = useQuery({
    queryKey: ["lecturer-students", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_course_students");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Quiz performance — also course-derived server-side. Feeds the recent table,
  // the activity feed and the per-module averages (one request, three views).
  const perfQuery = useQuery({
    queryKey: ["lecturer-quiz-performance", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_course_quiz_performance");
      if (error) throw error;
      return (data ?? []) as QuizPerfRow[];
    },
  });

  // Stable empty-array fallback so dependent memos don't re-run every render
  // (matches the pattern in analytics.tsx).
  const perf = useMemo<QuizPerfRow[]>(() => perfQuery.data ?? [], [perfQuery.data]);
  const studentCount = studentsQuery.data?.length ?? 0;

  // "Recent quiz performance" = graded attempts first (the quiz runner inserts a
  // row when a student merely opens a quiz, so raw recency is dominated by
  // never-submitted attempts). `completed` / `score` / `pct` come straight from
  // the RPC's authoritative values.
  const recent = useMemo(() => {
    const done = perf
      .filter((r) => r.completed)
      .sort(
        (a, b) =>
          new Date(b.finished_at ?? b.started_at).getTime() -
          new Date(a.finished_at ?? a.started_at).getTime(),
      );
    const ongoing = perf.filter((r) => !r.completed); // RPC already returns started_at desc
    return [...done, ...ongoing].slice(0, RECENT_LIMIT);
  }, [perf]);

  const avgByModule = useMemo(() => {
    const map = new Map<string, { topic: string; sum: number; n: number }>();
    for (const row of perf) {
      if (!row.completed) continue;
      const entry = map.get(row.topic_id) ?? { topic: row.topic, sum: 0, n: 0 };
      entry.sum += row.pct;
      entry.n += 1;
      map.set(row.topic_id, entry);
    }
    return Array.from(map.values())
      .map((e) => ({ topic: e.topic, avg: Math.round(e.sum / e.n) }))
      .sort((a, b) => b.avg - a.avg);
  }, [perf]);

  const activity = perf.slice(0, ACTIVITY_LIMIT).map((row) => ({
    id: row.attempt_id,
    text: row.completed
      ? `${row.student} completed a quiz on ${row.topic}`
      : `${row.student} started a quiz on ${row.topic}`,
    when: timeAgo(row.completed && row.finished_at ? row.finished_at : row.started_at),
  }));

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-6xl px-4 py-10"
    >
      {/* Course overview */}
      <p className="text-sm text-muted-foreground">Lecturer Dashboard</p>
      {courseQuery.isLoading ? (
        <div className="mt-1 h-10 w-72 max-w-full animate-pulse rounded bg-muted" />
      ) : (
        <h1 className="mt-1 font-display text-4xl">
          {courseQuery.data?.title ?? "Your course"}
        </h1>
      )}
      {!courseQuery.isLoading && courseQuery.data?.summary && (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {courseQuery.data.summary}
        </p>
      )}

      {/* Stat tiles */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          icon={Users}
          label="Enrolled students"
          value={studentCount}
          loading={studentsQuery.isLoading}
          error={studentsQuery.isError}
        />
        <StatTile
          icon={Layers}
          label="Modules"
          value={countsQuery.data?.topics ?? 0}
          loading={countsQuery.isLoading}
          error={countsQuery.isError}
        />
        <StatTile
          icon={BookOpen}
          label="Learning materials"
          value={countsQuery.data?.lessons ?? 0}
          loading={countsQuery.isLoading}
          error={countsQuery.isError}
        />
        <StatTile
          icon={HelpCircle}
          label="Quiz questions"
          value={countsQuery.data?.questions ?? 0}
          loading={countsQuery.isLoading}
          error={countsQuery.isError}
        />
      </div>

      {!countsQuery.isLoading && !countsQuery.isError && countsQuery.data?.topics === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          No modules have been created for this course yet.
        </p>
      )}
      {!countsQuery.isLoading &&
        !countsQuery.isError &&
        countsQuery.data &&
        countsQuery.data.topics > 0 &&
        countsQuery.data.lessons === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            No learning materials have been added yet.
          </p>
        )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Recent quiz performance */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Recent quiz performance</CardTitle>
            <Link
              to="/lecturer/performance"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            {perfQuery.isLoading ? (
              <SkeletonLines />
            ) : perfQuery.isError ? (
              <SectionFallback />
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quiz performance data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Student</th>
                      <th className="pb-2 font-medium">Topic</th>
                      <th className="pb-2 text-right font-medium">Score</th>
                      <th className="pb-2 text-right font-medium">%</th>
                      <th className="pb-2 pl-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {recent.map((row) => (
                      <tr key={row.attempt_id}>
                        <td className="max-w-[8rem] truncate py-2 pr-2">{row.student}</td>
                        <td className="max-w-[9rem] truncate py-2 pr-2">{row.topic}</td>
                        <td className="py-2 text-right tabular-nums">
                          {row.completed ? `${row.score}/${row.total}` : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {row.completed ? `${row.pct}%` : "—"}
                        </td>
                        <td className="py-2 pl-3">
                          {row.completed ? (
                            <Badge variant={row.pct >= 70 ? "default" : "secondary"}>Completed</Badge>
                          ) : (
                            <Badge variant="secondary">In progress</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Average score per module */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Average score per module</CardTitle>
          </CardHeader>
          <CardContent>
            {perfQuery.isLoading ? (
              <SkeletonLines />
            ) : perfQuery.isError ? (
              <SectionFallback />
            ) : avgByModule.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No completed quiz attempts yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {avgByModule.map((m) => (
                  <li
                    key={m.topic}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">{m.topic}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{m.avg}%</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent student activity */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Recent student activity</CardTitle>
          <p className="text-xs text-muted-foreground">Based on recent quiz attempts</p>
        </CardHeader>
        <CardContent>
          {perfQuery.isLoading ? (
            <SkeletonLines rows={3} />
          ) : perfQuery.isError ? (
            <SectionFallback />
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent quiz activity.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {activity.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate">{a.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.when}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {studentsQuery.isSuccess && studentCount === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          No students are currently enrolled in this course.
        </p>
      )}
    </motion.main>
  );
}
