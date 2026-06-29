import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { Badge, Card, ProgressBar, Screen, Txt } from "@/components/ui";
import { fetchAllCourses, keys } from "@/lib/queries";
import { useLearning } from "@/lib/use-learning";
import { brand, radius, space, useColors } from "@/theme";

export default function CoursesScreen() {
  const c = useColors();
  const router = useRouter();
  const learning = useLearning();

  const { data: allCourses } = useQuery({ queryKey: keys.allCourses(), queryFn: fetchAllCourses });

  const explore = useMemo(
    () => (allCourses ?? []).filter((course) => !learning.enrolledIds.includes(course.id)),
    [allCourses, learning.enrolledIds],
  );
  const cont = learning.continueCourse;

  return (
    <Screen>
      <View>
        <Txt variant="h1">My Courses</Txt>
        <Txt variant="muted">Pick up where you left off and explore what's next.</Txt>
      </View>

      {/* Continue hero */}
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
              {cont.done}/{cont.total || "—"} lessons · {cont.pct}%
            </Txt>
            <Pressable
              onPress={() => router.push(`/course/${cont.slug}`)}
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
              <Ionicons name="play" size={16} color={brand.violet} />
              <Txt variant="title" color={brand.violet}>
                Resume
              </Txt>
            </Pressable>
          </>
        ) : (
          <Txt variant="body" color="rgba(255,255,255,0.9)">
            Enroll in a course below to start tracking your progress here.
          </Txt>
        )}
      </LinearGradient>

      {/* Enrolled */}
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Txt variant="h3">Enrolled</Txt>
          <Txt variant="small">{learning.perCourse.length} active</Txt>
        </View>
        {learning.perCourse.length > 0 ? (
          learning.perCourse.map((course) => (
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
                    <Txt variant="small">{course.total > 0 ? `${course.total} lessons` : "Lessons coming soon"}</Txt>
                  </View>
                  <Ionicons name="arrow-up" size={18} color={c.textMuted} style={{ transform: [{ rotate: "45deg" }] }} />
                </View>
                <ProgressBar value={course.pct} height={6} />
                <Txt variant="small">{course.pct}% complete</Txt>
              </Card>
            </Pressable>
          ))
        ) : (
          <Card style={{ alignItems: "center", borderStyle: "dashed" }}>
            <Txt variant="muted" style={{ textAlign: "center" }}>
              You haven't enrolled in any course yet. Explore the catalog below.
            </Txt>
          </Card>
        )}
      </View>

      {/* Explore */}
      {explore.length > 0 && (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="compass-outline" size={20} color={c.primary} />
            <Txt variant="h3">Explore more</Txt>
          </View>
          {explore.map((course) => (
            <Pressable key={course.id} onPress={() => router.push(`/course/${course.slug}`)}>
              <Card style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: c.surface,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="book" size={20} color={c.primary} />
                  </View>
                  <Badge label="New" />
                </View>
                <Txt variant="title" numberOfLines={1}>
                  {course.title}
                </Txt>
                {course.summary ? (
                  <Txt variant="small" numberOfLines={2}>
                    {course.summary}
                  </Txt>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <Ionicons name="add" size={16} color={c.primary} />
                  <Txt variant="small" color={c.primary} style={{ fontWeight: "700" }}>
                    Enroll & start
                  </Txt>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
