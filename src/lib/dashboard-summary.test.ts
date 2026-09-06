/**
 * P1.2 — pure dashboard presentation helpers. They RESHAPE the numbers the
 * dashboard hook already computed (module counts, overall %, per-course
 * mastery) and derive plain next-step guidance — they never recompute
 * progress or mastery, never call AI, and never name an internal algorithm.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/dashboard-summary.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildMasteryCardModel,
  deriveNextSteps,
  MASTERY_BASIS_NOTE,
  summarizeModuleProgress,
  type DashCourse,
} from "@/lib/dashboard-summary";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const course = (over: Partial<DashCourse> & { id: string }): DashCourse => ({
  slug: `${over.id}-slug`,
  title: `Course ${over.id}`,
  total: 4,
  done: 0,
  touched: 0,
  pct: 0,
  masteryScore: null,
  masteryLevel: "not-assessed",
  masteryAssessedModules: 0,
  ...over,
});

/* ---------------------- B. module progress summary --------------------- */

test("summarizeModuleProgress passes overall % through untouched (no recompute)", () => {
  const s = summarizeModuleProgress({
    perCourse: [course({ id: "a", total: 5, done: 2, touched: 3 })],
    completedModules: 2,
    inProgressModules: 1,
    overallPercent: 37, // deliberately not 2/5 — proves it is a pass-through
  });
  assert.equal(s.overallPercent, 37);
  assert.equal(s.modulesTotal, 5);
  assert.equal(s.modulesCompleted, 2);
  assert.equal(s.modulesInProgress, 1);
  assert.equal(s.modulesNotStarted, 2);
  assert.equal(s.coursesStarted, 1);
  assert.equal(s.hasData, true);
});

test("summarizeModuleProgress: no modules => hasData false, safe zeros", () => {
  const s = summarizeModuleProgress({
    perCourse: [course({ id: "a", total: 0 })],
    completedModules: 0,
    inProgressModules: 0,
    overallPercent: 0,
  });
  assert.equal(s.hasData, false);
  assert.equal(s.modulesTotal, 0);
  assert.equal(s.modulesNotStarted, 0);
  assert.equal(s.coursesEnrolled, 1);
  assert.equal(s.coursesStarted, 0);
});

test("summarizeModuleProgress never lets in-progress exceed the remaining modules", () => {
  const s = summarizeModuleProgress({
    perCourse: [course({ id: "a", total: 3, done: 2 })],
    completedModules: 2,
    inProgressModules: 9, // bogus over-count
    overallPercent: 67,
  });
  assert.equal(s.modulesInProgress, 1);
  assert.equal(s.modulesNotStarted, 0);
});

/* -------------------------- C. mastery card --------------------------- */

test("buildMasteryCardModel projects only courses that have a score, best first", () => {
  const m = buildMasteryCardModel([
    course({ id: "a", masteryScore: 60, masteryLevel: "developing", masteryAssessedModules: 2 }),
    course({ id: "b", masteryScore: null }), // no score -> excluded
    course({ id: "c", masteryScore: 90, masteryLevel: "mastered", masteryAssessedModules: 1 }),
  ]);
  assert.deepEqual(
    m.rows.map((r) => r.courseId),
    ["c", "a"],
  );
  assert.equal(m.rows[0].score, 90);
  assert.equal(m.rows[0].levelLabel, "Mastered");
  assert.equal(m.assessedModuleCount, 3);
  assert.equal(m.hasAny, true);
  assert.equal(m.note, MASTERY_BASIS_NOTE);
});

test("buildMasteryCardModel: nothing assessed => hasAny false, empty rows", () => {
  const m = buildMasteryCardModel([course({ id: "a" }), course({ id: "b" })]);
  assert.deepEqual(m.rows, []);
  assert.equal(m.assessedModuleCount, 0);
  assert.equal(m.hasAny, false);
});

test("the mastery note explicitly excludes practice / general / unfinished", () => {
  assert.match(MASTERY_BASIS_NOTE, /latest completed official module quiz/i);
  assert.match(MASTERY_BASIS_NOTE, /practice quizzes/i);
  assert.match(MASTERY_BASIS_NOTE, /General Course Quiz/i);
  assert.match(MASTERY_BASIS_NOTE, /unfinished/i);
});

/* ------------------------- D. next steps ----------------------------- */

test("deriveNextSteps: started-not-finished modules come first, with a plain reason", () => {
  const steps = deriveNextSteps({
    continueCourse: null,
    inProgressModules: [{ title: "Normalization", courseTitle: "Course a" }],
    perCourse: [course({ id: "a", title: "Course a" })],
    untouchedCourses: [{ slug: "b-slug", title: "Course b" }],
  });
  assert.equal(steps[0].kind, "finish-module");
  assert.equal(steps[0].title, "Normalization");
  assert.equal(steps[0].courseSlug, "a-slug");
  assert.match(steps[0].reason, /started this module/i);
  assert.equal(steps[1].kind, "start-course");
  assert.match(steps[1].reason, /haven't started/i);
});

test("deriveNextSteps: an in-progress module with no matching course is skipped", () => {
  const steps = deriveNextSteps({
    continueCourse: null,
    inProgressModules: [{ title: "Ghost", courseTitle: "Unknown Course" }],
    perCourse: [course({ id: "a", title: "Course a" })],
    untouchedCourses: [],
  });
  assert.equal(steps.length, 0);
});

test("deriveNextSteps: all caught up => empty (so the UI can show its own state)", () => {
  const steps = deriveNextSteps({
    continueCourse: course({ id: "a", title: "Course a", total: 4, done: 2, pct: 50 }),
    inProgressModules: [],
    perCourse: [course({ id: "a", title: "Course a", total: 4, done: 2, pct: 50 })],
    untouchedCourses: [],
  });
  assert.deepEqual(steps, []);
});

test("deriveNextSteps: only a fully-complete current course yields a 'review' step", () => {
  const done = course({ id: "a", title: "Course a", total: 4, done: 4, pct: 100 });
  const steps = deriveNextSteps({
    continueCourse: done,
    inProgressModules: [],
    perCourse: [done],
    untouchedCourses: [],
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, "review-course");
});

test("deriveNextSteps respects the limit", () => {
  const steps = deriveNextSteps({
    continueCourse: null,
    inProgressModules: [],
    perCourse: [],
    untouchedCourses: Array.from({ length: 10 }, (_, i) => ({ slug: `s${i}`, title: `C${i}` })),
    limit: 3,
  });
  assert.equal(steps.length, 3);
});

test("next-step reasons never claim causation or name an algorithm", () => {
  const steps = deriveNextSteps({
    continueCourse: course({ id: "a", title: "A", total: 4, done: 4, pct: 100 }),
    inProgressModules: [{ title: "M", courseTitle: "A" }],
    perCourse: [course({ id: "a", title: "A" })],
    untouchedCourses: [{ slug: "b", title: "B" }],
  });
  const text = JSON.stringify(steps);
  assert.doesNotMatch(
    text,
    /\bA7\b|\bVARK\b|adaptive|reinforcement|because you (are|'re) weak|proven/i,
  );
});

/* -------------- structural: no logic / AI / algorithm names ---------- */

const libSrc = read("./dashboard-summary.ts");
const routeSrc = read("../routes/_authenticated/dashboard.tsx");

test("1/2. the summary lib recomputes NO progress or mastery", () => {
  const code = libSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  // it may import masteryLabel (a pure label lookup) but never a compute fn
  assert.doesNotMatch(
    code,
    /computeCourseMastery|computeModuleMastery|sufficientModuleAverage|isSufficientAttempt/,
  );
  // overall % is a declared pass-through param, never derived from parts here
  assert.match(code, /overallPercent: input\.overallPercent/);
});

test("3. dashboard adds no AI and no server text generation", () => {
  for (const src of [libSrc, routeSrc]) {
    assert.doesNotMatch(
      src,
      /callAI|course-chat\.functions|generateRemedialLesson|createServerFn|openrouter|gemini/i,
    );
  }
});

test("4. mastery display reads existing per-course values only", () => {
  // the route hands the hook's perCourse straight to the model builder
  assert.match(routeSrc, /buildMasteryCardModel\(perCourse\)/);
  // and never fetches practice / course-quiz rows for mastery
  assert.doesNotMatch(libSrc, /practice_quiz|course_quiz_id|from\(/);
});

test("6. the route uses the shared CTA state logic, unchanged", () => {
  assert.match(routeSrc, /courseCtaState\(continueCourse\.pct\)/);
  assert.match(routeSrc, /COURSE_CTA_LABEL\[continueCta\]/);
  assert.doesNotMatch(routeSrc, /function courseCtaState|const courseCtaState =/);
});

test("7. neither the lib nor the dashboard exposes an internal algorithm name", () => {
  for (const src of [libSrc, routeSrc]) {
    assert.doesNotMatch(
      src,
      /\bA7\b|adaptive-modality|\bVARK\b|reinforcement|R8 |remedial-adaptation/,
    );
  }
});

test("the dashboard hook (calculations) is not modified by P1.2", () => {
  const hookSrc = read("../hooks/use-student-dashboard.ts");
  assert.doesNotMatch(hookSrc, /dashboard-summary/);
  // still the single source of the donut + overall %
  assert.match(hookSrc, /overallPct = totalModules > 0/);
});
