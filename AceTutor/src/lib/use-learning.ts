import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/lib/auth";
import {
  fetchAttempts,
  fetchEnrollments,
  fetchLessonsForCourses,
  fetchProgress,
  keys,
  type Course,
} from "@/lib/queries";

export type CourseStat = Course & { total: number; done: number; touched: number; pct: number };

/**
 * Shared learning state for the dashboard and courses tabs: enrolled courses
 * with per-course progress, recent attempts, and aggregate stats. Mirrors the
 * web app's derivation so query keys are reused across screens.
 */
export function useLearning() {
  const { user } = useAuth();
  const uid = user?.id;

  const enrollments = useQuery({
    queryKey: keys.enrollments(uid),
    enabled: !!uid,
    queryFn: fetchEnrollments,
  });
  const enrolledCourses = useMemo(() => enrollments.data ?? [], [enrollments.data]);
  const enrolledIds = useMemo(() => enrolledCourses.map((c) => c.id), [enrolledCourses]);

  const lessons = useQuery({
    queryKey: keys.lessons(enrolledIds),
    enabled: enrolledIds.length > 0,
    queryFn: () => fetchLessonsForCourses(enrolledIds),
  });
  const progress = useQuery({
    queryKey: keys.progress(uid),
    enabled: !!uid,
    queryFn: () => fetchProgress(uid!),
  });
  const attempts = useQuery({
    queryKey: keys.attempts(uid),
    enabled: !!uid,
    queryFn: () => fetchAttempts(uid!),
  });

  const stats = useMemo(() => {
    const ls = lessons.data ?? [];
    const prog = progress.data ?? [];

    const totalByCourse = new Map<string, number>();
    for (const l of ls) {
      const cid = l.topics?.course_id;
      if (cid) totalByCourse.set(cid, (totalByCourse.get(cid) ?? 0) + 1);
    }

    const doneByCourse = new Map<string, number>();
    const touchedByCourse = new Map<string, number>();
    let totalSeconds = 0;
    let completedLessons = 0;
    for (const p of prog) {
      const cid = p.lessons?.topics?.course_id;
      totalSeconds += p.watched_seconds ?? 0;
      if (cid) {
        touchedByCourse.set(cid, (touchedByCourse.get(cid) ?? 0) + 1);
        if (p.completed_at) {
          doneByCourse.set(cid, (doneByCourse.get(cid) ?? 0) + 1);
          completedLessons += 1;
        }
      }
    }

    const perCourse: CourseStat[] = enrolledCourses.map((c) => {
      const total = totalByCourse.get(c.id) ?? 0;
      const done = doneByCourse.get(c.id) ?? 0;
      const touched = touchedByCourse.get(c.id) ?? 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return { ...c, total, done, touched, pct };
    });

    const att = attempts.data ?? [];
    const avgScore = att.length
      ? Math.round(att.reduce((s, a) => s + (a.total ? (a.score / a.total) * 100 : 0), 0) / att.length)
      : 0;

    return { perCourse, totalSeconds, completedLessons, avgScore, quizzes: att.length };
  }, [lessons.data, progress.data, enrolledCourses, attempts.data]);

  const continueCourse = useMemo(() => {
    const touched = stats.perCourse.filter((c) => c.touched > 0).sort((a, b) => b.pct - a.pct);
    return touched[0] ?? stats.perCourse[0] ?? null;
  }, [stats.perCourse]);

  return {
    loading: enrollments.isLoading,
    enrolledCourses,
    enrolledIds,
    attempts: attempts.data ?? [],
    continueCourse,
    ...stats,
  };
}

export function formatHours(seconds: number) {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)}`;
  return h.toFixed(1).replace(/\.0$/, "");
}
