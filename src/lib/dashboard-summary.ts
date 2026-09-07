/**
 * P1.2 — pure PRESENTATION helpers for the student dashboard.
 *
 * These NEVER recompute progress, completion, or mastery — they only reshape
 * the numbers `useStudentDashboard` already produced (module counts, the
 * overall percentage, per-course mastery from `computeCourseMastery`) into the
 * shapes the dashboard cards render, and derive plain "what should I do next"
 * guidance from the student's EXISTING course/module state.
 *
 * No AI, no new metrics, no Supabase, no React. Deterministic.
 */

import { masteryLabel, masteryLevel, type MasteryLevel } from "@/lib/mastery";

/** The per-course row the dashboard hook already exposes (subset used here). */
export type DashCourse = {
  id: string;
  slug: string;
  title: string;
  /** modules in the course. */
  total: number;
  /** modules with a finished quiz attempt. */
  done: number;
  /** lessons the student has any progress on. */
  touched: number;
  /** official course-completion % — from the hook, never recomputed here. */
  pct: number;
  masteryScore: number | null;
  masteryLevel: MasteryLevel;
  masteryAssessedModules: number;
};

/* ----------------------- B. Your Learning Progress ---------------------- */

export type ModuleProgressSummary = {
  coursesEnrolled: number;
  coursesStarted: number;
  modulesTotal: number;
  modulesCompleted: number;
  modulesInProgress: number;
  modulesNotStarted: number;
  /** pass-through of the hook's `overallPct` — NOT recomputed. */
  overallPercent: number;
  /** false → the "no modules yet" empty state (don't render an empty chart). */
  hasData: boolean;
};

/**
 * @param completedModules  the hook's donut "Completed" value.
 * @param inProgressModules the hook's donut "In Progress" value.
 * @param overallPercent    the hook's `overallPct` — passed straight through.
 */
export function summarizeModuleProgress(input: {
  perCourse: readonly DashCourse[];
  completedModules: number;
  inProgressModules: number;
  overallPercent: number;
}): ModuleProgressSummary {
  const modulesTotal = input.perCourse.reduce((s, c) => s + Math.max(0, c.total), 0);
  const modulesCompleted = Math.max(0, input.completedModules);
  const modulesInProgress = Math.max(
    0,
    Math.min(input.inProgressModules, modulesTotal - modulesCompleted),
  );
  return {
    coursesEnrolled: input.perCourse.length,
    coursesStarted: input.perCourse.filter((c) => c.touched > 0 || c.done > 0).length,
    modulesTotal,
    modulesCompleted,
    modulesInProgress,
    modulesNotStarted: Math.max(0, modulesTotal - modulesCompleted - modulesInProgress),
    overallPercent: input.overallPercent,
    hasData: modulesTotal > 0,
  };
}

/* ------------------------- C. Mastery Score card ----------------------- */

export const MASTERY_BASIS_NOTE =
  "Mastery is based on your latest completed official module quiz performance. " +
  "AI practice quizzes, the General Course Quiz, and unfinished attempts don't count.";

export type CourseMasteryRow = {
  courseId: string;
  courseTitle: string;
  /** 0–100 from `computeCourseMastery`, never recomputed. */
  score: number;
  levelLabel: string;
  /** modules in the course with a completed official module quiz. */
  assessedModules: number;
};

export type MasteryCardModel = {
  rows: CourseMasteryRow[];
  /** total modules across the student's courses with a completed module quiz. */
  assessedModuleCount: number;
  /** One headline mastery number for the student — the mean of the assessed
   *  courses' mastery scores (each of which is already latest-attempt based, not
   *  a lifetime average). null when no course is assessed yet. This is what the
   *  dashboard / My Courses "Mastery" stat tile shows in place of the old
   *  "Average score". */
  overallScore: number | null;
  overallLevel: MasteryLevel;
  hasAny: boolean;
  note: string;
};

/** Straight projection of the hook's per-course mastery — only courses that
 *  actually have a score, strongest first. */
export function buildMasteryCardModel(perCourse: readonly DashCourse[]): MasteryCardModel {
  const rows: CourseMasteryRow[] = perCourse
    .filter((c): c is DashCourse & { masteryScore: number } => c.masteryScore != null)
    .map((c) => ({
      courseId: c.id,
      courseTitle: c.title,
      score: c.masteryScore,
      levelLabel: masteryLabel(c.masteryLevel),
      assessedModules: c.masteryAssessedModules,
    }))
    .sort((a, b) => b.score - a.score || a.courseTitle.localeCompare(b.courseTitle));

  const overallScore =
    rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null;

  return {
    rows,
    assessedModuleCount: rows.reduce((s, r) => s + r.assessedModules, 0),
    overallScore,
    overallLevel: masteryLevel(overallScore),
    hasAny: rows.length > 0,
    note: MASTERY_BASIS_NOTE,
  };
}

/* ---------------------- D. Recommended Next Steps --------------------- */

export type NextStepKind = "finish-module" | "start-course" | "review-course";

export type NextStep = {
  kind: NextStepKind;
  title: string;
  /** plain-language reason, from the student's own course state — never AI. */
  reason: string;
  courseSlug: string;
};

export const NEXT_STEPS_LIMIT = 3;

/**
 * "What to do next", built ONLY from existing state:
 *   1. modules already started but not finished  → "finish this"
 *   2. enrolled courses not started yet          → "start this"
 *   3. otherwise, if the current course is done  → "review this"
 * No scores, no weak-area inference, no AI.
 */
export function deriveNextSteps(input: {
  continueCourse: DashCourse | null;
  /** `moduleBreakdown.inProgress` from the hook. */
  inProgressModules: readonly { title: string; courseTitle: string }[];
  perCourse: readonly DashCourse[];
  /** `recommended` from the hook — enrolled courses with no activity yet. */
  untouchedCourses: readonly { slug: string; title: string }[];
  limit?: number;
}): NextStep[] {
  const limit = input.limit ?? NEXT_STEPS_LIMIT;
  const slugByTitle = new Map(input.perCourse.map((c) => [c.title, c.slug]));
  const steps: NextStep[] = [];

  for (const m of input.inProgressModules) {
    const slug = slugByTitle.get(m.courseTitle);
    if (!slug) continue;
    steps.push({
      kind: "finish-module",
      title: m.title,
      reason: `You started this module in ${m.courseTitle} but haven't finished its quiz yet.`,
      courseSlug: slug,
    });
    if (steps.length >= limit) return steps;
  }

  for (const c of input.untouchedCourses) {
    steps.push({
      kind: "start-course",
      title: c.title,
      reason: "You're enrolled but haven't started this course yet.",
      courseSlug: c.slug,
    });
    if (steps.length >= limit) return steps;
  }

  if (
    steps.length === 0 &&
    input.continueCourse &&
    input.continueCourse.total > 0 &&
    input.continueCourse.pct >= 100
  ) {
    steps.push({
      kind: "review-course",
      title: input.continueCourse.title,
      reason: "You've completed every module — revisit anything you'd like to reinforce.",
      courseSlug: input.continueCourse.slug,
    });
  }

  return steps.slice(0, limit);
}
