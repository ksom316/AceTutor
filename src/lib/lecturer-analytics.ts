/**
 * Lecturer-facing COURSE aggregate analytics.
 *
 * This is the aggregation layer that sits ON TOP of the student performance
 * model — it never re-defines "performance". Every per-student number comes from
 * `computeModulePerformances` in quiz-performance.ts (the single authoritative
 * definition of usable / sufficient / weak / strong / average / improvement /
 * trend); this module only groups those results across the students in a course.
 *
 *   Quiz attempts → quiz-performance.ts → per-student performance → (here) course aggregate
 *
 * Pure: data in, deterministic values out. No Supabase, no hooks, no UI, no AI.
 */

import {
  computeModulePerformances,
  WEAK_THRESHOLD,
  type ModulePerformance,
  type ModuleState,
  type PerfAttempt,
  type PerfTopic,
} from "@/lib/quiz-performance";

/** A module-quiz attempt row (from get_course_quiz_performance) reshaped to the
 *  PerfAttempt contract, plus the student identity used only for grouping. */
export type LecturerModuleAttempt = PerfAttempt & { student: string };

/** Reuses the exact student-model states — no new vocabulary. */
export type ModuleCohortState = ModuleState;

export type ModuleCohort = {
  topic: PerfTopic;
  /** Aggregate state for the module, derived with the SAME rule as a student
   *  module: no usable evidence → "no-data"; usable but nobody sufficient →
   *  "insufficient"; cohort average < 70 → "weak"; else "strong". */
  state: ModuleCohortState;
  /** Distinct students with at least one SUFFICIENT attempt for this module. */
  assessedStudents: number;
  /** Distinct students with answered attempts for this module but NO sufficient
   *  one (evidence started, not enough of it). */
  insufficientStudents: number;
  /** Distinct students who have any finished attempt for this module. */
  attemptedStudents: number;
  /** Mean of the sufficiently-assessed students' OWN module averages (each of
   *  which is `computeModulePerformances` → the authoritative per-student
   *  figure). null until at least one student is sufficiently assessed. */
  averageScore: number | null;
  /** Cohort trend: the mean of students' 1st, 2nd, 3rd… SUFFICIENT attempt
   *  scores, keeping only positions where at least two students contributed.
   *  [] when there isn't enough. Sufficient attempts only. */
  trend: number[];
  /** Assessed students whose latest sufficient attempt beat their previous one. */
  improvedStudents: number;
  /** Assessed students whose latest sufficient attempt was below their previous. */
  declinedStudents: number;
};

/** A cohort trend point must be backed by at least two students once there is
 *  more than one assessed student — so one student's retakes never masquerade as
 *  a cohort movement. With a single assessed student the trend is simply that
 *  student's own sufficient-attempt progression. */
const MAX_TREND_POINTS = 5;

function groupByStudent(attempts: LecturerModuleAttempt[]): Map<string, LecturerModuleAttempt[]> {
  const byStudent = new Map<string, LecturerModuleAttempt[]>();
  for (const a of attempts) {
    if (!a.topic_id) continue; // module attempts only — general quizzes are course-wide
    const list = byStudent.get(a.student);
    if (list) list.push(a);
    else byStudent.set(a.student, [a]);
  }
  return byStudent;
}

function mean(ns: number[]): number | null {
  return ns.length ? Math.round(ns.reduce((s, n) => s + n, 0) / ns.length) : null;
}

/**
 * Per-module aggregate performance for a course. One entry per topic, in topic
 * order. Every module is evaluated independently — one weak module never pulls
 * another down.
 */
export function computeModuleCohorts(
  topics: PerfTopic[],
  attempts: LecturerModuleAttempt[],
): ModuleCohort[] {
  const byStudent = groupByStudent(attempts);

  // topicId -> each participating student's ModulePerformance for that module
  const perModule = new Map<string, ModulePerformance[]>();
  for (const t of topics) perModule.set(t.id, []);
  for (const studentAttempts of byStudent.values()) {
    for (const mp of computeModulePerformances(topics, studentAttempts)) {
      if (mp.state === "no-data") continue; // this student hasn't touched this module
      perModule.get(mp.topic.id)?.push(mp);
    }
  }

  return topics.map((t): ModuleCohort => {
    const mps = perModule.get(t.id) ?? [];
    const assessed = mps.filter((m) => m.sufficientAttemptCount > 0);
    const averageScore = mean(
      assessed.map((m) => m.averageScore).filter((n): n is number => n !== null),
    );

    let state: ModuleCohortState;
    if (mps.length === 0) state = "no-data";
    else if (assessed.length === 0) state = "insufficient";
    else state = (averageScore ?? 0) < WEAK_THRESHOLD ? "weak" : "strong";

    const minPerTrendPoint = Math.min(2, assessed.length);
    const trend: number[] = [];
    for (let i = 0; i < MAX_TREND_POINTS; i++) {
      const nth = assessed
        .map((m) => m.sufficientScores[i])
        .filter((s): s is number => s !== undefined);
      if (nth.length < minPerTrendPoint || nth.length === 0) break;
      trend.push(mean(nth) as number);
    }

    return {
      topic: t,
      state,
      assessedStudents: assessed.length,
      insufficientStudents: mps.filter((m) => m.state === "insufficient").length,
      attemptedStudents: mps.length,
      averageScore,
      trend,
      improvedStudents: assessed.filter((m) => (m.improvementPoints ?? 0) > 0).length,
      declinedStudents: assessed.filter((m) => (m.improvementPoints ?? 0) < 0).length,
    };
  });
}

export type AssessmentCoverage = {
  enrolled: number;
  /** Students with meaningful evidence — at least one SUFFICIENT attempt in any
   *  module. */
  meaningful: number;
  /** Students who have answered questions but never enough of a quiz to assess. */
  insufficientOnly: number;
  /** Enrolled students with no usable module-quiz evidence at all. */
  notAssessed: number;
};

export function computeAssessmentCoverage(
  enrolled: number,
  topics: PerfTopic[],
  attempts: LecturerModuleAttempt[],
): AssessmentCoverage {
  const byStudent = groupByStudent(attempts);
  let meaningful = 0;
  let insufficientOnly = 0;
  for (const studentAttempts of byStudent.values()) {
    const mps = computeModulePerformances(topics, studentAttempts);
    if (mps.some((m) => m.sufficientAttemptCount > 0)) meaningful += 1;
    else if (mps.some((m) => m.usableAttemptCount > 0)) insufficientOnly += 1;
  }
  return {
    enrolled,
    meaningful,
    insufficientOnly,
    notAssessed: Math.max(0, enrolled - meaningful - insufficientOnly),
  };
}

export type CourseModuleSummary = {
  /** Evidence-based course average: the mean of the module cohort averages that
   *  have sufficient data. Distinct from any completed-attempt average shown
   *  elsewhere — this one is sufficient attempts only, module-weighted. null
   *  when no module is assessed. */
  overall: number | null;
  strongest: { title: string; average: number }[];
  attention: { title: string; average: number }[];
};

export function summariseCourseModules(cohorts: ModuleCohort[], topN = 3): CourseModuleSummary {
  const assessed = cohorts.filter((c) => c.averageScore !== null);
  return {
    overall: mean(assessed.map((c) => c.averageScore as number)),
    strongest: assessed
      .filter((c) => c.state === "strong")
      .sort((a, b) => (b.averageScore as number) - (a.averageScore as number))
      .slice(0, topN)
      .map((c) => ({ title: c.topic.title, average: c.averageScore as number })),
    attention: assessed
      .filter((c) => c.state === "weak")
      .sort((a, b) => (a.averageScore as number) - (b.averageScore as number))
      .slice(0, topN)
      .map((c) => ({ title: c.topic.title, average: c.averageScore as number })),
  };
}

/**
 * A few plain-language, DETERMINISTIC observations for the lecturer. No AI —
 * every line is a direct read of the aggregates above, phrased no more
 * confidently than the data supports.
 */
export function courseInsights(cohorts: ModuleCohort[], coverage: AssessmentCoverage): string[] {
  const out: string[] = [];
  const assessed = cohorts.filter((c) => c.averageScore !== null);
  const weak = assessed
    .filter((c) => c.state === "weak")
    .sort((a, b) => (a.averageScore as number) - (b.averageScore as number));
  const strong = assessed
    .filter((c) => c.state === "strong")
    .sort((a, b) => (b.averageScore as number) - (a.averageScore as number));

  if (coverage.meaningful === 0) {
    if (coverage.enrolled > 0) {
      out.push(
        "No student has enough answered quiz evidence yet to assess module performance.",
      );
    }
    return out;
  }

  if (weak.length > 0) {
    const w = weak[0];
    out.push(
      `${w.topic.title} has the lowest performance among assessed modules — ${w.averageScore}% average across ${w.assessedStudents} assessed ${w.assessedStudents === 1 ? "student" : "students"}.`,
    );
  }
  if (strong.length > 0) {
    const s = strong[0];
    out.push(
      weak.length === 0
        ? `Assessed students are performing strongly across every assessed module (strongest: ${s.topic.title}, ${s.averageScore}%).`
        : `Assessed students are performing strongly in ${s.topic.title} (${s.averageScore}%).`,
    );
  }
  if (coverage.insufficientOnly > 0) {
    out.push(
      `${coverage.insufficientOnly} ${coverage.insufficientOnly === 1 ? "student has" : "students have"} quiz attempts but not enough answered questions to assess performance.`,
    );
  }
  const improving = assessed.find(
    (c) => c.trend.length >= 2 && c.trend[c.trend.length - 1] > c.trend[0],
  );
  if (improving) {
    out.push(
      `${improving.topic.title} shows improvement across recent sufficient attempts (${improving.trend.map((n) => `${n}%`).join(" → ")}).`,
    );
  }
  return out;
}
