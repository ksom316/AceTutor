import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { Badge, Button, Card, GradientButton, ProgressBar, Screen, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { keys, type Topic } from "@/lib/queries";
import { useColors } from "@/theme";

type CourseAttemptRow = {
  id: string;
  topic_id: string;
  score: number | null;
  total: number | null;
  finished_at: string | null;
};

export default function CourseDetail() {
  const c = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [openTopic, setOpenTopic] = useState<string | null>(null);

  const { data: course, isLoading } = useQuery({
    queryKey: keys.course(slug),
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, slug, title, summary")
        .eq("slug", slug)
        .maybeSingle();
      return data;
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: keys.topics(course?.id),
    enabled: !!course?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("topics")
        .select("id, slug, title, summary, order_index")
        .eq("course_id", course!.id)
        .order("order_index");
      return (data ?? []) as Topic[];
    },
  });

  const { data: enrollment } = useQuery({
    queryKey: keys.enrollment(user?.id, course?.id),
    enabled: !!user && !!course?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", user!.id)
        .eq("course_id", course!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: attempts = [] } = useQuery({
    queryKey: keys.courseAttempts(user?.id, course?.id),
    enabled: !!user && topics.length > 0,
    queryFn: async () => {
      const ids = topics.map((t) => t.id);
      const { data } = await supabase
        .from("quiz_attempts")
        .select("id, topic_id, score, total, finished_at")
        .eq("user_id", user!.id)
        .in("topic_id", ids);
      return (data ?? []) as unknown as CourseAttemptRow[];
    },
  });

  const analytics = useMemo(() => {
    const finished = attempts.filter((a) => a.finished_at);
    const byTopic = new Map<string, { score: number; total: number; count: number }>();
    for (const a of finished) {
      const cur = byTopic.get(a.topic_id) ?? { score: 0, total: 0, count: 0 };
      cur.score += a.score ?? 0;
      cur.total += a.total ?? 0;
      cur.count += 1;
      byTopic.set(a.topic_id, cur);
    }
    const perTopic = topics.map((t) => {
      const m = byTopic.get(t.id);
      const pct = m && m.total > 0 ? Math.round((m.score / m.total) * 100) : null;
      return { topic: t, accuracy: pct, attempts: m?.count ?? 0 };
    });
    const totalScore = finished.reduce((s, a) => s + (a.score ?? 0), 0);
    const totalQ = finished.reduce((s, a) => s + (a.total ?? 0), 0);
    const overall = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;
    const completed = perTopic.filter((p) => p.attempts > 0).length;
    const progress = topics.length > 0 ? Math.round((completed / topics.length) * 100) : 0;
    const nextTopic = topics.find((t) => !byTopic.has(t.id)) ?? topics[0];
    return { perTopic, overall, progress, completed, nextTopic };
  }, [attempts, topics]);

  const enroll = useMutation({
    mutationFn: async () => {
      if (!user || !course) throw new Error("Sign in to enroll");
      const { error } = await supabase
        .from("enrollments")
        .insert({ user_id: user.id, course_id: course.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.enrollment(user?.id, course?.id) });
      qc.invalidateQueries({ queryKey: keys.enrollments(user?.id) });
      Alert.alert("Enrolled", `You're now enrolled in ${course?.title}.`);
    },
    onError: (e: Error) => Alert.alert("Couldn't enroll", e.message),
  });

  const isEnrolled = !!enrollment;

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "",
          headerTransparent: false,
          headerTintColor: c.text,
          headerStyle: { backgroundColor: c.bg },
        }}
      />

      {isLoading || !course ? (
        <Txt variant="muted">Loading…</Txt>
      ) : (
        <>
          {/* Header */}
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Txt variant="h1" style={{ flexShrink: 1 }}>
                {course.title}
              </Txt>
              {user ? (
                isEnrolled ? (
                  <Badge label="Enrolled" tone="success" />
                ) : (
                  <Badge label="Not enrolled" tone="muted" />
                )
              ) : null}
            </View>
            {course.summary ? <Txt variant="muted">{course.summary}</Txt> : null}

            {user && isEnrolled && topics.length > 0 && (
              <View style={{ gap: 6, marginTop: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Txt variant="small">Course progress</Txt>
                  <Txt variant="small">
                    {analytics.completed}/{topics.length} · {analytics.progress}%
                  </Txt>
                </View>
                <ProgressBar value={analytics.progress} />
              </View>
            )}

            <View style={{ marginTop: 6 }}>
              {!user ? (
                <Button
                  label="Sign in to enroll"
                  icon="log-in-outline"
                  onPress={() => router.push("/login")}
                  full
                />
              ) : !isEnrolled ? (
                <GradientButton
                  label="Enroll in this course"
                  icon="add"
                  onPress={() => enroll.mutate()}
                  loading={enroll.isPending}
                />
              ) : analytics.nextTopic ? (
                <GradientButton
                  label="Continue learning"
                  icon="play"
                  onPress={() => router.push(`/topic/${analytics.nextTopic!.id}`)}
                />
              ) : null}
            </View>
          </Card>

          {/* AI tutor note */}
          <Card
            style={{
              flexDirection: "row",
              gap: 12,
              alignItems: "center",
              backgroundColor: c.primarySoft,
              borderColor: c.primary + "33",
            }}
          >
            <Ionicons name="sparkles" size={20} color={c.primary} />
            <Txt variant="small" style={{ flex: 1 }}>
              The AI Course Tutor (ask, explain, auto-quiz) is available in the AceTutor web app.
            </Txt>
          </Card>

          {/* Modules */}
          <View style={{ gap: 12 }}>
            <Txt variant="h3">Course modules</Txt>
            {topics.length === 0 ? (
              <Card>
                <Txt variant="muted">No modules published yet.</Txt>
              </Card>
            ) : (
              topics.map((t, idx) => {
                const stat = analytics.perTopic.find((p) => p.topic.id === t.id);
                const expanded = openTopic === t.id;
                return (
                  <Card key={t.id} style={{ gap: expanded ? 12 : 0 }}>
                    <Pressable
                      onPress={() => setOpenTopic(expanded ? null : t.id)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                    >
                      <View style={{ flex: 1 }}>
                        <Txt variant="label">Module {idx + 1}</Txt>
                        <Txt variant="title" numberOfLines={2}>
                          {t.title}
                        </Txt>
                      </View>
                      {stat?.accuracy != null && (
                        <Badge
                          label={`${stat.accuracy}%`}
                          tone={stat.accuracy >= 70 ? "success" : "primary"}
                        />
                      )}
                      <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={c.textMuted}
                      />
                    </Pressable>

                    {expanded && (
                      <View style={{ gap: 10 }}>
                        {t.summary ? <Txt variant="muted">{t.summary}</Txt> : null}
                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          <Button
                            label="Open module"
                            icon="book-outline"
                            variant="outline"
                            onPress={() => router.push(`/topic/${t.id}`)}
                          />
                          <Button
                            label="Take quiz"
                            icon="clipboard-outline"
                            variant="outline"
                            onPress={() => router.push(`/quiz/${t.id}`)}
                          />
                        </View>
                      </View>
                    )}
                  </Card>
                );
              })
            )}
          </View>

          {/* Performance */}
          {user && isEnrolled && attempts.length > 0 && (
            <Card style={{ gap: 10 }}>
              <Txt variant="h3">Your performance</Txt>
              <Txt variant="h1" color={c.primary}>
                {analytics.overall}%
              </Txt>
              <Txt variant="small">Overall accuracy across {attempts.length} attempts</Txt>
              <ProgressBar value={analytics.overall} />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
