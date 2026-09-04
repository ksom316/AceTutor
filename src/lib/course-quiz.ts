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

/** "Sep 15, 2026 at 11:59 PM" — viewer's timezone. "" for a null/invalid value.
 *  Used for the schedule dates on the student + lecturer quiz cards. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Short relative hint, e.g. "in 6 hours" / "in 3 days" / "2 hours ago". Pairs
 *  with an exact `formatDateTime` string — never shown on its own. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffMin = Math.round((t - now) / 60000);
  const past = diffMin < 0;
  const m = Math.abs(diffMin);
  const say = (n: number, unit: string) =>
    past ? `${n} ${unit}${n === 1 ? "" : "s"} ago` : `in ${n} ${unit}${n === 1 ? "" : "s"}`;
  if (m < 1) return "now";
  if (m < 60) return say(m, "minute");
  const h = Math.round(m / 60);
  if (h < 24) return say(h, "hour");
  return say(Math.round(h / 24), "day");
}

/* ---- General Course Quiz lifecycle status (shared: student + lecturer) ---- */

/** One deterministic status so the student card, the lecturer card and the
 *  runner never disagree. `deadline` is the absolute due instant (the existing
 *  `course_quizzes.deadline`); `availableFrom` is the new lower bound. Either
 *  may be null. `completed` = the student already has a finished attempt (for
 *  the lecturer view, pass `false`). */
export type GeneralQuizStatus = "upcoming" | "available" | "due_soon" | "closed" | "completed";

export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

export function generalQuizStatus(input: {
  availableFrom: string | null | undefined;
  deadline: string | null | undefined;
  completed?: boolean;
  now?: number;
}): GeneralQuizStatus {
  const now = input.now ?? Date.now();
  if (input.completed) return "completed";

  const from = input.availableFrom ? Date.parse(input.availableFrom) : NaN;
  if (!Number.isNaN(from) && now < from) return "upcoming";

  const due = input.deadline ? Date.parse(input.deadline) : NaN;
  if (!Number.isNaN(due)) {
    if (now >= due) return "closed";
    if (now >= due - DUE_SOON_MS) return "due_soon";
  }
  return "available";
}

/** The instant a live General Course Quiz attempt actually ends:
 *  `min(attempt.expires_at, course_quizzes.deadline)`. `expires_at` is the
 *  student's normal, immutable timer; the deadline is an absolute upper bound
 *  that a lecturer can move earlier mid-attempt. Mirrors the server
 *  (save_quiz_answer / finalize_expired_quiz_attempts / grade_quiz). Returns an
 *  ISO string, or null when neither bound is known. */
export function effectiveQuizDeadline(
  expiresAt: string | null | undefined,
  courseQuizDeadline: string | null | undefined,
): string | null {
  const times = [expiresAt, courseQuizDeadline]
    .map((v) => (v ? Date.parse(v) : NaN))
    .filter((n) => !Number.isNaN(n));
  if (times.length === 0) return null;
  return new Date(Math.min(...times)).toISOString();
}

/** Lecturer-facing lifecycle label for a status. */
export function generalQuizStatusLabel(status: GeneralQuizStatus): string {
  switch (status) {
    case "upcoming":
      return "Scheduled";
    case "available":
      return "Active";
    case "due_soon":
      return "Due soon";
    case "closed":
      return "Closed";
    case "completed":
      return "Completed";
  }
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

/* ---- maximum retry attempts (General Course Quizzes only) ---- */

/**
 * `course_quizzes.max_attempts`: a positive integer cap, or NULL for unlimited.
 * NULL is the default and preserves the original unlimited-retries behaviour.
 * The database trigger `enforce_course_quiz_attempt()` is the authoritative
 * enforcement — the UI values here are for display and pre-checks only.
 */
export const MAX_ATTEMPTS_CHOICES = [1, 2, 3, 5, 10] as const;

/** Options for the lecturer's "Maximum attempts" select, unlimited first-class. */
export const MAX_ATTEMPTS_OPTIONS: { value: string; label: string }[] = [
  ...MAX_ATTEMPTS_CHOICES.map((n) => ({
    value: String(n),
    label: `${n} attempt${n === 1 ? "" : "s"}`,
  })),
  { value: "unlimited", label: "Unlimited" },
];

/** Select value (string) -> DB column value. "unlimited" / "" / invalid -> null. */
export function maxAttemptsFromSelectValue(value: string): number | null {
  if (value === "unlimited" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** DB column value -> select value. null -> "unlimited". */
export function maxAttemptsToSelectValue(max: number | null | undefined): string {
  return max == null ? "unlimited" : String(max);
}

/** Whether a student with `used` attempts can start another. */
export function canAttemptCourseQuiz(used: number, max: number | null | undefined): boolean {
  return max == null || used < max;
}

/** "3 attempts allowed" · "Unlimited attempts". */
export function maxAttemptsLabel(max: number | null | undefined): string {
  if (max == null) return "Unlimited attempts";
  return `${max} attempt${max === 1 ? "" : "s"} allowed`;
}

/** Student-facing usage summary, e.g. "1 / 3 used" or "2 used · unlimited". */
export function attemptsUsageLabel(used: number, max: number | null | undefined): string {
  return max == null ? `${used} used · unlimited` : `${used} / ${max} used`;
}
