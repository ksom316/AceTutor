/**
 * Module-quiz timing + completion-status helpers. Pure — no React, no server
 * imports. The authoritative deadline is `quiz_attempts.expires_at` (server,
 * stamped at insert from `topics.quiz_duration_minutes`); everything here is
 * display / client-hint only.
 */

/** Lecturer-selectable module quiz time limits, in minutes. 30 is the default. */
export const MODULE_QUIZ_DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120] as const;
export const DEFAULT_MODULE_QUIZ_DURATION = 30;

export function durationLabel(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

/** ms since epoch of the deadline, or null. */
export function deadlineMs(expiresAtIso: string | null | undefined): number | null {
  if (!expiresAtIso) return null;
  const t = Date.parse(expiresAtIso);
  return Number.isNaN(t) ? null : t;
}

/** "MM:SS" (or "H:MM:SS" past an hour). Negative clamps to 0. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type TimerTone = "normal" | "warning" | "critical" | "up";

/** Colour state for the runner's timer chip. */
export function timerTone(remainingMs: number): TimerTone {
  if (remainingMs <= 0) return "up";
  if (remainingMs <= 60_000) return "critical";
  if (remainingMs <= 5 * 60_000) return "warning";
  return "normal";
}

/* ---- completion status (lecturer workspace + results UI) ---- */

export type AttemptStatusKey = "in-progress" | "completed-full" | "completed-incomplete";

export type AttemptStatus = {
  key: AttemptStatusKey;
  /** Primary label — one of the three required states. */
  label: string;
  /** Optional secondary label, e.g. "Timed out". */
  note?: string;
  /** Emoji marker used in the primary states. */
  marker: "🟢" | "🟠" | "🔵";
};

/**
 * The three primary statuses:
 *   🔵 In progress                — started, not yet graded
 *   🟢 Completed — Fully answered  — graded, every question answered
 *   🟠 Completed — Incomplete      — graded with ≥1 unanswered question
 * `timedOut` is surfaced as a small secondary note, never as a replacement.
 * `answered` null (legacy rows) is treated as fully answered.
 */
export function attemptStatus(input: {
  finished: boolean;
  answered: number | null;
  total: number | null;
  timedOut?: boolean;
  expired?: boolean;
}): AttemptStatus {
  const { finished, answered, total, timedOut, expired } = input;
  if (!finished) {
    return {
      key: "in-progress",
      label: "In progress",
      note: expired ? "Timed out — not submitted" : undefined,
      marker: "🔵",
    };
  }
  const incomplete = answered != null && total != null && answered < total;
  if (incomplete) {
    return {
      key: "completed-incomplete",
      label: "Completed — Incomplete",
      note: timedOut ? "Timed out" : undefined,
      marker: "🟠",
    };
  }
  return {
    key: "completed-full",
    label: "Completed — Fully answered",
    note: timedOut ? "Timed out" : undefined,
    marker: "🟢",
  };
}
