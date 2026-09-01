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
type GeneralAttemptRow = {
  id: string;
  score: number | null;
  total: number | null;
  finished_at: string | null;
  course_quizzes: { title: string; courses: { title: string } | null } | null;
};
type TopicRow = { id: string; course_id: string };
type ModuleAttemptRow = { topic_id: string; finished_at: string | null };

/** A finished quiz attempt (module or general course quiz) for the "Recent quiz
 *  attempts" list. Module-centric summary stats are computed separately and are
 *  unaffected by the general-quiz rows. */
export type RecentAttempt = {
  id: string;
  score: number | null;
  total: number | null;
  finished_at: string | null;
  kind: "module" | "general";
  title: string;
  courseTitle: string | null;
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
        // Module quizzes only — module-centric dashboard stats (donut, avg score,
        // quiz count) are derived from this set and must not change.
        .not("topic_id", "is", null)
        .order("finished_at", { ascending: false })
        .limit(6);
      return (data ?? []) as unknown as AttemptRow[];
    },
  });

  // Finished General Course Quiz attempts — shown in the "Recent quiz attempts"
  // list alongside module attempts, but deliberately NOT fed into the summary
  // stats above. RLS already scopes quiz_attempts to the caller.
  const { data: generalAttempts } = useQuery({
    queryKey: ["dash-general-attempts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("id, score, total, finished_at, course_quizzes(title, courses(title))")
        .eq("user_id", userId!)
        .not("finished_at", "is", null)
        .not("course_quiz_id", "is", null)
        .order("finished_at", { ascending: false })
        .limit(6);
      return (data ?? []) as unknown as GeneralAttemptRow[];
    },
  });

  // Topics (modules) in the user's enrolled courses — the denominator for
  // module-based course progress.
  const { data: courseTopics } = useQuery({
    queryKey: ["dash-topics", enrolledIds],
    enabled: enrolledIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("topics")
        .select("id, course_id")
        .in("course_id", enrolledIds);
      return (data ?? []) as unknown as TopicRow[];
    },
  });

  // Every quiz attempt (finished or not) per topic. A module is Completed when it
  // has a finished attempt, In Progress when it only has unfinished ones. Same
  // "completed" rule as the course page.
  const { data: moduleAttempts } = useQuery({
    queryKey: ["dash-module-attempts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("topic_id, finished_at")
        .eq("user_id", userId!)
        .not("topic_id", "is", null);
      return (data ?? []) as unknown as ModuleAttemptRow[];
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

    // Module-based progress, matching src/routes/courses.$slug.tsx. Every topic
    // of an enrolled course falls into exactly one bucket:
    //   - Completed:   the topic has at least one finished quiz attempt
    //   - In Progress: an attempt was started for the topic but none finished
    //   - Not Started: the topic has no quiz attempt at all
    // so completed + inProgress + notStarted === total modules. Multiple attempts
    // on one topic still count once (Set membership).
    const finishedTopicIds = new Set(
      (moduleAttempts ?? []).filter((a) => a.finished_at).map((a) => a.topic_id),
    );
    const startedTopicIds = new Set((moduleAttempts ?? []).map((a) => a.topic_id));
    const totalModulesByCourse = new Map<string, number>();
    const completedModulesByCourse = new Map<string, number>();
    let totalModules = 0;
    let completedModules = 0;
    let inProgressModules = 0;
    for (const t of courseTopics ?? []) {
      totalModules += 1;
      totalModulesByCourse.set(t.course_id, (totalModulesByCourse.get(t.course_id) ?? 0) + 1);
      if (finishedTopicIds.has(t.id)) {
        completedModules += 1;
        completedModulesByCourse.set(
          t.course_id,
          (completedModulesByCourse.get(t.course_id) ?? 0) + 1,
        );
      } else if (startedTopicIds.has(t.id)) {
        inProgressModules += 1;
      }
    }
    const notStartedModules = Math.max(0, totalModules - completedModules - inProgressModules);
    const overallPct = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

    // Time learned comes from the study-time tracker, not lesson progress —
    // it's the same source the Analytics page reports.
    const sessions = sessionRows ?? [];
    const secondsPerCourse = secondsByCourse(sessions);
    const totalSeconds = sessions.reduce((s, r) => s + r.seconds, 0);

    const perCourse: PerCourse[] = enrolledCourses.map((c) => {
      const total = totalModulesByCourse.get(c.id) ?? 0;
      const done = completedModulesByCourse.get(c.id) ?? 0;
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
        { name: "Completed", value: completedModules },
        { name: "In Progress", value: inProgressModules },
        // { name: "Not Started", value: notStartedModules },
      ] as DonutDatum[],
      totalSeconds,
      avgScore,
      quizzes: att.length,
    };
  }, [
    courseLessons,
    progressRows,
    sessionRows,
    enrolledCourses,
    attempts,
    courseTopics,
    moduleAttempts,
  ]);

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

  // Module + general finished attempts, newest first — display only.
  const recentAttempts = useMemo<RecentAttempt[]>(() => {
    const mod: RecentAttempt[] = (attempts ?? []).map((a) => ({
      id: a.id,
      score: a.score,
      total: a.total,
      finished_at: a.finished_at,
      kind: "module",
      title: a.topics?.title ?? "Quiz",
      courseTitle: a.topics?.courses?.title ?? null,
    }));
    const gen: RecentAttempt[] = (generalAttempts ?? []).map((a) => ({
      id: a.id,
      score: a.score,
      total: a.total,
      finished_at: a.finished_at,
      kind: "general",
      title: a.course_quizzes?.title ?? "General Course Quiz",
      courseTitle: a.course_quizzes?.courses?.title ?? null,
    }));
    const ts = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
    return [...mod, ...gen].sort((a, b) => ts(b.finished_at) - ts(a.finished_at)).slice(0, 6);
  }, [attempts, generalAttempts]);

  return {
    enrolledCourses,
    perCourse: stats.perCourse,
    overallPct: stats.overallPct,
    donut: stats.donut,
    continueCourse,
    recommended,
    recentAttempts,
    quizzes: stats.quizzes,
    avgScore: stats.avgScore,
    totalSeconds: stats.totalSeconds,
  };
}
