/**
 * Unit tests for the learning-interactions helper's pure parts (A6 + the A7
 * correctness fix: `buildRecommendationContext` now records the DISPLAYED
 * recommendation — VARK or adaptive — and its source).
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/learning-interactions.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRecommendationContext,
  type LearningInteractionInput,
} from "@/lib/learning-interactions";

test("VARK fallback: matched true when the student's modality equals the recommended one", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: "video",
    recommendationSource: "vark",
    effectiveCategory: "visual",
    actualModality: "video",
  });
  assert.deepEqual(ctx, {
    recommended_modality: "video",
    effective_vark_category: "visual",
    recommendation_matched: true,
    recommendation_source: "vark",
  });
});

test("VARK fallback: matched false when the student picks a different modality", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: "video",
    recommendationSource: "vark",
    effectiveCategory: "visual",
    actualModality: "text",
  });
  assert.equal(ctx.recommended_modality, "video");
  assert.equal(ctx.recommendation_matched, false);
  assert.equal(ctx.recommendation_source, "vark");
});

test("adaptive displayed text + student selects text -> matched true, source adaptive", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: "text",
    recommendationSource: "adaptive",
    effectiveCategory: "visual", // still a visual student — adaptive doesn't change that
    actualModality: "text",
  });
  assert.deepEqual(ctx, {
    recommended_modality: "text",
    effective_vark_category: "visual",
    recommendation_matched: true,
    recommendation_source: "adaptive",
  });
});

test("adaptive displayed text + student selects video -> matched false, source adaptive", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: "text",
    recommendationSource: "adaptive",
    effectiveCategory: "visual",
    actualModality: "video",
  });
  assert.equal(ctx.recommended_modality, "text");
  assert.equal(ctx.recommendation_matched, false);
  assert.equal(ctx.recommendation_source, "adaptive");
});

test("effective_vark_category is unchanged during an adaptive override", () => {
  // A visual student shown an adaptive 'text' recommendation is still visual.
  const ctx = buildRecommendationContext({
    recommendedModality: "text",
    recommendationSource: "adaptive",
    effectiveCategory: "visual",
    actualModality: "audio",
  });
  assert.equal(ctx.effective_vark_category, "visual");
});

test("adaptive-no-vark (e.g. kinesthetic): source adaptive, no VARK category carried", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: "audio",
    recommendationSource: "adaptive",
    effectiveCategory: "kinesthetic",
    actualModality: "audio",
  });
  assert.equal(ctx.recommendation_source, "adaptive");
  assert.equal(ctx.recommendation_matched, true);
  assert.equal(ctx.effective_vark_category, "kinesthetic");
});

test("no recommendation shown -> every context field null, never false", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: null,
    recommendationSource: null,
    effectiveCategory: "kinesthetic",
    actualModality: "text",
  });
  assert.deepEqual(ctx, {
    recommended_modality: null,
    effective_vark_category: null,
    recommendation_matched: null,
    recommendation_source: null,
  });
  assert.notEqual(ctx.recommendation_matched, false);
});

test("A7: a meaningful_engagement input is well-typed and carries modality + context", () => {
  const input: LearningInteractionInput = {
    event_type: "meaningful_engagement",
    course_id: null,
    topic_id: "topic-1",
    modality: "text",
    recommendationContext: buildRecommendationContext({
      recommendedModality: "text",
      recommendationSource: "adaptive",
      effectiveCategory: "visual",
      actualModality: "text",
    }),
  };
  assert.equal(input.event_type, "meaningful_engagement");
  assert.equal(input.modality, "text");
  assert.equal(input.recommendationContext.recommendation_matched, true);
  // no lesson_id on this modality-level variant
  assert.ok(!("lesson_id" in input));
});

test("no forbidden keys ever appear in a built recommendation context (no secrets/PII)", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: "video",
    recommendationSource: "vark",
    effectiveCategory: "visual",
    actualModality: "video",
  });
  const forbidden = ["token", "secret", "answer", "correctIndex", "email", "responses", "password"];
  const keys = Object.keys(ctx).map((k) => k.toLowerCase());
  for (const bad of forbidden) {
    assert.ok(
      !keys.some((k) => k.includes(bad.toLowerCase())),
      `recommendation context must never contain a "${bad}"-like key`,
    );
  }
});
