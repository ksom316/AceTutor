/** Shared helpers for the lecturer-created General Course Quizzes (course-wide
 *  assessments, separate from module quizzes). Pure — no React, no server
 *  imports. Deadlines are absolute `timestamptz` values from the database; the
 *  UI shows and edits them in the viewer's local timezone. */

export type CourseQuizDeadlineStatus = "none" | "open" | "passed";

/** Where a deadline stands relative to now. `now` is injectable for tests. */
export function deadlineStatus(
  deadline: string | null | undefined,
  now: number = Date.now(),
): CourseQuizDeadlineStatus {
  if (!deadline) return "none";
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return "none";
  return now >= t ? "passed" : "open";
}

/** "No deadline" · "Sep 15, 2026 · 11:59 PM" — always in the viewer's timezone. */
export function formatDeadline(deadline: string | null | undefined): string {
  if (!deadline) return "No deadline";
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return "No deadline";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The viewer's IANA timezone name, e.g. "Africa/Nairobi" — shown next to the
 *  deadline field so lecturers know which clock they are setting. */
export function localTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "your local time";
  } catch {
    return "your local time";
  }
}

/** DB ISO timestamp -> value for <input type="datetime-local"> (local wall time). */
export function toDatetimeLocalValue(deadline: string | null | undefined): string {
  if (!deadline) return "";
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** <input type="datetime-local"> value (local wall time) -> absolute ISO string,
 *  or null when cleared. */
export function fromDatetimeLocalValue(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}
