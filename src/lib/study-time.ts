/**
 * Study-time tracking rules, shared by the tracker (src/hooks/use-study-time.tsx)
 * and the Analytics page.
 *
 * Only *learning* surfaces are timed — a course page, a module, a quiz or a
 * word game. Time on the dashboard, settings, profile or marketing pages isn't
 * counted, so "time learning" means what it says.
 */

/** Which kind of learning surface a stretch of time was spent on. */
export type StudySurface = "course" | "module" | "quiz" | "game";

export const SURFACE_LABELS: Record<StudySurface, string> = {
  course: "Course pages",
  module: "Modules & lessons",
  quiz: "Quizzes",
  game: "Word games",
};

/** Tick length: the timer adds this many seconds per beat. */
export const TICK_SECONDS = 1;
/** How often accumulated time is written to Supabase. */
export const FLUSH_SECONDS = 30;
/** No pointer, key or scroll activity for this long pauses the clock. */
export const IDLE_SECONDS = 90;
/** A gap longer than this starts a fresh session row rather than extending one. */
export const SESSION_GAP_SECONDS = 30 * 60;

/**
 * The learning surface for a pathname, or `null` when the page isn't a
 * learning surface and shouldn't be timed.
 */
export function surfaceForPath(pathname: string): StudySurface | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/games") return "game";
  if (path.startsWith("/topic/")) return "module";
  if (path.startsWith("/quiz/") || path.startsWith("/result/")) return "quiz";
  // Course detail pages only — /courses (the catalog) is browsing, not studying.
  if (/^\/courses\/[^/]+$/.test(path)) return "course";
  return null;
}

export type StudySessionRow = {
  course_id: string | null;
  surface: string;
  started_at: string;
  seconds: number;
};

/** `seconds` totalled per course id (`""` for course-agnostic time). */
export function secondsByCourse(rows: StudySessionRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.course_id ?? "";
    map.set(key, (map.get(key) ?? 0) + row.seconds);
  }
  return map;
}

/** `seconds` totalled per surface, in a stable display order. */
export function secondsBySurface(
  rows: StudySessionRow[],
): { surface: StudySurface; seconds: number }[] {
  const order: StudySurface[] = ["module", "course", "quiz", "game"];
  const totals = new Map<StudySurface, number>();
  for (const row of rows) {
    const surface = (
      order.includes(row.surface as StudySurface) ? row.surface : "course"
    ) as StudySurface;
    totals.set(surface, (totals.get(surface) ?? 0) + row.seconds);
  }
  return order
    .map((surface) => ({ surface, seconds: totals.get(surface) ?? 0 }))
    .filter((entry) => entry.seconds > 0);
}

/**
 * Number of distinct days with recorded study time, counting back from today —
 * the current streak, so it breaks as soon as a day is missed.
 */
export function studyStreak(rows: StudySessionRow[], now = new Date()): number {
  const days = new Set(rows.map((r) => new Date(r.started_at).toDateString()));
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  // Yesterday still counts as an unbroken streak until today is used.
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
