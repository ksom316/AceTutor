import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { Badge, Card, ProgressBar, Screen, StatTile, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fetchProfile, keys } from "@/lib/queries";
import { formatHours, useLearning } from "@/lib/use-learning";
import { brand, radius, space, useColors } from "@/theme";

export default function DashboardScreen() {
  const c = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const learning = useLearning();

  const { data: profile } = useQuery({
    queryKey: keys.profile(user?.id),
    enabled: !!user,
    queryFn: () => fetchProfile(user!.id),
  });

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const cont = learning.continueCourse;
  const recent = learning.perCourse.slice(0, 4);

  return (
    <Screen>
      {/* Greeting */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Txt variant="muted">Welcome back</Txt>
          <Txt variant="h1">{firstName} 👋</Txt>
        </View>
        <Pressable onPress={() => router.push("/profile")}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: c.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="person" size={22} color={c.primary} />
          </View>
        </Pressable>
      </View>

      {/* Continue learning hero */}
      <LinearGradient
        colors={brand.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xl, padding: space.xl, gap: 10 }}
      >
        <Txt variant="label" color="rgba(255,255,255,0.85)">
          Continue learning
        </Txt>
        {cont ? (
          <>
            <Txt variant="h2" color="#fff">
              {cont.title}
            </Txt>
            <Txt variant="body" color="rgba(255,255,255,0.9)">
              {cont.done}/{cont.total || "—"} lessons complete · {cont.pct}%
            </Txt>
            <View style={{ marginTop: 8 }}>
              <View
                style={{
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.3)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: `${cont.pct}%`,
                    height: "100%",
                    backgroundColor: "#fff",
                    borderRadius: 999,
                  }}
                />
              </View>
            </View>
            <Pressable
              onPress={() => router.push(`/course/${cont.slug}`)}
              style={{
                marginTop: 14,
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: "#fff",
                paddingHorizontal: 18,
                paddingVertical: 11,
                borderRadius: radius.pill,
              }}
            >
              <Ionicons name="play" size={16} color={brand.violet} />
              <Txt variant="title" color={brand.violet}>
                Resume course
              </Txt>
            </Pressable>
          </>
        ) : (
          <>
            <Txt variant="h2" color="#fff">
              Start your first course
            </Txt>
            <Txt variant="body" color="rgba(255,255,255,0.9)">
              Browse the catalog and enroll to begin tracking progress.
            </Txt>
            <Pressable
              onPress={() => router.push("/courses")}
              style={{
                marginTop: 12,
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: "#fff",
                paddingHorizontal: 18,
                paddingVertical: 11,
                borderRadius: radius.pill,
              }}
            >
              <Ionicons name="book" size={16} color={brand.violet} />
              <Txt variant="title" color={brand.violet}>
                Browse courses
              </Txt>
            </Pressable>
          </>
        )}
      </LinearGradient>

      {/* Stat tiles */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
        <StatTile
          icon="book-outline"
          label="Courses"
          value={String(learning.enrolledCourses.length)}
        />
        <StatTile icon="trophy-outline" label="Quizzes" value={String(learning.quizzes)} />
        <StatTile icon="time-outline" label="Hours" value={formatHours(learning.totalSeconds)} />
        <StatTile
          icon="locate-outline"
          label="Avg score"
          value={learning.quizzes ? `${learning.avgScore}%` : "—"}
        />
      </View>

      {/* VARK nudge */}
      {!profile?.vark_primary && (
        <Pressable onPress={() => router.push("/onboarding-vark")}>
          <Card
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              backgroundColor: c.primarySoft,
              borderColor: c.primary + "44",
            }}
          >
            <Ionicons name="school-outline" size={22} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Txt variant="title">Personalize your learning</Txt>
              <Txt variant="small">Take the 16-question VARK intake to tailor every lesson.</Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Card>
        </Pressable>
      )}

      {/* My courses */}
      <View style={{ gap: 12 }}>
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Txt variant="h3">My courses</Txt>
          <Pressable onPress={() => router.push("/courses")}>
            <Txt variant="small" color={c.primary} style={{ fontWeight: "700" }}>
              View all
            </Txt>
          </Pressable>
        </View>

        {recent.length > 0 ? (
          recent.map((course) => (
            <Pressable key={course.id} onPress={() => router.push(`/course/${course.slug}`)}>
              <Card style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: c.primarySoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="book" size={20} color={c.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="title" numberOfLines={1}>
                      {course.title}
                    </Txt>
                    <Txt variant="small">
                      {course.total > 0 ? `${course.total} lessons` : "Lessons coming soon"}
                    </Txt>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={c.textMuted} />
                </View>
                <ProgressBar value={course.pct} height={6} />
                <Txt variant="small">{course.pct}% complete</Txt>
              </Card>
            </Pressable>
          ))
        ) : (
          <Card style={{ alignItems: "center", gap: 8, borderStyle: "dashed" }}>
            <Txt variant="muted">You're not enrolled in any course yet.</Txt>
            <Pressable onPress={() => router.push("/courses")}>
              <Badge label="Browse courses" />
            </Pressable>
          </Card>
        )}
      </View>

      {/* Recent quiz attempts */}
      <Card style={{ gap: 10 }}>
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Txt variant="h3">Recent quizzes</Txt>
          <Ionicons name="trophy-outline" size={18} color={c.primary} />
        </View>
        {learning.attempts.length > 0 ? (
          learning.attempts.slice(0, 5).map((a) => {
            const pct = a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : 0;
            return (
              <View
                key={a.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: 8,
                  borderTopWidth: 1,
                  borderTopColor: c.border,
                }}
              >
                <Txt variant="body" numberOfLines={1} style={{ flex: 1, paddingRight: 12 }}>
                  {a.topics?.title ?? "Quiz"}
                </Txt>
                <Badge
                  label={`${a.score}/${a.total} · ${pct}%`}
                  tone={pct >= 70 ? "success" : "primary"}
                />
              </View>
            );
          })
        ) : (
          <Txt variant="muted">No quizzes yet — take one to see your scores.</Txt>
        )}
      </Card>
    </Screen>
  );
}
