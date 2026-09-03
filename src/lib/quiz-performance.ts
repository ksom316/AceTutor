/**
 * Shared interpretation of a student's MODULE quiz attempts for one course.
 *
 * The single source of truth for "what does this student's quiz performance
 * mean" — used by the course page, the My Performance page, the module Study
 * Path gateway, the adaptive card, and the AI tutor's performance summary.
 * Performance answers WHAT a student needs to work on; Learning Preferences
 * (elsewhere) answer HOW it is presented.
 *
 * Four rules that matter:
 *
 *  1. USABLE vs SUFFICIENT. A "usable" attempt is finished with at least one
 *     answered question — it still shows the raw result and stays in quiz
 *     history. A "sufficient" attempt also covers enough of the quiz to be
 *     reliable evidence (>= MIN_ANSWERED_FOR_PERFORMANCE questions AND
 *     >= MIN_ANSWER_COVERAGE of the quiz). ONLY sufficient attempts drive the
 *     module average, weak/strong state, the Study Path anchor and remediation
 *     evidence. A blank submission is neither; legacy rows
 *     (`answered_count === null`) are treated as fully answered.
 *
 *  2. Adaptive decisions are made PER MODULE, never course-wide. Each module has
 *     its own average, its own state, and its own current Study Path.
 *
 *  3. A module's standing is the mean score across ALL of the student's
 *     SUFFICIENT attempts for that module. A sustained turnaround (studying +
 *     retaking well) pulls the average up until the module is no longer weak;
 *     older attempts and old Study Paths stay in history but never keep a module
 *     weak on their own — only the current average does. Partial attempts move
 *     nothing.
 *
 *  4. A module with answered-but-insufficient attempts is in the "insufficient"
 *     state — not weak, not strong. The student is asked to answer more of the
 *     quiz, and no Study Path is offered or generated.
 */

export const WEAK_THRESHOLD = 70;

/**
 * "Sufficient evidence" bar. An attempt only contributes to ADAPTIVE
 * performance (module average, weak/strong, Study Path anchor, remediation
 * evidence) when the student answered enough of the quiz for the result to be
 * reliable: at least `MIN_ANSWERED_FOR_PERFORMANCE` questions AND at least
 * `MIN_ANSWER_COVERAGE` of the quiz. Both must hold — "answered 3" alone is not
 * enough on a 20-question quiz.
 */
export const MIN_ANSWERED_FOR_PERFORMANCE = 3;
export const MIN_ANSWER_COVERAGE = 0.5;

export type PerfAttempt = {
  id: string;
  topic_id: string | null;
  score: number | null;
  total: number | null;
  finished_at: string | null;
  answered_count?: number | null;
  started_at?: string | null;
};

export type PerfTopic = { id: string; title: string };

/** How many questions the student answered. Legacy rows predate the counter and
 *  are treated as fully answered. */
export function answeredCountOf(a: PerfAttempt): number {
  return a.answered_count ?? a.total ?? 0;
}

/** A finished attempt with at least one answered question. Still shows the raw
 *  result and stays in quiz history — but see {@link isSufficientAttempt} for
 *  whether it counts toward adaptive performance. */
export function isUsableAttempt(a: PerfAttempt): boolean {
  return !!a.finished_at && (a.total ?? 0) > 0 && answeredCountOf(a) > 0;
}

/** A usable attempt that also covers enough of the quiz to be reliable
 *  evidence. ONLY these attempts drive the module average, weak/strong state,
 *  the current Study Path anchor, and Study Path remediation evidence. */
export function isSufficientAttempt(a: PerfAttempt): boolean {
  if (!isUsableAttempt(a)) return false;
  const total = a.total ?? 0;
  const answered = answeredCountOf(a);
  return answered >= MIN_ANSWERED_FOR_PERFORMANCE && answered / total >= MIN_ANSWER_COVERAGE;
}

function pct(score: number | null, total: number | null): number {
  return total && total > 0 ? Math.round(((score ?? 0) / total) * 100) : 0;
}

function attemptTime(a: PerfAttempt): number {
  return new Date(a.finished_at ?? a.started_at ?? 0).getTime();
}

/**
 * A module's standing: the mean score % across every SUFFICIENT attempt the
 * student has made for that module. null when there is no sufficient attempt.
 * Exported so `generateStudyPath` frames the Study Path with the exact same
 * number the UI shows — one averaging methodology, one call site.
 */
export function sufficientModuleAverage(moduleAttempts: PerfAttempt[]): number | null {
  const enough = moduleAttempts.filter(isSufficientAttempt);
  if (enough.length === 0) return null;
  return Math.round(enough.reduce((s, a) => s + pct(a.score, a.total), 0) / enough.length);
}

export type ModuleState = "no-data" | "insufficient" | "weak" | "strong";

export type ModulePerformance = {
  topic: PerfTopic;
  /** Mean score % across the module's SUFFICIENT attempts; null when none.
   *  Drives the weak/strong decision. Partial attempts never move it. */
  averageScore: number | null;
  /** Score % of the student's most recent USABLE (answered) attempt — the
   *  student-facing "last quiz" figure. May come from a partial attempt, so
   *  pair it with `answeredCount` / `totalQuestions` when displaying. */
  lastUsableScore: number | null;
  /** Score % of the most recent SUFFICIENT attempt (the one that actually moved
   *  the average). null when there is no sufficient attempt. Distinct from
   *  `lastUsableScore`, which can be a partial. */
  latestSufficientScore: number | null;
  /** Score % of the SECOND-most-recent sufficient attempt — the "before" in a
   *  retake comparison. null when there are fewer than two sufficient attempts. */
  previousSufficientScore: number | null;
  /** `latestSufficientScore - previousSufficientScore`, in percentage points.
   *  null unless there are at least two sufficient attempts. Positive = improved.
   *  The module `averageScore` / `state` are unaffected by this — it is purely a
   *  "what changed since you last had reliable evidence" signal for the UI. */
  improvementPoints: number | null;
  /** Score % of every SUFFICIENT attempt for this module, oldest first — the raw
   *  material for a simple "55% → 63% → 71%" trend. Partial attempts are never
   *  included. Empty when there is no sufficient attempt. */
  sufficientScores: number[];
  /** Answered / total questions of that most recent usable attempt, so the UI
   *  can show "100% · 1/20 answered". null when there is no usable attempt. */
  answeredCount: number | null;
  totalQuestions: number | null;
  coveragePercent: number | null;
  /** Finished attempts for this module (usable or not). */
  attemptCount: number;
  usableAttemptCount: number;
  /** Usable attempts that also clear the coverage bar. */
  sufficientAttemptCount: number;
  /** Finished attempts with no usable signal (blank submissions). */
  unusableAttemptCount: number;
  /**
   * The attempt that identifies this module's CURRENT Study Path: the latest
   * SUFFICIENT, imperfect attempt for the module. `study_paths.attempt_id ===
   * this` is the current path; any other `study_paths` row for the module's
   * topic is historical. A partial attempt never advances this, so a tiny
   * 1/20 retake cannot replace an existing adaptive Study Path. null when
   * nothing is remediable.
   */
  currentStudyPathAttemptId: string | null;
  state: ModuleState;
};

/** Per-module performance for a course. One entry per topic, in topic order. */
export function computeModulePerformances(
  topics: PerfTopic[],
  attempts: PerfAttempt[],
): ModulePerformance[] {
  const byTopic = new Map<string, PerfAttempt[]>();
  for (const a of attempts) {
    if (!a.topic_id || !a.finished_at) continue;
    const list = byTopic.get(a.topic_id);
    if (list) list.push(a);
    else byTopic.set(a.topic_id, [a]);
  }

  return topics.map((t): ModulePerformance => {
    const finished = (byTopic.get(t.id) ?? [])
      .slice()
      .sort((a, b) => attemptTime(a) - attemptTime(b));
    const usable = finished.filter(isUsableAttempt);
    const sufficient = finished.filter(isSufficientAttempt);
    const averageScore = sufficientModuleAverage(finished);

    const latestUsable = usable[usable.length - 1];
    const lastUsableScore = latestUsable ? pct(latestUsable.score, latestUsable.total) : null;

    // Retake comparison — latest vs previous SUFFICIENT attempt only (both
    // `finished` are sorted ascending above, so `sufficient` is too). Never
    // involves a partial attempt, and never changes `averageScore` / `state`.
    const latestSufficient = sufficient[sufficient.length - 1];
    const previousSufficient = sufficient[sufficient.length - 2];
    const latestSufficientScore = latestSufficient
      ? pct(latestSufficient.score, latestSufficient.total)
      : null;
    const previousSufficientScore = previousSufficient
      ? pct(previousSufficient.score, previousSufficient.total)
      : null;
    const improvementPoints =
      latestSufficientScore !== null && previousSufficientScore !== null
        ? latestSufficientScore - previousSufficientScore
        : null;
    const sufficientScores = sufficient.map((a) => pct(a.score, a.total));
    const answeredCount = latestUsable ? answeredCountOf(latestUsable) : null;
    const totalQuestions = latestUsable ? (latestUsable.total ?? 0) : null;
    const coveragePercent =
      latestUsable && (latestUsable.total ?? 0) > 0
        ? Math.round((answeredCountOf(latestUsable) / (latestUsable.total as number)) * 100)
        : null;

    const currentStudyPathAttemptId =
      [...sufficient].reverse().find((a) => (a.score ?? 0) < (a.total ?? 0))?.id ?? null;

    const state: ModuleState =
      usable.length === 0
        ? "no-data"
        : sufficient.length === 0
          ? "insufficient"
          : (averageScore ?? 0) < WEAK_THRESHOLD
            ? "weak"
            : "strong";

    return {
      topic: t,
      averageScore,
      lastUsableScore,
      latestSufficientScore,
      previousSufficientScore,
      improvementPoints,
      sufficientScores,
      answeredCount,
      totalQuestions,
      coveragePercent,
      attemptCount: finished.length,
      usableAttemptCount: usable.length,
      sufficientAttemptCount: sufficient.length,
      unusableAttemptCount: finished.length - usable.length,
      currentStudyPathAttemptId,
      state,
    };
  });
}

export type CoursePerformanceState = "no-data" | "insufficient" | "weak" | "strong";

/** Kept as a flat per-topic list for the course page's existing "Your
 *  performance" card. `accuracy` is the module average (see ModulePerformance). */
export type TopicPerformance = {
  topic: PerfTopic;
  accuracy: number | null;
  attempts: number;
  hasUsable: boolean;
};

export type CoursePerformance = {
  /**
   *  - "no-data":      no module has an answered attempt yet.
   *  - "insufficient": modules have answered attempts, but none clears the
   *                    coverage bar — no reliable weak/strong classification.
   *  - "weak":         at least one module has sufficient data and is below the
   *                    threshold.
   *  - "strong":       every module with sufficient data is at or above it.
   */
  state: CoursePerformanceState;
  /** Mean of the module averages that have SUFFICIENT data, or null. */
  overall: number | null;
  /** Per-module performance — the basis for every adaptive decision. */
  modules: ModulePerformance[];
  perTopic: TopicPerformance[];
  weak: { topic: PerfTopic; accuracy: number }[];
  strong: { topic: PerfTopic; accuracy: number }[];
  usableAttemptCount: number;
  sufficientAttemptCount: number;
  unusableAttemptCount: number;
};

export function computeCoursePerformance(
  topics: PerfTopic[],
  attempts: PerfAttempt[],
): CoursePerformance {
  const modules = computeModulePerformances(topics, attempts);

  const weak = modules
    .filter((m) => m.state === "weak")
    .sort((a, b) => (a.averageScore ?? 0) - (b.averageScore ?? 0))
    .map((m) => ({ topic: m.topic, accuracy: m.averageScore ?? 0 }));
  const strong = modules
    .filter((m) => m.state === "strong")
    .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))
    .map((m) => ({ topic: m.topic, accuracy: m.averageScore ?? 0 }));

  const perTopic: TopicPerformance[] = modules.map((m) => ({
    topic: m.topic,
    accuracy: m.averageScore,
    attempts: m.attemptCount,
    hasUsable: m.usableAttemptCount > 0,
  }));

  const scored = modules.filter((m) => m.averageScore !== null);
  const overall =
    scored.length > 0
      ? Math.round(scored.reduce((s, m) => s + (m.averageScore ?? 0), 0) / scored.length)
      : null;

  const usableAttemptCount = modules.reduce((s, m) => s + m.usableAttemptCount, 0);
  const sufficientAttemptCount = modules.reduce((s, m) => s + m.sufficientAttemptCount, 0);
  const unusableAttemptCount = modules.reduce((s, m) => s + m.unusableAttemptCount, 0);

  const state: CoursePerformanceState =
    usableAttemptCount === 0
      ? "no-data"
      : weak.length > 0
        ? "weak"
        : strong.length > 0
          ? "strong"
          : "insufficient";

  return {
    state,
    overall,
    modules,
    perTopic,
    weak,
    strong,
    usableAttemptCount,
    sufficientAttemptCount,
    unusableAttemptCount,
  };
}

/**
 * "↑ 8 points since your previous quiz" / "↓ 5 points since your previous quiz",
 * or null when there is no meaningful two-attempt comparison to show (fewer than
 * two sufficient attempts, or no change). Percentage points, never relative %.
 * Shared so every surface phrases the retake delta identically.
 */
export function improvementLabel(m: ModulePerformance): string | null {
  const d = m.improvementPoints;
  if (d === null || d === 0) return null;
  const n = Math.abs(d);
  return d > 0
    ? `↑ ${n} point${n === 1 ? "" : "s"} since your previous quiz`
    : `↓ ${n} point${n === 1 ? "" : "s"} since your previous quiz`;
}

/**
 * "55% → 63% → 71%" across a module's most recent sufficient attempts (up to
 * `max`, oldest → newest), or null when there are fewer than two. Deterministic,
 * sufficient attempts only — a lightweight "performance over time" view without a
 * chart.
 */
export function sufficientTrendLabel(m: ModulePerformance, max = 5): string | null {
  if (m.sufficientScores.length < 2) return null;
  return m.sufficientScores.slice(-max).map((s) => `${s}%`).join(" → ");
}

/**
 * True when a retake has just carried this module up to a strong level: it is
 * strong now, the previous sufficient attempt was below par, and the latest
 * sufficient attempt improved on it. UI-only signal for a positive message — the
 * authoritative state is still `m.state`.
 */
export function justReachedStrong(m: ModulePerformance): boolean {
  return (
    m.state === "strong" &&
    m.previousSufficientScore !== null &&
    m.previousSufficientScore < WEAK_THRESHOLD &&
    (m.improvementPoints ?? 0) > 0
  );
}

/**
 * The AI-tutor `performanceSummary` string — built only from SUFFICIENT data.
 * Returns "" when no module has a reliable average yet (callers treat "" as
 * "no performance data" and skip recommendations).
 */
export function buildPerformanceSummary(perf: CoursePerformance, totalModules: number): string {
  if (perf.sufficientAttemptCount === 0) return "";
  const withData = perf.modules.filter((m) => m.sufficientAttemptCount > 0).length;
  return [
    `Overall accuracy: ${perf.overall ?? 0}%`,
    `Modules with reliable quiz data: ${withData}/${totalModules}`,
    "",
    "Module performance (average across attempts that covered enough of the quiz):",
    ...perf.modules.map((m) => {
      if (m.averageScore !== null) return `- ${m.topic.title}: ${m.averageScore}%`;
      if (m.state === "insufficient")
        return `- ${m.topic.title}: attempted, but not enough questions answered to assess`;
      return `- ${m.topic.title}: Not attempted`;
    }),
  ].join("\n");
}
