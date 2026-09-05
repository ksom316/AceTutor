/**
 * Unit tests for the Phase A7 adaptive modality recommendation. Pure-helper
 * tests via Node's built-in runner (through the A5 alias loader), plus a few
 * static/structural checks on the server function's text (no live DB here).
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/adaptive-modality.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildModalityEvidence,
  computeAdaptiveModalityRecommendation,
  outcomeReward,
  type ModalityEvidence,
} from "@/lib/adaptive-modality";
import type { VarkContentRecommendation } from "@/lib/vark-content-recommendation";
import type { LessonModality } from "@/lib/lesson-shared";

const ALL: LessonModality[] = ["text", "video", "audio", "slides"];
const VISUAL_REC: VarkContentRecommendation = { modality: "video", category: "visual" };

function evidence(
  perModality: ModalityEvidence["perModality"],
  linkedOutcomeCount: number,
): ModalityEvidence {
  return { perModality, linkedOutcomeCount };
}

/* ---------------- computeAdaptiveModalityRecommendation ---------------- */

test("1. no behavioral evidence -> VARK fallback, unchanged", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: VISUAL_REC,
    effectiveVarkCategory: "visual",
    availableModalities: ALL,
    evidence: evidence({}, 0),
  });
  assert.deepEqual(
    { modality: r.modality, source: r.source, reasonCode: r.reasonCode },
    { modality: "video", source: "vark", reasonCode: "no_evidence" },
  );
});

test("2. insufficient evidence (1 linked outcome) -> VARK fallback", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: VISUAL_REC,
    effectiveVarkCategory: "visual",
    availableModalities: ALL,
    evidence: evidence({ video: { score: 1, evidenceCount: 1 } }, 1),
  });
  assert.equal(r.source, "vark");
  assert.equal(r.reasonCode, "insufficient_evidence");
  assert.equal(r.modality, "video");
});

test("3. strong evidence for the VARK modality -> stays VARK (vark_confirmed)", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: VISUAL_REC,
    effectiveVarkCategory: "visual",
    availableModalities: ALL,
    evidence: evidence({ video: { score: 2, evidenceCount: 2 } }, 2),
  });
  assert.equal(r.source, "vark");
  assert.equal(r.reasonCode, "vark_confirmed");
  assert.equal(r.modality, "video");
});

test("4. strong evidence for a different modality -> adaptive override", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: VISUAL_REC,
    effectiveVarkCategory: "visual",
    availableModalities: ALL,
    evidence: evidence(
      { text: { score: 2, evidenceCount: 2 }, video: { score: -2, evidenceCount: 2 } },
      2,
    ),
  });
  assert.equal(r.source, "adaptive");
  assert.equal(r.modality, "text");
  assert.equal(r.reasonCode, "adaptive_override");
  assert.equal(r.evidenceScore, 2);
});

test("5. tie between two modalities -> deterministic VARK fallback", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: VISUAL_REC,
    effectiveVarkCategory: "visual",
    availableModalities: ALL,
    evidence: evidence(
      { text: { score: 2, evidenceCount: 2 }, audio: { score: 2, evidenceCount: 2 } },
      3,
    ),
  });
  assert.equal(r.source, "vark");
  assert.equal(r.reasonCode, "tie");
  assert.equal(r.modality, "video");
});

test("6/insufficient per-modality: outcomes exist but no modality reaches 2 -> VARK fallback", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: VISUAL_REC,
    effectiveVarkCategory: "visual",
    availableModalities: ALL,
    evidence: evidence(
      { text: { score: 1, evidenceCount: 1 }, audio: { score: 1, evidenceCount: 1 } },
      2,
    ),
  });
  assert.equal(r.source, "vark");
  assert.equal(r.reasonCode, "insufficient_modality_evidence");
});

test("7. net-negative / zero best score -> no override (no_positive_evidence)", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: VISUAL_REC,
    effectiveVarkCategory: "visual",
    availableModalities: ALL,
    evidence: evidence({ text: { score: 0, evidenceCount: 3 } }, 3),
  });
  assert.equal(r.source, "vark");
  assert.equal(r.reasonCode, "no_positive_evidence");
});

test("9. Visual video->slides fallback preserved when adaptive is inactive", () => {
  // A4's resolveVarkContentRecommendation already picked slides (topic has no
  // video); with insufficient adaptive evidence A7 must pass that through.
  const slidesRec: VarkContentRecommendation = { modality: "slides", category: "visual" };
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: slidesRec,
    effectiveVarkCategory: "visual",
    availableModalities: ["text", "audio", "slides"],
    evidence: evidence({}, 0),
  });
  assert.equal(r.source, "vark");
  assert.equal(r.modality, "slides");
});

test("10. no VARK profile + strong evidence for text -> adaptive_no_vark", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: null,
    effectiveVarkCategory: null,
    availableModalities: ALL,
    evidence: evidence({ text: { score: 3, evidenceCount: 3 } }, 3),
  });
  assert.equal(r.source, "adaptive");
  assert.equal(r.modality, "text");
  assert.equal(r.category, null);
  assert.equal(r.reasonCode, "adaptive_no_vark");
});

test("11a. kinesthetic (no VARK mapping) + no evidence -> nothing", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: null, // A4 returns null for kinesthetic
    effectiveVarkCategory: "kinesthetic",
    availableModalities: ALL,
    evidence: evidence({}, 0),
  });
  assert.equal(r.modality, null);
  assert.equal(r.source, "vark");
});

test("11b. kinesthetic + strong real evidence for audio -> adaptive recommends audio", () => {
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: null,
    effectiveVarkCategory: "kinesthetic",
    availableModalities: ALL,
    evidence: evidence({ audio: { score: 2, evidenceCount: 2 } }, 2),
  });
  assert.equal(r.source, "adaptive");
  assert.equal(r.modality, "audio");
  assert.equal(r.reasonCode, "adaptive_no_vark");
});

test("12. adaptive winner not available in this topic -> falls back safely", () => {
  // Global evidence best is audio, but this topic only has text/video lessons.
  const r = computeAdaptiveModalityRecommendation({
    varkRecommendation: { modality: "video", category: "visual" },
    effectiveVarkCategory: "visual",
    availableModalities: ["text", "video"],
    evidence: evidence(
      { audio: { score: 5, evidenceCount: 3 }, text: { score: 1, evidenceCount: 1 } },
      3,
    ),
  });
  // audio isn't available -> not a candidate; text has only 1 evidence ->
  // not a candidate either -> VARK fallback.
  assert.equal(r.source, "vark");
  assert.equal(r.modality, "video");
  assert.ok(r.modality === null || ["text", "video"].includes(r.modality));
});

test("returned modality is always available or null (invariant across a sweep)", () => {
  const available: LessonModality[] = ["text", "slides"];
  for (const winnerScore of [1, 3, 5]) {
    const r = computeAdaptiveModalityRecommendation({
      varkRecommendation: { modality: "video", category: "visual" }, // video NOT available
      effectiveVarkCategory: "visual",
      availableModalities: available,
      evidence: evidence(
        { slides: { score: winnerScore, evidenceCount: 2 }, video: { score: 9, evidenceCount: 9 } },
        3,
      ),
    });
    assert.ok(r.modality === null || available.includes(r.modality));
  }
});

/* ---------------- outcomeReward ---------------- */

test("13. outcomeReward band boundaries", () => {
  assert.equal(outcomeReward(0), -1);
  assert.equal(outcomeReward(49), -1);
  assert.equal(outcomeReward(50), 0);
  assert.equal(outcomeReward(79), 0);
  assert.equal(outcomeReward(80), 1);
  assert.equal(outcomeReward(100), 1);
});

/* ---------------- buildModalityEvidence ---------------- */

test("8. event spam does not inflate evidence — 20 video opens + 1 text = 1 each", () => {
  const T = "topic-1";
  const interactions = [
    ...Array.from({ length: 20 }, (_, i) => ({
      topic_id: T,
      modality: "video" as LessonModality,
      created_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
    })),
    { topic_id: T, modality: "text" as LessonModality, created_at: "2026-01-01T00:00:30Z" },
  ];
  const outcomes = [{ topic_id: T, score_percent: 90, created_at: "2026-01-01T01:00:00Z" }];
  const ev = buildModalityEvidence(outcomes, interactions);
  assert.equal(ev.linkedOutcomeCount, 1);
  assert.deepEqual(ev.perModality.video, { score: 1, evidenceCount: 1 });
  assert.deepEqual(ev.perModality.text, { score: 1, evidenceCount: 1 });
});

test("14. window scoping — each outcome only credits the modalities used since the previous one", () => {
  const T = "topic-1";
  const interactions = [
    { topic_id: T, modality: "video" as LessonModality, created_at: "2026-01-01T00:00:00Z" },
    { topic_id: T, modality: "text" as LessonModality, created_at: "2026-01-03T00:00:00Z" },
  ];
  const outcomes = [
    { topic_id: T, score_percent: 40, created_at: "2026-01-02T00:00:00Z" }, // after video, weak
    { topic_id: T, score_percent: 90, created_at: "2026-01-04T00:00:00Z" }, // after text, strong
  ];
  const ev = buildModalityEvidence(outcomes, interactions);
  assert.equal(ev.linkedOutcomeCount, 2);
  assert.deepEqual(ev.perModality.video, { score: -1, evidenceCount: 1 }); // only outcome 1
  assert.deepEqual(ev.perModality.text, { score: 1, evidenceCount: 1 }); // only outcome 2
});

test("buildModalityEvidence ignores a different topic's interactions", () => {
  const ev = buildModalityEvidence(
    [{ topic_id: "t1", score_percent: 90, created_at: "2026-01-02T00:00:00Z" }],
    [{ topic_id: "t2", modality: "video", created_at: "2026-01-01T00:00:00Z" }],
  );
  assert.equal(ev.linkedOutcomeCount, 0);
  assert.deepEqual(ev.perModality, {});
});

test("buildModalityEvidence: outcome with no preceding interaction is not linked", () => {
  const ev = buildModalityEvidence(
    [{ topic_id: "t1", score_percent: 90, created_at: "2026-01-01T00:00:00Z" }],
    [{ topic_id: "t1", modality: "video", created_at: "2026-06-01T00:00:00Z" }], // AFTER the quiz
  );
  assert.equal(ev.linkedOutcomeCount, 0);
});

/* ---------------- server function: static security/scope checks ---------------- */

const fnSrc = readFileSync(
  fileURLToPath(new URL("./adaptive-modality.functions.ts", import.meta.url)),
  "utf8",
);

test("server function is authenticated and never trusts a client user id", () => {
  assert.match(fnSrc, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(fnSrc, /const \{ supabase, userId \} = context/);
  assert.doesNotMatch(fnSrc, /data\.userId|data\.user_id/);
});

test("server function scopes every learning_interactions read to the caller", () => {
  const readsScoped = fnSrc.match(
    /from\("learning_interactions"\)[\s\S]*?\.eq\("user_id", userId\)/g,
  );
  assert.ok(
    readsScoped && readsScoped.length >= 2,
    "both learning_interactions reads must .eq user_id",
  );
});

test("6. General Course Quiz outcomes are excluded — only official_quiz_completed is read", () => {
  assert.match(fnSrc, /\.eq\("event_type", "official_quiz_completed"\)/);
  assert.doesNotMatch(fnSrc, /course_quiz|general_quiz|practice_quiz_completed/);
});

test("only the compact final recommendation is returned, not raw history", () => {
  assert.match(fnSrc, /Promise<AdaptiveModalityRecommendation>/);
  assert.match(fnSrc, /return computeAdaptiveModalityRecommendation\(/);
});

test("capped history query has explicit, deterministic ordering (recent-first)", () => {
  // Every .limit(MAX_ROWS) must be preceded by an explicit recent-first order
  // plus an id tiebreak — no reliance on unspecified DB row order.
  assert.doesNotMatch(fnSrc, /\.order\("created_at"\)\s*\n\s*\.limit/); // no bare ascending order
  const orderedCaps = fnSrc.match(
    /\.order\("created_at", \{ ascending: false \}\)\s*\n\s*\.order\("id", \{ ascending: false \}\)\s*\n\s*\.limit\(MAX_ROWS\)/g,
  );
  assert.ok(
    orderedCaps && orderedCaps.length >= 2,
    "both capped reads must be recent-first + id tiebreak",
  );
});
