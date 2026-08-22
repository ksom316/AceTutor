import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { secondsByCourse, type StudySessionRow } from "@/lib/study-time";

export type PerCourse = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  total: number;
  done: number;
  touched: number;
  pct: number;
  /** Active learning seconds recorded for this course. */
  seconds: number;
};

export type DonutDatum = { name: "Completed" | "In Progress" | "Not Started"; value: number };

type EnrolledCourse = { id: string; slug: string; title: string; summary: string | null };
type LessonRow = { id: string; topics: { course_id: string } | null };
type ProgressRow = {
  completed_at: string | null;
  watched_seconds: number | null;
  lessons: { id: string; topics: { course_id: string } | null } | null;
};
type AttemptRow = {
  id: string;
  score: number | null;
  total: number | null;
  finished_at: string | null;
  topics: { title: string; courses: { title: string; slug: string } | null } | null;
};

/**
 * Shared student-dashboard data + derived stats, used by both the logged-in
 * home page (src/routes/index.tsx) and the /dashboard route so the two surfaces
 * never diverge. Pulls enrollments, the lessons in those courses, the user's
 * lesson progress, and recent finished quiz attempts, then computes per-course
 * progress, an overall completed/in-progress/not-started breakdown, the
 * "continue learning" course, and headline counts.
 *
 * Query keys mirror the ones the dashboard already used (`dash-*`) so caches
 * stay warm across navigations.
 */
export function useStudentDashboard(userId: string | undefined) {
  const { data: enrollments } = useQuery({
    queryKey: ["dash-enrollments", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
      .from("enrollments")
      .select("course_id, created_at, courses(id, slug, title, summary)")
      .eq("user_id", userId!)
      .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const enrolledCourses = useMemo(
    () =>
      ((enrollments ?? []) as unknown as { courses: EnrolledCourse | null }[])
        .map((e) => e.courses)
        .filter(Boolean) as EnrolledCourse[],
    [enrollments],
  );
  const enrolledIds = useMemo(() => enrolledCourses.map((c) => c.id), [enrolledCourses]);

  // All lessons that belong to the user's enrolled courses (for totals).
  const { data: courseLessons } = useQuery({
    queryKey: ["dash-lessons", enrolledIds],
    enabled: enrolledIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("lessons")
        .select("id, topics!inner(course_id)")
        .in("topics.course_id", enrolledIds);
      return (data ?? []) as unknown as LessonRow[];
    },
  });

  // The user's lesson progress (completed + time watched).
  const { data: progressRows } = useQuery({
    queryKey: ["dash-progress", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress")
        .select("completed_at, watched_seconds, lessons!inner(id, topics!inner(course_id))")
        .eq("user_id", userId!);
      return (data ?? []) as unknown as ProgressRow[];
    },
  });

  // Active learning time, recorded by the study-time tracker.
  const { data: sessionRows } = useQuery({
    queryKey: ["dash-study-sessions", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("study_sessions")
        .select("course_id, surface, started_at, seconds")
        .eq("user_id", userId!)
        .gt("seconds", 0);
      return (data ?? []) as unknown as StudySessionRow[];
    },
  });

  const { data: attempts } = useQuery({
    queryKey: ["dash-attempts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("id, score, total, finished_at, topics(title, courses(title, slug))")
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(6);
      return (data ?? []) as unknown as AttemptRow[];
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
    let completedLessons = 0;
    let inProgressLessons = 0;
    for (const p of prog) {
      const cid = p.lessons?.topics?.course_id;
      if (cid) {
        touchedByCourse.set(cid, (touchedByCourse.get(cid) ?? 0) + 1);
        if (p.completed_at) {
          completedByCourse.set(cid, (completedByCourse.get(cid) ?? 0) + 1);
          completedLessons += 1;
        } else {
          inProgressLessons += 1;
        }
      }
    }

    const totalLessons = Array.from(totalByCourse.values()).reduce((s, n) => s + n, 0);
    const notStarted = Math.max(0, totalLessons - completedLessons - inProgressLessons);
    const overallPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    // Time learned comes from the study-time tracker, not lesson progress —
    // it's the same source the Analytics page reports.
    const sessions = sessionRows ?? [];
    const secondsPerCourse = secondsByCourse(sessions);
    const totalSeconds = sessions.reduce((s, r) => s + r.seconds, 0);

    const perCourse: PerCourse[] = enrolledCourses.map((c) => {
      const total = totalByCourse.get(c.id) ?? 0;
      const done = completedByCourse.get(c.id) ?? 0;
      const touched = touchedByCourse.get(c.id) ?? 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return { ...c, total, done, touched, pct, seconds: secondsPerCourse.get(c.id) ?? 0 };
    });

    const att = attempts ?? [];
    const avgScore = att.length
      ? Math.round(
          att.reduce((s, a) => s + (a.total ? ((a.score ?? 0) / a.total) * 100 : 0), 0) /
            att.length,
        )
      : 0;

    return {
      perCourse,
      overallPct,
      donut: [
        { name: "Completed", value: completedLessons },
        { name: "In Progress", value: inProgressLessons },
        { name: "Not Started", value: notStarted },
      ] as DonutDatum[],
      totalSeconds,
      avgScore,
      quizzes: att.length,
    };
  }, [courseLessons, progressRows, sessionRows, enrolledCourses, attempts]);

  // "Continue learning": furthest-along touched course, else most recent enrollment.
  const continueCourse = useMemo(() => {
    const touched = stats.perCourse.filter((c) => c.touched > 0).sort((a, b) => b.pct - a.pct);
    return touched[0] ?? stats.perCourse[0] ?? null;
  }, [stats.perCourse]);

  const recommended = useMemo(
    () =>
      enrolledCourses
        .filter((c) => !stats.perCourse.find((p) => p.id === c.id && p.touched > 0))
        .slice(0, 3),
    [enrolledCourses, stats.perCourse],
  );

  return {
    enrolledCourses,
    perCourse: stats.perCourse,
    overallPct: stats.overallPct,
    donut: stats.donut,
    continueCourse,
    recommended,
    recentAttempts: attempts ?? [],
    quizzes: stats.quizzes,
    avgScore: stats.avgScore,
    totalSeconds: stats.totalSeconds,
  };
}
