import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
 * (60s + refetch on window focus). Every write (read / mark-all-read / delete
 * / clear-all) updates the shared cache entry DIRECTLY (`setQueryData`) the
 * instant the Supabase write succeeds, then also invalidates it as a
 * background reconciliation with the server. The direct write is what makes
 * every surface (Notifications page, bell badge, sidebar/offcanvas indicator)
 * reflect the change immediately and consistently: it does not require a
 * second network round-trip, and it does not depend on the component that
 * triggered the action still being mounted/"active" — a plain
 * `invalidateQueries()` only refetches currently-active observers, so a
 * notification click that BOTH marks-read AND navigates away (the common
 * path) could otherwise leave the bell/sidebar showing the old count until
 * their next 60s poll or window-focus refetch. `setQueryData` reaches every
 * subscriber of the cache key immediately, regardless of navigation.
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
  const queryKey = [NOTIFICATIONS_KEY, user?.id, audience] as const;

  const query = useQuery({
    queryKey,
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

  const invalidate = () => qc.invalidateQueries({ queryKey });

  /** Writes straight into the shared cache entry so every mounted surface
   *  (this hook may have several simultaneous instances — bell, sidebar,
   *  offcanvas, the Notifications page) re-renders with the new value on the
   *  next tick, with no network round-trip and no dependency on any one of
   *  them still being mounted. A no-op if the query has no cached data yet
   *  (nothing to update — the next real fetch will already be correct). */
  const patch = (updater: (rows: AppNotification[]) => AppNotification[]) =>
    qc.setQueryData<AppNotification[]>(queryKey, (old) => (old ? updater(old) : old));

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      const nowIso = new Date().toISOString();
      patch((rows) => rows.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? nowIso } : n)));
      invalidate();
    },
    onError: () => toast.error("Couldn't mark this notification as read. Please try again."),
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
    onSuccess: () => {
      const nowIso = new Date().toISOString();
      patch((rows) => rows.map((n) => (n.read_at ? n : { ...n, read_at: nowIso })));
      invalidate();
    },
    onError: () => toast.error("Couldn't mark your notifications as read. Please try again."),
  });

  // Deletion relies entirely on RLS (notifications_delete_own: auth.uid() =
  // user_id) for ownership — the query below never filters by user_id itself,
  // so there is nothing client-supplied for a caller to spoof.
  const deleteOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      patch((rows) => rows.filter((n) => n.id !== id));
      invalidate();
    },
    onError: () => toast.error("Couldn't delete this notification. Please try again."),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("notifications").delete().eq("audience", audience);
      if (error) throw error;
    },
    onSuccess: () => {
      patch(() => []);
      invalidate();
    },
    onError: () => toast.error("Couldn't clear your notifications. Please try again."),
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
    deleteOne: (id: string) => deleteOne.mutate(id),
    /** The id of the notification currently being deleted, or null. */
    deletingId: deleteOne.isPending ? (deleteOne.variables ?? null) : null,
    clearAll: (opts?: { onSuccess?: () => void }) => clearAll.mutate(undefined, opts),
    clearingAll: clearAll.isPending,
  };
}

export type NotificationTarget =
  | { kind: "topic"; topicId: string }
  | { kind: "course-quiz"; quizId: string }
  | { kind: "course"; slug: string }
  | { kind: "lecturer-students" }
  | { kind: "lecturer-performance" }
  | { kind: "lecturer-quiz"; quizId: string }
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
    if ((n.kind === "general_quiz_active" || n.kind === "general_quiz_deadline") && n.quiz_id) {
      return { kind: "lecturer-quiz", quizId: n.quiz_id };
    }
    return null;
  }
  // Module content (material / module quiz / their updates) → the module page.
  if (n.topic_id) return { kind: "topic", topicId: n.topic_id };
  // General course quiz (and its updates) → the course page, not the runner.
  if (n.course?.slug) return { kind: "course", slug: n.course.slug };
  return null;
}
