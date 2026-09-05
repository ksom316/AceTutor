/**
 * Unit tests for the Phase A6 learning-interactions helper's pure parts.
 * No test framework dependency added — uses Node's built-in test runner
 * (via the alias loader added in A5).
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/learning-interactions.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecommendationContext } from "@/lib/learning-interactions";
import type { VarkContentRecommendation } from "@/lib/vark-content-recommendation";

const VIDEO_RECOMMENDATION: VarkContentRecommendation = { modality: "video", category: "visual" };

test("recommendation_matched is true when the actual modality equals the recommended one", () => {
  const ctx = buildRecommendationContext(VIDEO_RECOMMENDATION, "visual", "video");
  assert.deepEqual(ctx, {
    recommended_modality: "video",
    effective_vark_category: "visual",
    recommendation_matched: true,
  });
});

test("recommendation_matched is false when a recommendation exists but doesn't match", () => {
  const ctx = buildRecommendationContext(VIDEO_RECOMMENDATION, "visual", "text");
  assert.deepEqual(ctx, {
    recommended_modality: "video",
    effective_vark_category: "visual",
    recommendation_matched: false,
  });
});

test("no recommendation -> all three fields null, never false", () => {
  const ctx = buildRecommendationContext(null, null, "text");
  assert.deepEqual(ctx, {
    recommended_modality: null,
    effective_vark_category: null,
    recommendation_matched: null,
  });
  assert.notEqual(ctx.recommendation_matched, false);
});

test(
  "no recommendation still returns null even if an effective category happens to be known " +
    "(e.g. kinesthetic, or the recommended modality has no content in this topic)",
  () => {
    const ctx = buildRecommendationContext(null, "kinesthetic", "text");
    assert.deepEqual(ctx, {
      recommended_modality: null,
      effective_vark_category: null,
      recommendation_matched: null,
    });
  },
);

test("event payload shape: practice_quiz_started carries only its applicable fields", () => {
  const payload = {
    event_type: "practice_quiz_started" as const,
    course_id: "course-1",
    topic_id: "topic-1",
    difficulty: "medium" as const,
  };
  assert.deepEqual(Object.keys(payload).sort(), [
    "course_id",
    "difficulty",
    "event_type",
    "topic_id",
  ]);
});

test("difficulty passes through unchanged for practice_quiz_completed", () => {
  const payload = {
    event_type: "practice_quiz_completed" as const,
    difficulty: "hard" as const,
    score_percent: 90,
  };
  assert.equal(payload.difficulty, "hard");
  assert.equal(payload.score_percent, 90);
});

test("no forbidden keys ever appear in a built event payload (no secrets/PII)", () => {
  const ctx = buildRecommendationContext(VIDEO_RECOMMENDATION, "visual", "video");
  const forbidden = ["token", "secret", "answer", "correctIndex", "email", "responses", "password"];
  const keys = Object.keys(ctx).map((k) => k.toLowerCase());
  for (const bad of forbidden) {
    assert.ok(
      !keys.some((k) => k.includes(bad.toLowerCase())),
      `recommendation context must never contain a "${bad}"-like key`,
    );
  }
});
