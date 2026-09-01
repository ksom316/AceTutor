import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";

/**
 * Shared notification feed for the signed-in user.
 *
 * One React Query cache key per (user, audience) — mounted by the top-bar bell
 * badge and by the notifications pages, so every consumer polls once. The
 * audience is derived from the database-backed role (`useRole()`), never from
 * the URL or client state: a lecturer sees only `audience = 'lecturer'` rows
 * (their assigned course's activity), a student sees only `audience = 'student'`
 * rows. RLS (`notifications_select_own`) already restricts every read to
 * `auth.uid() = user_id`; the audience filter is a second, explicit narrowing.
 *
 * There is no Supabase realtime channel anywhere in the app, so this polls
 * (60s + refetch on window focus) and invalidates immediately after the user's
 * own read / mark-all-read actions.
 */

export type NotificationAudience = "student" | "lecturer";

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
  audience: string;
  topic_id: string | null;
  quiz_id: string | null;
  course_id: string;
  course: { title: string | null; slug: string | null } | null;
};

const NOTIFICATIONS_KEY = "notifications";
const REFETCH_MS = 60_000;

function normalizeCourse(raw: unknown): { title: string | null; slug: string | null } | null {
  const c = Array.isArray(raw) ? raw[0] : raw;
  if (!c || typeof c !== "object") return null;
  const rec = c as { title?: string | null; slug?: string | null };
  return { title: rec.title ?? null, slug: rec.slug ?? null };
}

export function useNotifications() {
  const { user } = useAuth();
  const { isLecturer, loading: roleLoading } = useRole();
  const qc = useQueryClient();
  const audience: NotificationAudience = isLecturer ? "lecturer" : "student";
  const enabled = !!user && !roleLoading;

  const query = useQuery({
    queryKey: [NOTIFICATIONS_KEY, user?.id, audience],
    enabled,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, kind, title, message, created_at, read_at, audience, topic_id, quiz_id, course_id, courses(title, slug)",
        )
        .eq("audience", audience)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map(
        (row): AppNotification => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          message: row.message,
          created_at: row.created_at,
          read_at: row.read_at,
          audience: row.audience,
          topic_id: row.topic_id,
          quiz_id: row.quiz_id,
          course_id: row.course_id,
          course: normalizeCourse((row as { courses?: unknown }).courses),
        }),
      );
    },
  });

  const notifications = useMemo<AppNotification[]>(() => query.data ?? [], [query.data]);
  const unreadCount = useMemo(
    () => notifications.reduce((n, x) => n + (x.read_at ? 0 : 1), 0),
    [notifications],
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY, user?.id, audience] });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("audience", audience)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    audience,
    notifications,
    unreadCount,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    markRead: (id: string) => markRead.mutate(id),
    markAllRead: () => markAllRead.mutate(),
    markingAll: markAllRead.isPending,
  };
}

export type NotificationTarget =
  | { kind: "topic"; topicId: string }
  | { kind: "course-quiz"; quizId: string }
  | { kind: "course"; slug: string }
  | { kind: "lecturer-students" }
  | { kind: "lecturer-performance" }
  | null;

/**
 * Where a notification should navigate when clicked. Student notifications never
 * point straight at a quiz runner route: a module notification opens the module
 * page (the student starts the quiz from there), and a general course quiz
 * notification opens the course page's assessment section. Opening
 * `/course-quiz/$quizId` directly would create a quiz attempt on mount.
 */
export function notificationTarget(n: AppNotification): NotificationTarget {
  if (n.audience === "lecturer") {
    if (n.kind === "enrollment") return { kind: "lecturer-students" };
    if (n.kind === "quiz_completed" || n.kind === "module_completed") {
      return { kind: "lecturer-performance" };
    }
    return null;
  }
  // Module content (material / module quiz / their updates) → the module page.
  if (n.topic_id) return { kind: "topic", topicId: n.topic_id };
  // General course quiz (and its updates) → the course page, not the runner.
  if (n.course?.slug) return { kind: "course", slug: n.course.slug };
  return null;
}
