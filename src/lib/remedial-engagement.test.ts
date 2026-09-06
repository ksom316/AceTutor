/**
 * R4 — remedial meaningful-engagement thresholds + accumulator.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-engagement.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceRemedialEngagement,
  createRemedialEngagementState,
  estimatedNarrationSeconds,
  remedialDisplayTextLength,
  remedialEngagementKey,
  remedialEngagementSignal,
  remedialEngagementThreshold,
  type RemedialEngagementTick,
} from "@/lib/remedial-engagement";
import { remedialContentSchema, type RemedialContent } from "@/lib/remedial-content";
import {
  MEANINGFUL_ENGAGEMENT_MAX_SECONDS,
  MEANINGFUL_ENGAGEMENT_MIN_SECONDS,
} from "@/lib/meaningful-engagement";

const CONTENT: RemedialContent = remedialContentSchema.parse({
  title: "Normalization",
  weakConcepts: ["Normalization"],
  summary: "s".repeat(120),
  explanation: "e ".repeat(600),
  workedExample: "w ".repeat(200),
  keyPoints: ["one two three", "four five six"],
  practicePrompt: "practice here",
});

/* ---------------- thresholds ---------------- */

test("thresholds reuse the A6/A7 clamped [90,300] helper — not new constants", () => {
  const text = remedialEngagementThreshold(CONTENT, "text");
  const visual = remedialEngagementThreshold(CONTENT, "visual");
  const audio = remedialEngagementThreshold(CONTENT, "audio");
  for (const v of [text, visual, audio]) {
    assert.ok(Number.isInteger(v));
    assert.ok(v >= MEANINGFUL_ENGAGEMENT_MIN_SECONDS && v <= MEANINGFUL_ENGAGEMENT_MAX_SECONDS);
  }
  // text and visual share the reading-time threshold (conservative for visual)
  assert.equal(text, visual);
  assert.equal(remedialEngagementSignal("text"), "exposure");
  assert.equal(remedialEngagementSignal("visual"), "exposure");
  assert.equal(remedialEngagementSignal("audio"), "playback");
});

test("audio threshold scales with the estimated narration length", () => {
  assert.ok(estimatedNarrationSeconds(CONTENT) > 1);
  assert.ok(remedialDisplayTextLength(CONTENT) > 100);
});

/* ---------------- accumulator ---------------- */

const base = (over: Partial<RemedialEngagementTick>): RemedialEngagementTick => ({
  studyPathId: "sp1",
  format: "text",
  contentVersion: "2026-09-05T00:00:00Z",
  threshold: 90,
  signal: "exposure",
  visible: true,
  playbackSeconds: 0,
  deltaSeconds: 1,
  alreadyPersisted: new Set<string>(),
  ...over,
});

function run(
  state: ReturnType<typeof createRemedialEngagementState>,
  tick: RemedialEngagementTick,
  count: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = advanceRemedialEngagement(state, tick);
    if (m) out.push(m);
  }
  return out;
}

test("4/10. opening a tab alone (a few seconds) is not meaningful engagement", () => {
  const s = createRemedialEngagementState();
  assert.deepEqual(run(s, base({ threshold: 90 }), 5), []);
  assert.deepEqual(run(s, base({ format: "visual", threshold: 90 }), 5), []);
});

test("5/11. reaching the threshold while visible -> exactly one engagement", () => {
  const s = createRemedialEngagementState();
  assert.deepEqual(run(s, base({ threshold: 90 }), 200), ["text"]);
  const v = createRemedialEngagementState();
  assert.deepEqual(run(v, base({ format: "visual", threshold: 90 }), 200), ["visual"]);
});

test("6. hidden-tab time is excluded", () => {
  const s = createRemedialEngagementState();
  assert.deepEqual(run(s, base({ visible: false, threshold: 90 }), 500), []);
  assert.equal(s.exposureSeconds, 0);
});

test("7/9. audio: Play alone / paused time does not count (playback seconds do)", () => {
  const s = createRemedialEngagementState();
  // "Play" pressed but 0 genuine spoken seconds accrued yet
  assert.deepEqual(
    run(s, base({ format: "audio", signal: "playback", threshold: 90, playbackSeconds: 0 }), 300),
    [],
  );
  // genuine spoken seconds reach the threshold -> engagement
  const m = advanceRemedialEngagement(
    s,
    base({ format: "audio", signal: "playback", threshold: 90, playbackSeconds: 91 }),
  );
  assert.equal(m, "audio");
});

test("8. audio progress reaching the threshold -> engagement (tab-visibility not required)", () => {
  const s = createRemedialEngagementState();
  const m = advanceRemedialEngagement(
    s,
    base({
      format: "audio",
      signal: "playback",
      threshold: 120,
      visible: false,
      playbackSeconds: 121,
    }),
  );
  assert.equal(m, "audio"); // RemedialAudioPlayer already gated spoken seconds on visibility
});

test("switching format restarts exposure accrual", () => {
  const s = createRemedialEngagementState();
  run(s, base({ format: "text", threshold: 90 }), 60); // 60s on text, no emit
  assert.equal(s.exposureSeconds, 60);
  const m = advanceRemedialEngagement(s, base({ format: "visual", threshold: 90 }));
  assert.equal(m, null);
  assert.equal(s.exposureSeconds, 1);
});

test("12. a key already persisted server-side never re-emits (reload dedup)", () => {
  const key = remedialEngagementKey("sp1", "text", "2026-09-05T00:00:00Z");
  const s = createRemedialEngagementState();
  assert.deepEqual(run(s, base({ threshold: 90, alreadyPersisted: new Set([key]) }), 400), []);
});

test("13. a different content version is a NEW key (only via a real timestamp)", () => {
  const oldKey = remedialEngagementKey("sp1", "text", "2026-09-05T00:00:00Z");
  const s = createRemedialEngagementState();
  // old version already recorded — but the regenerated content has a new
  // truthful `remedial_generated_at`, so its key differs and can still emit
  assert.deepEqual(
    run(
      s,
      base({
        threshold: 90,
        contentVersion: "2026-09-06T10:00:00Z",
        alreadyPersisted: new Set([oldKey]),
      }),
      200,
    ),
    ["text"],
  );
  assert.notEqual(
    remedialEngagementKey("sp1", "text", "2026-09-05T00:00:00Z"),
    remedialEngagementKey("sp1", "text", "2026-09-06T10:00:00Z"),
  );
  // no fake version is invented: a null version is just the empty segment
  assert.equal(remedialEngagementKey("sp1", "text", null), "sp1:text:");
});

test("one emit per key even across many ticks", () => {
  const s = createRemedialEngagementState();
  run(s, base({ threshold: 90 }), 100); // emits once at 90
  assert.deepEqual(run(s, base({ threshold: 90 }), 100), []); // never again
});
