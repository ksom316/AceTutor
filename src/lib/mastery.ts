import { isUsableAttempt, type PerfAttempt, type PerfTopic } from "@/lib/quiz-performance";

/**
 * Student MASTERY model — "how well does this student currently understand each
 * module?".
 *
 * Deliberately distinct from quiz-performance.ts, which AVERAGES a student's
 * sufficient attempts to drive adaptive Study Paths. Mastery is simpler and more
 * current:
 *
 *   Module Mastery = the % score of the student's MOST RECENT completed official
 *   module-quiz attempt. Never an average. The previous completed attempt score
 *   is retained ONLY so the UI can show a trend (improved / declined / same).
 *
 * A "completed official module-quiz attempt" is a `quiz_attempts` row that:
 *   - is tied to an official course module — its `topic_id` matches one of the
 *     course's topics. That is the ONLY kind of attempt this model reads. General
 *     Course Quiz attempts (which are `course_quiz_id`-based, never `topic_id`-
 *     based) do not match and never move module mastery. Any other quiz surface
 *     added later is out of scope here unless it, too, records an attempt against
 *     an official module `topic_id` — no assumption is made about how such
 *     surfaces store their results.
 *   - is finished with at least one answered question (`isUsableAttempt`), so a
 *     blank or instantly-timed-out submission cannot overwrite a real result.
 *
 * Course Mastery = the mean of the ASSESSED modules' mastery scores. Modules
 * with no completed module-quiz attempt are excluded from the mean — never
 * counted as 0. With no assessed module the course score is null ("Not
 * assessed"), never 0%.
 *
 * Course completion (elsewhere) is untouched: completion = how much of the
 * course is done; mastery = how well the assessed material is understood.
 *
 * Pure: data in, deterministic values out. No Supabase, no hooks, no UI, no AI.
 */

export type MasteryLevel =
  | "not-assessed"
  | "needs-support"
  | "developing"
  | "proficient"
  | "mastered";

export type MasteryTrend = "improved" | "declined" | "same" | null;

const BANDS: {
  min: number;
  level: Exclude<MasteryLevel, "not-assessed">;
  label: string;
}[] = [
  { min: 90, level: "mastered", label: "Mastered" },
  { min: 75, level: "proficient", label: "Proficient" },
  { min: 50, level: "developing", label: "Developing" },
  { min: 0, level: "needs-support", label: "Needs Support" },
];

/** Band a 0–100 score into a mastery level. `null` → "not-assessed". */
export function masteryLevel(score: number | null): MasteryLevel {
  if (score === null || Number.isNaN(score)) return "not-assessed";
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]).level;
}

export function masteryLabel(level: MasteryLevel): string {
  if (level === "not-assessed") return "Not assessed";
  return BANDS.find((b) => b.level === level)!.label;
}

/** Tailwind classes for a mastery badge, using the app's existing tokens. */
export function masteryBadgeClasses(level: MasteryLevel): string {
  switch (level) {
    case "mastered":
      return "border-success/40 bg-success/10 text-success";
    case "proficient":
      return "border-primary/30 bg-primary/10 text-primary";
    case "developing":
      return "border-border bg-secondary text-foreground";
    case "needs-support":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function scorePercent(score: number | null, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.round(((score ?? 0) / total) * 100);
}

function attemptTime(a: PerfAttempt): number {
  return new Date(a.finished_at ?? a.started_at ?? 0).getTime();
}

/** Chronological order, oldest first. Two attempts finished at the same instant
 *  are ordered by attempt id so "latest" / "previous" is always deterministic. */
function byAttemptOrder(a: PerfAttempt, b: PerfAttempt): number {
  return attemptTime(a) - attemptTime(b) || a.id.localeCompare(b.id);
}

export type ModuleMastery = {
  topic: PerfTopic;
  /** % of the most recent completed module-quiz attempt; null when none. */
  score: number | null;
  /** % of the completed attempt before that; null when there are fewer than two. */
  previousScore: number | null;
  /** `score - previousScore`, in percentage points; null when no previous. */
  deltaPoints: number | null;
  level: MasteryLevel;
  /** improved / declined / same vs the previous completed attempt; null when
   *  there is only one completed attempt (or none). */
  trend: MasteryTrend;
  /** number of completed (usable) module-quiz attempts behind this. */
  completedAttempts: number;
};

export function computeModuleMastery(topic: PerfTopic, attempts: PerfAttempt[]): ModuleMastery {
  const completed = attempts
    .filter((a) => a.topic_id === topic.id && isUsableAttempt(a))
    .sort(byAttemptOrder);

  const latest = completed[completed.length - 1] ?? null;
  const previous = completed[completed.length - 2] ?? null;

  const score = latest ? scorePercent(latest.score, latest.total) : null;
  const previousScore = previous ? scorePercent(previous.score, previous.total) : null;
  const deltaPoints = score !== null && previousScore !== null ? score - previousScore : null;
  const trend: MasteryTrend =
    deltaPoints === null
      ? null
      : deltaPoints > 0
        ? "improved"
        : deltaPoints < 0
          ? "declined"
          : "same";

  return {
    topic,
    score,
    previousScore,
    deltaPoints,
    level: masteryLevel(score),
    trend,
    completedAttempts: completed.length,
  };
}

export function computeModuleMasteries(
  topics: PerfTopic[],
  attempts: PerfAttempt[],
): ModuleMastery[] {
  return topics.map((t) => computeModuleMastery(t, attempts));
}

export type CourseMastery = {
  /** Mean of the assessed modules' mastery scores; null ("Not assessed") when no
   *  module has a completed official module-quiz attempt. Unassessed modules are
   *  excluded from the mean — never counted as 0. */
  score: number | null;
  level: MasteryLevel;
  /** Modules with a mastery score. */
  assessedModules: number;
  totalModules: number;
  modules: ModuleMastery[];
};

export function computeCourseMastery(topics: PerfTopic[], attempts: PerfAttempt[]): CourseMastery {
  const modules = computeModuleMasteries(topics, attempts);
  const assessed = modules.filter((m) => m.score !== null);
  const score =
    assessed.length > 0
      ? Math.round(assessed.reduce((s, m) => s + (m.score as number), 0) / assessed.length)
      : null;
  return {
    score,
    level: masteryLevel(score),
    assessedModules: assessed.length,
    totalModules: topics.length,
    modules,
  };
}

/** "↑ 12 pts vs previous quiz" / "↓ 5 pts vs previous quiz" / null (no change or
 *  no previous attempt). Plain text for contexts without an icon. */
export function masteryTrendLabel(m: ModuleMastery): string | null {
  if (m.deltaPoints === null || m.deltaPoints === 0) return null;
  const n = Math.abs(m.deltaPoints);
  const unit = `pt${n === 1 ? "" : "s"}`;
  return m.deltaPoints > 0 ? `↑ ${n} ${unit} vs previous quiz` : `↓ ${n} ${unit} vs previous quiz`;
}
