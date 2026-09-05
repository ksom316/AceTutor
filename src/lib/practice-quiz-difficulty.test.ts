/**
 * Unit tests for the Phase A5 adaptive practice-quiz-difficulty helper. No
 * test framework dependency added — uses Node's built-in test runner, same
 * convention as vark-inference.functions.test.ts /
 * vark-content-recommendation.test.ts.
 *
 * Run: node --experimental-strip-types --test src/lib/practice-quiz-difficulty.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePracticeQuizDifficulty } from "@/lib/practice-quiz-difficulty";
import type { PerfAttempt } from "@/lib/quiz-performance";

const TOPIC_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TOPIC_ID = "22222222-2222-2222-2222-222222222222";

let nextId = 0;
/** A comfortably-sufficient (finished, fully-answered, 100-question) official
 *  module-quiz attempt for TOPIC_ID at the given score%, finished at `at`. */
function officialAttempt(scorePercent: number, at: string, topicId = TOPIC_ID): PerfAttempt {
  nextId += 1;
  return {
    id: `attempt-${nextId}`,
    topic_id: topicId,
    score: scorePercent,
    total: 100,
    answered_count: 100,
    started_at: at,
    finished_at: at,
  };
}

test("no attempts at all -> medium, no_official_attempt", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, []);
  assert.deepEqual(res, { difficulty: "medium", basis: "no_official_attempt" });
});

test("score 0% -> easy", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [officialAttempt(0, "2026-01-01T00:00:00Z")]);
  assert.deepEqual(res, { difficulty: "easy", basis: "official_attempt" });
});

test("score 49% -> easy", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [officialAttempt(49, "2026-01-01T00:00:00Z")]);
  assert.deepEqual(res, { difficulty: "easy", basis: "official_attempt" });
});

test("score 50% -> medium", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [officialAttempt(50, "2026-01-01T00:00:00Z")]);
  assert.deepEqual(res, { difficulty: "medium", basis: "official_attempt" });
});

test("score 79% -> medium", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [officialAttempt(79, "2026-01-01T00:00:00Z")]);
  assert.deepEqual(res, { difficulty: "medium", basis: "official_attempt" });
});

test("score 80% -> hard", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [officialAttempt(80, "2026-01-01T00:00:00Z")]);
  assert.deepEqual(res, { difficulty: "hard", basis: "official_attempt" });
});

test("score 100% -> hard", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [officialAttempt(100, "2026-01-01T00:00:00Z")]);
  assert.deepEqual(res, { difficulty: "hard", basis: "official_attempt" });
});

test("unfinished attempt is ignored (falls back to medium, as if no attempt)", () => {
  const unfinished: PerfAttempt = {
    id: "unfinished-1",
    topic_id: TOPIC_ID,
    score: 95,
    total: 100,
    answered_count: 50,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: null,
  };
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [unfinished]);
  assert.deepEqual(res, { difficulty: "medium", basis: "no_official_attempt" });
});

test("General Course Quiz attempt (topic_id null) is ignored even with a high score", () => {
  const generalQuizAttempt: PerfAttempt = {
    id: "general-1",
    topic_id: null,
    score: 100,
    total: 100,
    answered_count: 100,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:00Z",
  };
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [generalQuizAttempt]);
  assert.deepEqual(res, { difficulty: "medium", basis: "no_official_attempt" });
});

test("an attempt for a DIFFERENT topic is ignored", () => {
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [
    officialAttempt(100, "2026-01-01T00:00:00Z", OTHER_TOPIC_ID),
  ]);
  assert.deepEqual(res, { difficulty: "medium", basis: "no_official_attempt" });
});

test("total 0 safely falls back to medium, never throws", () => {
  const zeroTotal: PerfAttempt = {
    id: "zero-total-1",
    topic_id: TOPIC_ID,
    score: 0,
    total: 0,
    answered_count: 0,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:00Z",
  };
  assert.doesNotThrow(() => resolvePracticeQuizDifficulty(TOPIC_ID, [zeroTotal]));
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [zeroTotal]);
  assert.deepEqual(res, { difficulty: "medium", basis: "no_official_attempt" });
});

test("total null safely falls back to medium, never throws", () => {
  const nullTotal: PerfAttempt = {
    id: "null-total-1",
    topic_id: TOPIC_ID,
    score: null,
    total: null,
    answered_count: null,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:00Z",
  };
  assert.doesNotThrow(() => resolvePracticeQuizDifficulty(TOPIC_ID, [nullTotal]));
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [nullTotal]);
  assert.deepEqual(res, { difficulty: "medium", basis: "no_official_attempt" });
});

test("the NEWEST sufficient attempt wins, not the highest score (latest, not best)", () => {
  const older = officialAttempt(20, "2026-01-01T00:00:00Z"); // easy-range, older
  const newer = officialAttempt(90, "2026-01-05T00:00:00Z"); // hard-range, newer
  const res = resolvePracticeQuizDifficulty(TOPIC_ID, [older, newer]);
  assert.deepEqual(res, { difficulty: "hard", basis: "official_attempt" });
});
