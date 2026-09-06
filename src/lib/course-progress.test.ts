/**
 * P1.2 — the Start / Continue / Review course CTA. Pure, derived only from the
 * course's official progress %.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/course-progress.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { COURSE_CTA_LABEL, courseCtaState } from "@/lib/course-progress";

test("CTA state: 0% -> start, 1–99% -> resume, 100% -> review", () => {
  assert.equal(courseCtaState(0), "start");
  assert.equal(courseCtaState(1), "resume");
  assert.equal(courseCtaState(50), "resume");
  assert.equal(courseCtaState(99), "resume");
  assert.equal(courseCtaState(100), "review");
  assert.equal(courseCtaState(150), "review"); // clamps high
});

test("CTA labels are the three student-facing strings", () => {
  assert.equal(COURSE_CTA_LABEL[courseCtaState(0)], "Start course");
  assert.equal(COURSE_CTA_LABEL[courseCtaState(42)], "Continue learning");
  assert.equal(COURSE_CTA_LABEL[courseCtaState(100)], "Review course");
  assert.deepEqual(Object.values(COURSE_CTA_LABEL).sort(), [
    "Continue learning",
    "Review course",
    "Start course",
  ]);
});

test("courseCtaState is a pure function of the percentage only", () => {
  // no other inputs, deterministic
  for (const p of [0, 0.4, 1, 33, 99.9, 100]) {
    assert.equal(courseCtaState(p), courseCtaState(p));
  }
});
