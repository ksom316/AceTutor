/**
 * The Start / Resume / Review action a student sees for a course, derived
 * purely from the course's official progress percentage.
 *
 *   0%      → "start"   ("Start course")
 *   1–99%   → "resume"  ("Continue learning")
 *   100%    → "review"  ("Review course")
 *
 * This is NOT a progress calculation — callers pass the percentage from the
 * existing source of truth (per-course module completion). "Review" links back
 * into the same course learning experience; it never resets progress or
 * re-enrolls.
 */

export type CourseCtaState = "start" | "resume" | "review";

export function courseCtaState(pct: number): CourseCtaState {
  if (pct >= 100) return "review";
  if (pct > 0) return "resume";
  return "start";
}

export const COURSE_CTA_LABEL: Record<CourseCtaState, string> = {
  start: "Start course",
  resume: "Continue learning",
  review: "Review course",
};
