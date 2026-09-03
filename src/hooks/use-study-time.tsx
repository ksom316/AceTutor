import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  FLUSH_SECONDS,
  IDLE_SECONDS,
  SESSION_GAP_SECONDS,
  surfaceForPath,
  TICK_SECONDS,
} from "@/lib/study-time";

type StudyTimeContextValue = {
  /** Attribute the time spent on this page to a course (null = course-agnostic). */
  setCourseId: (courseId: string | null) => void;
};

const StudyTimeContext = createContext<StudyTimeContextValue | null>(null);

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Records how long the signed-in user actually spends learning.
 *
 * The clock ticks once a second, but only while the tab is visible, the user
 * has interacted within the last {@link IDLE_SECONDS}, and the current route is
 * a learning surface (see `surfaceForPath`). Accumulated seconds are written to
 * `study_sessions` every {@link FLUSH_SECONDS}, when the surface or course
 * changes, and when the tab is hidden or closed — so at most a few seconds of
 * study time can be lost.
 */
export function StudyTimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const surface = surfaceForPath(pathname);

  const [courseId, setCourseId] = useState<string | null>(null);

  // Seconds counted but not yet written.
  const pendingRef = useRef(0);
  // Seconds already written to the open row, so updates can send a total.
  const savedRef = useRef(0);
  const rowIdRef = useRef<string | null>(null);
  // Identity of the row that's open: a new key means a new row.
  const rowKeyRef = useRef<string | null>(null);
  const lastActivityRef = useRef(Date.now());
  const lastCountedAtRef = useRef(0);
  const sinceFlushRef = useRef(0);
  // Mirror of the user id, so the flush callback can stay stable. The surface
  // and course a segment belongs to are carried in the flush `key` instead (see
  // `segmentKey` / `flush`), so they can't be lost when the page unmounts.
  const userIdRef = useRef<string | null>(user?.id ?? null);

  userIdRef.current = user?.id ?? null;

  /** Write pending seconds, extending the open row or opening a new one. */
  const flush = useCallback(async (key: string) => {
    const seconds = pendingRef.current;
    const userId = userIdRef.current;
    if (seconds <= 0 || !userId) return;
    pendingRef.current = 0;

    // A long gap since the last tick means the user was away: bank the time on
    // a fresh row rather than stretching the old one across the break.
    const stale =
      lastCountedAtRef.current > 0 &&
      Date.now() - lastCountedAtRef.current > SESSION_GAP_SECONDS * 1000;

    try {
      if (rowIdRef.current && rowKeyRef.current === key && !stale) {
        const total = savedRef.current + seconds;
        const { error } = await supabase
          .from("study_sessions")
          .update({ seconds: total, last_seen_at: new Date().toISOString() })
          .eq("id", rowIdRef.current);
        if (error) throw error;
        savedRef.current = total;
      } else {
        // The segment's surface and course are encoded in `key`
        // (`${surface}:${courseId}`), captured when this segment started — so an
        // unmount that resets the live course to null can't corrupt this write.
        const sep = key.indexOf(":");
        const keySurface = sep >= 0 ? key.slice(0, sep) : "none";
        const keyCourse = sep >= 0 ? key.slice(sep + 1) : "";
        const { data, error } = await supabase
          .from("study_sessions")
          .insert({
            user_id: userId,
            course_id: keyCourse || null,
            surface: keySurface === "none" ? "course" : keySurface,
            seconds,
          })
          .select("id")
          .single();
        if (error) throw error;
        rowIdRef.current = data?.id ?? null;
        rowKeyRef.current = key;
        savedRef.current = seconds;
      }
    } catch {
      // Offline, signed out mid-write, or the table isn't migrated yet — keep
      // the seconds so the next flush can try again. Study time is never worth
      // interrupting a lesson for.
      pendingRef.current += seconds;
    }
  }, []);

  // Idle detection: any interaction refreshes the clock.
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, bump, { passive: true });
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, bump);
    };
  }, []);

  const segmentKey = `${surface ?? "none"}:${courseId ?? ""}`;

  // The counter itself.
  useEffect(() => {
    if (!user || !surface) return;
    // Entering a learning page shouldn't look like idle time.
    lastActivityRef.current = Date.now();

    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current > IDLE_SECONDS * 1000) return;

      // Deliberately refs only — a state update every second would re-render
      // the whole app under this provider.
      pendingRef.current += TICK_SECONDS;
      sinceFlushRef.current += TICK_SECONDS;

      if (sinceFlushRef.current >= FLUSH_SECONDS) {
        sinceFlushRef.current = 0;
        void flush(segmentKey);
      }
      lastCountedAtRef.current = Date.now();
    }, TICK_SECONDS * 1000);

    return () => {
      clearInterval(id);
      // Leaving this surface (or signing out) closes the segment.
      sinceFlushRef.current = 0;
      void flush(segmentKey);
    };
  }, [user, surface, segmentKey, flush]);

  // Hiding or closing the tab banks whatever is pending.
  useEffect(() => {
    const save = () => {
      sinceFlushRef.current = 0;
      void flush(segmentKey);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
      else lastActivityRef.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, [flush, segmentKey]);

  const value = useMemo<StudyTimeContextValue>(() => ({ setCourseId }), []);

  return <StudyTimeContext.Provider value={value}>{children}</StudyTimeContext.Provider>;
}

/**
 * Attribute the current page's study time to a course. Safe to call with
 * `undefined` while the course is still loading, and on pages rendered outside
 * the provider (it simply does nothing).
 */
export function useStudyCourse(courseId: string | null | undefined) {
  const setCourseId = useContext(StudyTimeContext)?.setCourseId;

  useEffect(() => {
    if (!setCourseId) return;
    setCourseId(courseId ?? null);
    return () => setCourseId(null);
  }, [setCourseId, courseId]);
}
