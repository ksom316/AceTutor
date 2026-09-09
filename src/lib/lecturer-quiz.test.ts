/**
 * `generateModuleQuiz` input contract. The course-wide variant gained an
 * OPTIONAL `courseQuizId` so the lecturer can generate questions from the whole
 * course *before* the General Course Quiz row exists (the new-quiz builder) —
 * the course is always derived server-side from current_lecturer_course().
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/lecturer-quiz.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateQuizInputSchema } from "@/lib/lecturer-quiz.functions";

const uuid = "11111111-1111-4111-8111-111111111111";

test("course-wide generation is accepted WITHOUT a courseQuizId (new-quiz builder)", () => {
  const r = generateQuizInputSchema.safeParse({
    courseWide: true,
    questionCount: 10,
    difficulty: "mixed",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal("courseQuizId" in r.data, false);
});

test("course-wide generation still accepts a courseQuizId (persisted quiz)", () => {
  const r = generateQuizInputSchema.safeParse({
    courseWide: true,
    courseQuizId: uuid,
    questionCount: 5,
  });
  assert.equal(r.success, true);
  // difficulty defaults to "ai" for existing callers
  if (r.success && "courseQuizId" in r.data) assert.equal(r.data.difficulty, "ai");
});

test("a non-uuid courseQuizId is still rejected", () => {
  const r = generateQuizInputSchema.safeParse({
    courseWide: true,
    courseQuizId: "not-a-uuid",
    questionCount: 5,
  });
  assert.equal(r.success, false);
});

test("module and draft-module variants are unaffected", () => {
  assert.equal(
    generateQuizInputSchema.safeParse({ topicId: uuid, questionCount: 8 }).success,
    true,
  );
  assert.equal(
    generateQuizInputSchema.safeParse({
      draftModule: { title: "Arrays", summary: "intro" },
      questionCount: 8,
    }).success,
    true,
  );
});

test("questionCount out of range is rejected for every variant", () => {
  for (const base of [{ courseWide: true as const }, { topicId: uuid }]) {
    assert.equal(generateQuizInputSchema.safeParse({ ...base, questionCount: 0 }).success, false);
    assert.equal(generateQuizInputSchema.safeParse({ ...base, questionCount: 51 }).success, false);
  }
});
