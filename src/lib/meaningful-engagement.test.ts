/**
 * Unit tests for the Phase A7 content-length-aware meaningful-engagement
 * threshold and the pure accumulator behind `useMeaningfulEngagement`.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/meaningful-engagement.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceEngagement,
  computeMeaningfulEngagementThreshold,
  createEngagementState,
  resolveEngagementPlan,
  MEANINGFUL_ENGAGEMENT_MIN_SECONDS,
  MEANINGFUL_ENGAGEMENT_MAX_SECONDS,
} from "@/lib/meaningful-engagement";
import type { EngagementTick } from "@/lib/meaningful-engagement";

const MIN = MEANINGFUL_ENGAGEMENT_MIN_SECONDS; // 90
const MAX = MEANINGFUL_ENGAGEMENT_MAX_SECONDS; // 300

/* ---------------- computeMeaningfulEngagementThreshold: text ---------------- */

test("very short text falls on the 90s minimum", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "text", textLength: 0 }), MIN);
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "text", textLength: 200 }), MIN);
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "text", textLength: 1500 }), MIN);
});

test("longer text scales the threshold upward, still within bounds", () => {
  const t = computeMeaningfulEngagementThreshold({ modality: "text", textLength: 10_000 });
  // ~10k chars / 1100 cpm = ~9.09 min reading; 30% ≈ 164s.
  assert.equal(t, 164);
  assert.ok(t > MIN && t < MAX);
  // monotonic non-decreasing in length
  const shorter = computeMeaningfulEngagementThreshold({ modality: "text", textLength: 6000 });
  assert.ok(shorter <= t);
  assert.ok(shorter >= MIN);
});

test("very long text is capped at the 300s maximum", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "text", textLength: 25_000 }), MAX);
  assert.equal(
    computeMeaningfulEngagementThreshold({ modality: "text", textLength: 1_000_000 }),
    MAX,
  );
});

test("negative / nonsense text length is treated as empty -> minimum", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "text", textLength: -50 }), MIN);
});

/* --------------- computeMeaningfulEngagementThreshold: media --------------- */

test("5-minute media -> 90s (30% of 300s, on the floor)", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "video", durationSec: 300 }), 90);
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "audio", durationSec: 300 }), 90);
});

test("10-minute media -> 180s (30% of 600s)", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "video", durationSec: 600 }), 180);
});

test("20-minute media -> 300s (30% of 1200s = 360s, clamped to the ceiling)", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "audio", durationSec: 1200 }), MAX);
});

test("multi-hour media is capped at the 300s maximum", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "video", durationSec: 7200 }), MAX);
  assert.equal(
    computeMeaningfulEngagementThreshold({ modality: "video", durationSec: 3 * 3600 }),
    MAX,
  );
});

test("missing / non-positive media duration uses the safe 90s fallback", () => {
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "video", durationSec: null }), MIN);
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "audio", durationSec: 0 }), MIN);
  assert.equal(
    computeMeaningfulEngagementThreshold({ modality: "video", durationSec: Number.NaN }),
    MIN,
  );
});

test("slides: proportional when a duration exists, conservative 90s fallback otherwise", () => {
  assert.equal(
    computeMeaningfulEngagementThreshold({ modality: "slides", durationSec: null }),
    MIN,
  );
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "slides", durationSec: 600 }), 180);
  // never below the floor even for a tiny declared duration
  assert.equal(computeMeaningfulEngagementThreshold({ modality: "slides", durationSec: 30 }), MIN);
});

test("every threshold is an integer within [90, 300]", () => {
  for (const len of [0, 100, 3333, 9000, 12_500, 40_000]) {
    const v = computeMeaningfulEngagementThreshold({ modality: "text", textLength: len });
    assert.ok(Number.isInteger(v) && v >= MIN && v <= MAX);
  }
  for (const d of [1, 120, 301, 999, 1801, 99_999]) {
    const v = computeMeaningfulEngagementThreshold({ modality: "video", durationSec: d });
    assert.ok(Number.isInteger(v) && v >= MIN && v <= MAX);
  }
});

/* ------------------------- resolveEngagementPlan ------------------------- */

test("text plan uses exposure and the text-length threshold", () => {
  const plan = resolveEngagementPlan({
    modality: "text",
    totalTextLength: 10_000,
    totalDurationSec: null,
    playbackVerifiable: false,
  });
  assert.equal(plan.signal, "exposure");
  assert.equal(plan.threshold, 164);
});

test("all-native video plan uses the playback signal", () => {
  const plan = resolveEngagementPlan({
    modality: "video",
    totalTextLength: 0,
    totalDurationSec: 600,
    playbackVerifiable: true,
  });
  assert.equal(plan.signal, "playback");
  assert.equal(plan.threshold, 180);
});

test("provider/iframe video plan falls back to exposure", () => {
  const plan = resolveEngagementPlan({
    modality: "video",
    totalTextLength: 0,
    totalDurationSec: null,
    playbackVerifiable: false,
  });
  assert.equal(plan.signal, "exposure");
  assert.equal(plan.threshold, MIN);
});

test("slides plan is always exposure", () => {
  const plan = resolveEngagementPlan({
    modality: "slides",
    totalTextLength: 0,
    totalDurationSec: 1200,
    playbackVerifiable: false,
  });
  assert.equal(plan.signal, "exposure");
  assert.equal(plan.threshold, MAX);
});

/* --------------------------- advanceEngagement --------------------------- */

const baseTick = (over: Partial<EngagementTick>): EngagementTick => ({
  topicId: "t1",
  modality: "text",
  threshold: 90,
  signal: "exposure",
  visible: true,
  playbackSeconds: 0,
  deltaSeconds: 1,
  ...over,
});

function runTicks(
  state: ReturnType<typeof createEngagementState>,
  tick: EngagementTick,
  count: number,
): string[] {
  const emissions: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = advanceEngagement(state, tick);
    if (m) emissions.push(m);
  }
  return emissions;
}

test("exposure: qualifies exactly once, at the threshold", () => {
  const state = createEngagementState();
  const emissions = runTicks(state, baseTick({ threshold: 90 }), 200);
  assert.deepEqual(emissions, ["text"]);
  assert.ok(state.emitted.has("t1:text"));
});

test("a hidden tab never accumulates exposure", () => {
  const state = createEngagementState();
  const emissions = runTicks(state, baseTick({ visible: false, threshold: 90 }), 500);
  assert.deepEqual(emissions, []);
  assert.equal(state.exposureSeconds, 0);
});

test("switching modality resets exposure accrual", () => {
  const state = createEngagementState();
  // 80s on text — below the 90s threshold, no emit
  runTicks(state, baseTick({ modality: "text", threshold: 90 }), 80);
  assert.equal(state.exposureSeconds, 80);
  // switch to video — the counter restarts from 0
  const m = advanceEngagement(state, baseTick({ modality: "video", threshold: 90 }));
  assert.equal(m, null);
  assert.equal(state.exposureSeconds, 1);
  assert.equal(state.key, "t1:video");
});

test("at most one meaningful_engagement per (topic, modality) per visit", () => {
  const state = createEngagementState();
  runTicks(state, baseTick({ threshold: 90 }), 300); // long overshoot
  // come back to it later in the same visit
  const again = runTicks(state, baseTick({ threshold: 90 }), 300);
  assert.deepEqual(again, []);
});

test("playback signal: trusts verified playback seconds, ignores the visible tab", () => {
  const state = createEngagementState();
  // tab visible the whole time but nothing is playing -> never qualifies
  const idle = runTicks(
    state,
    baseTick({ modality: "video", signal: "playback", threshold: 180, playbackSeconds: 0 }),
    600,
  );
  assert.deepEqual(idle, []);
  // now playback time reaches the threshold, even with the tab hidden
  const m = advanceEngagement(
    state,
    baseTick({
      modality: "video",
      signal: "playback",
      threshold: 180,
      visible: false,
      playbackSeconds: 181,
    }),
  );
  assert.equal(m, "video");
});

test("no topic / no modality is inert", () => {
  const state = createEngagementState();
  assert.equal(advanceEngagement(state, baseTick({ modality: null })), null);
  assert.equal(advanceEngagement(state, baseTick({ topicId: "" })), null);
});
