import { supabase } from "@/integrations/supabase/client";

/**
 * Centralised Supabase fetchers. Screens call these via react-query with the
 * matching key so navigating between screens reuses cached data (same pattern
 * as the web app).
 */

export const keys = {
  profile: (uid?: string) => ["profile", uid] as const,
  role: (uid?: string) => ["role", uid] as const,
  enrollments: (uid?: string) => ["enrollments", uid] as const,
  allCourses: () => ["all-courses"] as const,
  lessons: (ids: string[]) => ["lessons", ids] as const,
  progress: (uid?: string) => ["progress", uid] as const,
  attempts: (uid?: string) => ["attempts", uid] as const,
  course: (slug: string) => ["course", slug] as const,
  topics: (courseId?: string) => ["topics", courseId] as const,
  enrollment: (uid?: string, courseId?: string) => ["enrollment", uid, courseId] as const,
  courseAttempts: (uid?: string, courseId?: string) => ["course-attempts", uid, courseId] as const,
  topic: (id: string) => ["topic", id] as const,
  result: (id: string) => ["result", id] as const,
};

export async function fetchProfile(uid: string) {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, avatar_url, vark_primary, created_at")
    .eq("id", uid)
    .maybeSingle();
  return data;
}

export async function fetchRole(uid: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .maybeSingle();
  return (data?.role as string | undefined) ?? "student";
}

export async function fetchEnrollments() {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id, created_at, courses(id, slug, title, summary)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as { courses: Course | null }[];
  return rows.map((e) => e.courses).filter(Boolean) as Course[];
}

export async function fetchAllCourses() {
  const { data } = await supabase
    .from("courses")
    .select("id, slug, title, summary, order_index")
    .order("order_index");
  return (data ?? []) as Course[];
}

export async function fetchLessonsForCourses(courseIds: string[]) {
  const { data } = await supabase
    .from("lessons")
    .select("id, topics!inner(course_id)")
    .in("topics.course_id", courseIds);
  return (data ?? []) as unknown as LessonRow[];
}

export async function fetchProgress(uid: string) {
  const { data } = await supabase
    .from("progress")
    .select("completed_at, watched_seconds, updated_at, lessons!inner(id, topics!inner(course_id))")
    .eq("user_id", uid);
  return (data ?? []) as unknown as ProgressRow[];
}

export async function fetchAttempts(uid: string, limit = 20) {
  const { data } = await supabase
    .from("quiz_attempts")
    .select(
      "id, score, total, finished_at, topic_id, topics(title, slug, courses(id, title, slug))",
    )
    .eq("user_id", uid)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as AttemptRow[];
}

export type Course = { id: string; slug: string; title: string; summary: string | null };

/** Row shapes for the nested Supabase selects above (kept minimal to what screens read). */
export type LessonRow = { id: string; topics: { course_id: string } | null };
export type ProgressRow = {
  completed_at: string | null;
  watched_seconds: number | null;
  updated_at: string | null;
  lessons: { id: string; topics: { course_id: string } | null } | null;
};
export type AttemptCourse = { id: string; title: string; slug: string };
export type AttemptRow = {
  id: string;
  score: number | null;
  total: number | null;
  finished_at: string | null;
  topic_id: string;
  topics: { title: string; slug: string; courses: AttemptCourse | null } | null;
};
export type Topic = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  order_index: number;
};
