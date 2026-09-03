import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { View } from "react-native";

import { Card, EmptyState, Screen, StatTile, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { brand, radius, useColors } from "@/theme";

const DAY_MS = 24 * 60 * 60 * 1000;
const PALETTE = [brand.cyan, brand.indigo, brand.violet, "#f472b6", "#34d399"];

// Minimal shapes for the two nested Supabase selects this screen reads.
type ProgressRow = {
  watched_seconds: number | null;
  completed_at: string | null;
  updated_at: string | null;
  lessons: { topics: { courses: { id: string; title: string } | null } | null } | null;
};
type AttemptRow = { score: number | null; total: number | null; finished_at: string | null };

function fmtDuration(seconds: number) {
  if (!seconds || seconds < 1) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function AnalyticsScreen() {
  const c = useColors();
  const { user } = useAuth();
  const uid = user?.id;

  const progressQuery = useQuery({
    queryKey: ["analytics-progress", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress")
        .select("watched_seconds, completed_at, updated_at, lessons(topics(courses(id, title)))")
        .eq("user_id", uid!);
      return (data ?? []) as unknown as ProgressRow[];
    },
  });

  const attemptsQuery = useQuery({
    queryKey: ["analytics-attempts", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("score, total, finished_at, topics(title, courses(id, title))")
        .eq("user_id", uid!)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: true });
      return (data ?? []) as unknown as AttemptRow[];
    },
  });

  // Memoize the fallbacks so the empty-array reference is stable across renders
  // (otherwise every dependent useMemo re-runs on each render while loading).
  const progress = useMemo(() => progressQuery.data ?? [], [progressQuery.data]);
  const attempts = useMemo(() => attemptsQuery.data ?? [], [attemptsQuery.data]);
  const loading = progressQuery.isLoading || attemptsQuery.isLoading;

  const perCourse = useMemo(() => {
    const map = new Map<
      string,
      { name: string; seconds: number; lessons: number; completed: number }
    >();
    for (const row of progress) {
      const course = row.lessons?.topics?.courses;
      if (!course) continue;
      const e = map.get(course.id) ?? { name: course.title, seconds: 0, lessons: 0, completed: 0 };
      e.seconds += row.watched_seconds ?? 0;
      e.lessons += 1;
      if (row.completed_at) e.completed += 1;
      map.set(course.id, e);
    }
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [progress]);

  const scoreTrend = useMemo(
    () => attempts.map((a) => (a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : 0)),
    [attempts],
  );

  const totalSeconds = perCourse.reduce((s, c2) => s + c2.seconds, 0);
  const avgScore = attempts.length
    ? Math.round(
        attempts.reduce((s, a) => s + (a.total ? ((a.score ?? 0) / a.total) * 100 : 0), 0) /
          attempts.length,
      )
    : 0;
  const activeDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const set = new Set<string>();
    for (const row of progress) {
      if (!row.updated_at) continue;
      const d = new Date(row.updated_at);
      if (today.getTime() - d.getTime() <= 14 * DAY_MS) set.add(d.toDateString());
    }
    return set.size;
  }, [progress]);

  const maxSeconds = Math.max(1, ...perCourse.map((p) => p.seconds));
  const hasData = !loading && (progress.length > 0 || attempts.length > 0);

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: c.primarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="stats-chart" size={24} color={c.primary} />
        </View>
        <View>
          <Txt variant="muted">Your learning insights</Txt>
          <Txt variant="h2">Progress & Analytics</Txt>
        </View>
      </View>

      {!hasData ? (
        <EmptyState
          icon="pulse-outline"
          title={loading ? "Loading…" : "No activity yet"}
          body={
            loading
              ? undefined
              : "Start a lesson or take a quiz and your insights will appear here."
          }
        />
      ) : (
        <>
          {/* KPIs */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <StatTile icon="time-outline" label="Time learning" value={fmtDuration(totalSeconds)} />
            <StatTile icon="book-outline" label="Active courses" value={String(perCourse.length)} />
            <StatTile icon="trophy-outline" label="Quizzes" value={String(attempts.length)} />
            <StatTile icon="locate-outline" label="Avg score" value={`${avgScore}%`} />
            <StatTile icon="flame-outline" label="Active days (14)" value={String(activeDays)} />
          </View>

          {/* Minutes by course */}
          {perCourse.length > 0 && (
            <Card style={{ gap: 14 }}>
              <Txt variant="h3">Time by course</Txt>
              {perCourse.map((p, i) => (
                <View key={p.name} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Txt variant="body" numberOfLines={1} style={{ flex: 1, paddingRight: 8 }}>
                      {p.name}
                    </Txt>
                    <Txt variant="small">{fmtDuration(p.seconds)}</Txt>
                  </View>
                  <View
                    style={{
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: c.surface,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${(p.seconds / maxSeconds) * 100}%`,
                        height: "100%",
                        borderRadius: 999,
                        backgroundColor: PALETTE[i % PALETTE.length],
                      }}
                    />
                  </View>
                </View>
              ))}
            </Card>
          )}

          {/* Score trend */}
          {scoreTrend.length > 0 && (
            <Card style={{ gap: 12 }}>
              <Txt variant="h3">Quiz score trend</Txt>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 120 }}>
                {scoreTrend.map((score, i) => (
                  <View key={i} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                    <View
                      style={{
                        width: "70%",
                        height: `${Math.max(4, score)}%`,
                        backgroundColor: score >= 70 ? c.success : c.primary,
                        borderRadius: radius.sm,
                      }}
                    />
                  </View>
                ))}
              </View>
              <Txt variant="small">Each bar is one quiz attempt (% score), oldest → newest.</Txt>
            </Card>
          )}

          {/* Course breakdown */}
          {perCourse.length > 0 && (
            <Card style={{ gap: 12 }}>
              <Txt variant="h3">Course breakdown</Txt>
              {perCourse.map((p, i) => {
                const pct = p.lessons ? Math.round((p.completed / p.lessons) * 100) : 0;
                return (
                  <View
                    key={p.name}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 36,
                        borderRadius: 3,
                        backgroundColor: PALETTE[i % PALETTE.length],
                      }}
                    />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Txt variant="body" numberOfLines={1}>
                        {p.name}
                      </Txt>
                      <Txt variant="small">
                        {p.completed}/{p.lessons} lessons · {pct}%
                      </Txt>
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
