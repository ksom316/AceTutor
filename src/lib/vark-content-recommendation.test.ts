/**
 * Unit tests for the Phase A4 VARK content-recommendation helper. No test
 * framework dependency added — uses Node's built-in test runner, same
 * convention as vark-inference.functions.test.ts.
 *
 * Run: node --experimental-strip-types --test src/lib/vark-content-recommendation.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveEffectiveVarkCategory,
  resolveVarkContentRecommendation,
} from "./vark-content-recommendation.ts";
import type { LessonModality } from "./lesson-shared.ts";

const ALL_MODALITIES = ["text", "video", "audio", "slides"] as const;

test("ML category takes priority over a different questionnaire category", () => {
  const category = resolveEffectiveVarkCategory({
    ml_predicted_category: "visual",
    predicted_category: "auditory",
  });
  assert.equal(category, "visual");
});

test("questionnaire category is used as fallback when ML is null", () => {
  const category = resolveEffectiveVarkCategory({
    ml_predicted_category: null,
    predicted_category: "read_write",
  });
  assert.equal(category, "read_write");
});

test("no profile -> no recommendation", () => {
  assert.equal(resolveEffectiveVarkCategory(null), null);
  assert.equal(resolveVarkContentRecommendation(null, ALL_MODALITIES), null);
});

test("both fields null -> no effective category", () => {
  const category = resolveEffectiveVarkCategory({
    ml_predicted_category: null,
    predicted_category: null,
  });
  assert.equal(category, null);
});

test("visual + video + slides -> video is recommended (never both at once)", () => {
  const rec = resolveVarkContentRecommendation("visual", ALL_MODALITIES);
  assert.deepEqual(rec, { modality: "video", category: "visual" });
});

test("visual + slides only (no video) -> slides is recommended", () => {
  const rec = resolveVarkContentRecommendation("visual", ["text", "audio", "slides"]);
  assert.deepEqual(rec, { modality: "slides", category: "visual" });
});

test("visual + neither video nor slides -> null", () => {
  const rec = resolveVarkContentRecommendation("visual", ["text", "audio"]);
  assert.equal(rec, null);
});

test("auditory maps to audio when audio is available", () => {
  const rec = resolveVarkContentRecommendation("auditory", ALL_MODALITIES);
  assert.deepEqual(rec, { modality: "audio", category: "auditory" });
});

test("read_write maps to text when text is available", () => {
  const rec = resolveVarkContentRecommendation("read_write", ALL_MODALITIES);
  assert.deepEqual(rec, { modality: "text", category: "read_write" });
});

test("kinesthetic never produces a recommendation, regardless of available modalities", () => {
  assert.equal(resolveVarkContentRecommendation("kinesthetic", ALL_MODALITIES), null);
});

test("no matching content -> no fake recommendation (auditory with no audio lessons)", () => {
  const rec = resolveVarkContentRecommendation("auditory", ["text", "video", "slides"]);
  assert.equal(rec, null);
});

test("non-matching modalities remain untouched in the input - the helper only reads, never filters", () => {
  const modalities: LessonModality[] = ["text", "video", "audio", "slides"];
  const before = [...modalities];
  resolveVarkContentRecommendation("visual", modalities);
  assert.deepEqual(modalities, before);
});
