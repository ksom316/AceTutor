/**
 * R7 — Remedial Intelligence Layer: pure evaluation over existing R1/R4/R6
 * evidence. No DB, no AI, no writes; observational wording only; A8 low-sample
 * philosophy; video without an engagement signal is never treated as watched.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-intelligence.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  aggregateCourseRemedialInsights,
  aggregateRemedialFormatEffectiveness,
  aggregateRemedialRecommendationAccuracy,
  buildRemedialInterventionRecords,
  deriveStudentRemedialProfile,
  OBSERVED_IMPROVEMENT_LABEL,
  REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
  REMEDIAL_FORMAT_ENGAGEMENT_TRACKED,
  type RemedialInteractionRow,
  type RemedialInterventionRecord,
  type StudyPathRemedialRow,
} from "@/lib/remedial-intelligence";
import type { OfficialModuleOutcome } from "@/lib/remedial-outcome-linking";

/* --------------------------------- helpers -------------------------------- */

const path = (over: Partial<StudyPathRemedialRow> & { id: string }): StudyPathRemedialRow => ({
  topicId: "t1",
  baselineScore: 40,
  hasRemedialVideoRecommendation: false,
  ...over,
});

let seq = 0;
const sel = (over: Partial<RemedialInteractionRow>): RemedialInteractionRow => ({
  studyPathId: "sp1",
  eventType: "remedial_format_selected",
  format: "text",
  recommendedFormat: null,
  recommendationSource: null,
  contentVersion: "v1",
  createdAt: `2026-01-01T00:00:${String(seq++).padStart(2, "0")}Z`,
  ...over,
});
const eng = (over: Partial<RemedialInteractionRow>): RemedialInteractionRow =>
  sel({ eventType: "remedial_meaningful_engagement", ...over });

const outcome = (over: Partial<OfficialModuleOutcome>): OfficialModuleOutcome => ({
  attemptId: `att-${seq++}`,
  topicId: "t1",
  scorePercent: 80,
  completedAt: "2026-02-01T00:00:00Z",
  ...over,
});

/* --------------------------- A. record derivation ------------------------- */

test("build: a selected-but-not-engaged format is an intervention with no outcome", () => {
  const recs = buildRemedialInterventionRecords({
    studyPaths: [path({ id: "sp1", baselineScore: 40 })],
    remedialInteractions: [sel({ studyPathId: "sp1", format: "text" })],
    moduleOutcomes: [outcome({ scorePercent: 90, completedAt: "2026-03-01T00:00:00Z" })],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].meaningfulEngagement, false);
  // no meaningful engagement => no subsequent score even though a later quiz exists
  assert.equal(recs[0].subsequentQuizScore, null);
  assert.equal(recs[0].scoreDifference, null);
});

test("build: baseline vs subsequent score difference is subsequent - baseline", () => {
  const recs = buildRemedialInterventionRecords({
    studyPaths: [path({ id: "sp1", baselineScore: 45 })],
    remedialInteractions: [
      eng({ studyPathId: "sp1", format: "audio", createdAt: "2026-01-10T00:00:00Z" }),
    ],
    moduleOutcomes: [outcome({ scorePercent: 72, completedAt: "2026-01-20T00:00:00Z" })],
  });
  assert.equal(recs[0].meaningfulEngagement, true);
  assert.equal(recs[0].baselineScore, 45);
  assert.equal(recs[0].subsequentQuizScore, 72);
  assert.equal(recs[0].scoreDifference, 27);
});

test("build: missing quiz outcome is handled safely (null, not 0)", () => {
  const recs = buildRemedialInterventionRecords({
    studyPaths: [path({ id: "sp1" })],
    remedialInteractions: [eng({ studyPathId: "sp1", format: "visual" })],
    moduleOutcomes: [],
  });
  assert.equal(recs[0].subsequentQuizScore, null);
  assert.equal(recs[0].scoreDifference, null);
});

test("build: missing baseline => scoreDifference null, subsequent still recorded", () => {
  const recs = buildRemedialInterventionRecords({
    studyPaths: [path({ id: "sp1", baselineScore: null })],
    remedialInteractions: [
      eng({ studyPathId: "sp1", format: "text", createdAt: "2026-01-05T00:00:00Z" }),
    ],
    moduleOutcomes: [outcome({ scorePercent: 66, completedAt: "2026-01-06T00:00:00Z" })],
  });
  assert.equal(recs[0].baselineScore, null);
  assert.equal(recs[0].subsequentQuizScore, 66);
  assert.equal(recs[0].scoreDifference, null);
});

test("build: multiple formats for the same study path are separate interventions", () => {
  const recs = buildRemedialInterventionRecords({
    studyPaths: [path({ id: "sp1", baselineScore: 30 })],
    remedialInteractions: [
      eng({ studyPathId: "sp1", format: "text", createdAt: "2026-01-02T00:00:00Z" }),
      eng({ studyPathId: "sp1", format: "audio", createdAt: "2026-01-03T00:00:00Z" }),
      sel({ studyPathId: "sp1", format: "visual" }),
    ],
    moduleOutcomes: [outcome({ scorePercent: 75, completedAt: "2026-01-10T00:00:00Z" })],
  });
  assert.equal(recs.length, 3);
  assert.deepEqual(recs.map((r) => r.remedialFormatUsed).sort(), ["audio", "text", "visual"]);
  // both engaged formats point at the one later quiz (observational, R4 rules)
  assert.equal(recs.find((r) => r.remedialFormatUsed === "text")!.subsequentQuizScore, 75);
  assert.equal(recs.find((r) => r.remedialFormatUsed === "audio")!.subsequentQuizScore, 75);
  assert.equal(recs.find((r) => r.remedialFormatUsed === "visual")!.subsequentQuizScore, null);
});

test("build: interactions for an out-of-scope study path are dropped", () => {
  const recs = buildRemedialInterventionRecords({
    studyPaths: [path({ id: "sp1" })],
    remedialInteractions: [sel({ studyPathId: "other" }), sel({ studyPathId: "sp1" })],
    moduleOutcomes: [],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].studyPathId, "sp1");
});

/* ---------------------- B. format effectiveness -------------------------- */

const rec = (over: Partial<RemedialInterventionRecord>): RemedialInterventionRecord => ({
  studyPathId: "sp",
  topicId: "t1",
  baselineScore: 40,
  remedialFormatUsed: "text",
  recommendedFormat: null,
  recommendationSource: null,
  meaningfulEngagement: true,
  subsequentQuizScore: 70,
  scoreDifference: 30,
  contentVersion: "v1",
  ...over,
});

test("effectiveness: text/audio/visual aggregation with observed improvement", () => {
  const eff = aggregateRemedialFormatEffectiveness([
    rec({
      remedialFormatUsed: "text",
      baselineScore: 40,
      subsequentQuizScore: 80,
      scoreDifference: 40,
    }),
    rec({
      remedialFormatUsed: "text",
      baselineScore: 50,
      subsequentQuizScore: 60,
      scoreDifference: 10,
    }),
    rec({
      remedialFormatUsed: "audio",
      baselineScore: 30,
      subsequentQuizScore: 45,
      scoreDifference: 15,
    }),
    rec({
      remedialFormatUsed: "visual",
      meaningfulEngagement: false,
      subsequentQuizScore: null,
      scoreDifference: null,
    }),
  ]);
  assert.equal(eff.text.interventions, 2);
  assert.equal(eff.text.withMeaningfulEngagement, 2);
  assert.equal(eff.text.followedByQuizOutcome, 2);
  assert.equal(eff.text.averageBaselineScore, 45);
  assert.equal(eff.text.averageSubsequentScore, 70);
  assert.equal(eff.text.averageObservedImprovement, 25);
  assert.equal(eff.audio.interventions, 1);
  assert.equal(eff.visual.interventions, 1);
  assert.equal(eff.visual.withMeaningfulEngagement, 0);
  assert.equal(eff.visual.followedByQuizOutcome, 0);
  assert.equal(eff.visual.averageObservedImprovement, null);
});

test("effectiveness: low sample => insufficient; >=5 => sufficient; 0 => none", () => {
  assert.equal(REMEDIAL_INTELLIGENCE_MIN_SAMPLES, 5);
  const few = aggregateRemedialFormatEffectiveness([
    rec({ remedialFormatUsed: "audio" }),
    rec({ remedialFormatUsed: "audio" }),
  ]);
  assert.equal(few.audio.evidenceState, "insufficient");
  assert.equal(few.text.evidenceState, "none");

  const many = aggregateRemedialFormatEffectiveness(
    Array.from({ length: 5 }, () => rec({ remedialFormatUsed: "text" })),
  );
  assert.equal(many.text.evidenceState, "sufficient");
});

test("effectiveness: no evidence never produces a fake conclusion", () => {
  const eff = aggregateRemedialFormatEffectiveness([]);
  for (const f of ["text", "audio", "visual"] as const) {
    assert.equal(eff[f].interventions, 0);
    assert.equal(eff[f].averageObservedImprovement, null);
    assert.equal(eff[f].averageBaselineScore, null);
    assert.equal(eff[f].averageSubsequentScore, null);
    assert.equal(eff[f].evidenceState, "none");
  }
});

test("effectiveness: missing engagement does not count as a success", () => {
  const eff = aggregateRemedialFormatEffectiveness([
    rec({
      remedialFormatUsed: "audio",
      meaningfulEngagement: false,
      subsequentQuizScore: null,
      scoreDifference: null,
    }),
  ]);
  assert.equal(eff.audio.interventions, 1);
  assert.equal(eff.audio.withMeaningfulEngagement, 0);
  assert.equal(eff.audio.followedByQuizOutcome, 0);
  assert.equal(eff.audio.averageObservedImprovement, null);
});

test("effectiveness: video is always 'unavailable' and never estimated", () => {
  assert.equal(REMEDIAL_FORMAT_ENGAGEMENT_TRACKED.video, false);
  // even if a stray record claimed a video engagement + improvement:
  const eff = aggregateRemedialFormatEffectiveness([
    rec({ remedialFormatUsed: "video" as never, subsequentQuizScore: 95, scoreDifference: 55 }),
  ]);
  assert.equal(eff.video.evidenceState, "unavailable");
  assert.equal(eff.video.interventions, 0);
  assert.equal(eff.video.averageObservedImprovement, null);
  assert.equal(eff.video.averageSubsequentScore, null);
});

/* --------------------- C. recommendation accuracy ----------------------- */

test("recommendation accuracy: match rate = followed / (instances with a recommendation)", () => {
  const acc = aggregateRemedialRecommendationAccuracy([
    // sp1: recommended audio, engaged audio => match
    rec({
      studyPathId: "sp1",
      recommendedFormat: "audio",
      remedialFormatUsed: "audio",
      recommendationSource: "vark",
    }),
    // sp2: recommended audio, engaged text (switched) => not followed
    rec({
      studyPathId: "sp2",
      recommendedFormat: "audio",
      remedialFormatUsed: "text",
      recommendationSource: "vark",
    }),
    // sp3: no recommendation, engaged visual => not counted at all
    rec({ studyPathId: "sp3", recommendedFormat: null, remedialFormatUsed: "visual" }),
  ]);
  assert.equal(acc.recommendationCount, 2);
  assert.equal(acc.followedRecommendationCount, 1);
  assert.equal(acc.matchRate, 0.5);
  assert.equal(acc.bySource.vark.matchRate, 0.5);
});

test("recommendation accuracy: switching format with no recommendation is not a failure", () => {
  const acc = aggregateRemedialRecommendationAccuracy([
    rec({ studyPathId: "sp1", recommendedFormat: null, remedialFormatUsed: "text" }),
    rec({ studyPathId: "sp1", recommendedFormat: null, remedialFormatUsed: "audio" }),
  ]);
  assert.equal(acc.recommendationCount, 0);
  assert.equal(acc.matchRate, null);
});

test("recommendation accuracy: recommended format engaged among several used on one path => followed", () => {
  const acc = aggregateRemedialRecommendationAccuracy([
    rec({
      studyPathId: "sp1",
      contentVersion: "v1",
      recommendedFormat: "visual",
      remedialFormatUsed: "text",
      meaningfulEngagement: true,
    }),
    rec({
      studyPathId: "sp1",
      contentVersion: "v1",
      recommendedFormat: "visual",
      remedialFormatUsed: "visual",
      meaningfulEngagement: true,
    }),
  ]);
  assert.equal(acc.recommendationCount, 1); // one (studyPath, contentVersion) instance
  assert.equal(acc.followedRecommendationCount, 1);
});

test("recommendation accuracy: recommended format only SELECTED (not engaged) is not followed", () => {
  const acc = aggregateRemedialRecommendationAccuracy([
    rec({
      studyPathId: "sp1",
      recommendedFormat: "audio",
      remedialFormatUsed: "audio",
      meaningfulEngagement: false,
    }),
  ]);
  assert.equal(acc.recommendationCount, 1);
  assert.equal(acc.followedRecommendationCount, 0);
});

/* ----------------------- D. student profile ---------------------------- */

test("student profile: no data => empty lists, needsMoreEvidence true", () => {
  const p = deriveStudentRemedialProfile([]);
  assert.deepEqual(p.preferredSuccessfulFormats, []);
  assert.deepEqual(p.strongestImprovementAreas, []);
  assert.equal(p.needsMoreEvidence, true);
});

test("student profile: one attempt is never a conclusion", () => {
  const p = deriveStudentRemedialProfile([
    rec({ remedialFormatUsed: "visual", scoreDifference: 40, subsequentQuizScore: 80 }),
  ]);
  assert.deepEqual(p.preferredSuccessfulFormats, []);
  assert.equal(p.needsMoreEvidence, true);
});

test("student profile: >=2 positive observations list a format, flagged insufficient", () => {
  const p = deriveStudentRemedialProfile([
    rec({ remedialFormatUsed: "visual", topicId: "t1", scoreDifference: 20 }),
    rec({ remedialFormatUsed: "visual", topicId: "t2", scoreDifference: 10 }),
  ]);
  assert.equal(p.preferredSuccessfulFormats.length, 1);
  assert.equal(p.preferredSuccessfulFormats[0].format, "visual");
  assert.equal(p.preferredSuccessfulFormats[0].evidenceState, "insufficient");
  assert.equal(p.needsMoreEvidence, true);
});

test("student profile: missing engagement is excluded from success", () => {
  const p = deriveStudentRemedialProfile([
    rec({ remedialFormatUsed: "audio", meaningfulEngagement: false, scoreDifference: 50 }),
    rec({ remedialFormatUsed: "audio", meaningfulEngagement: false, scoreDifference: 50 }),
  ]);
  assert.deepEqual(p.preferredSuccessfulFormats, []);
});

test("student profile: a format that did not improve is not listed as preferred", () => {
  const p = deriveStudentRemedialProfile([
    rec({ remedialFormatUsed: "text", scoreDifference: -10 }),
    rec({ remedialFormatUsed: "text", scoreDifference: -5 }),
  ]);
  assert.deepEqual(p.preferredSuccessfulFormats, []);
});

/* --------------------- E. course insights / privacy -------------------- */

const PII_KEY =
  /user_?id|studypath_?id|study_path_?id|email|full_?name|\bname\b|responses|token|secret|question|prompt|answer/i;

function assertNoPiiKeys(value: unknown, p = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPiiKeys(v, `${p}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assert.ok(!PII_KEY.test(k), `PII-looking key "${k}" at ${p}`);
      assertNoPiiKeys(v, `${p}.${k}`);
    }
  }
}

test("course insights: aggregate only — no student identifiers, no study-path ids", () => {
  const records = buildRemedialInterventionRecords({
    studyPaths: [
      path({ id: "11111111-1111-1111-1111-111111111111", topicId: "topic-a", baselineScore: 40 }),
      path({ id: "22222222-2222-2222-2222-222222222222", topicId: "topic-b", baselineScore: 55 }),
    ],
    remedialInteractions: [
      eng({
        studyPathId: "11111111-1111-1111-1111-111111111111",
        format: "text",
        createdAt: "2026-01-02T00:00:00Z",
      }),
      eng({
        studyPathId: "22222222-2222-2222-2222-222222222222",
        format: "audio",
        createdAt: "2026-01-02T00:00:00Z",
      }),
    ],
    moduleOutcomes: [
      outcome({ topicId: "topic-a", scorePercent: 80, completedAt: "2026-01-10T00:00:00Z" }),
      outcome({ topicId: "topic-b", scorePercent: 70, completedAt: "2026-01-10T00:00:00Z" }),
    ],
  });
  const insights = aggregateCourseRemedialInsights({
    records,
    totalStudyPaths: 2,
    studyPathsWithVideoRecommendation: 1,
  });
  assertNoPiiKeys(insights);
  const json = JSON.stringify(insights);
  assert.doesNotMatch(json, /1111-1111|2222-2222/); // no study-path ids leak
  assert.equal(insights.totalStudyPaths, 2);
  assert.equal(insights.totalEngagedInterventions, 2);
  assert.equal(insights.videoEvidence.evidenceState, "unavailable");
  assert.equal(insights.videoEvidence.recommendationsPresent, 1);
});

test("course insights: video warning + low-sample warnings are present, wording is observational", () => {
  const insights = aggregateCourseRemedialInsights({
    records: [rec({ topicId: "topic-a" })],
    totalStudyPaths: 1,
    studyPathsWithVideoRecommendation: 0,
  });
  assert.ok(insights.evidenceWarnings.some((w) => w.startsWith("video:")));
  assert.match(insights.disclaimer, /Observational only/);
  assert.doesNotMatch(insights.disclaimer, /caused improvement|because of the format/i);
  assert.equal(OBSERVED_IMPROVEMENT_LABEL, "Observed improvement after remediation");
});

test("course insights: topic improvement summary carries counts + evidence state", () => {
  const insights = aggregateCourseRemedialInsights({
    records: [
      rec({ topicId: "topic-a", scoreDifference: 20, subsequentQuizScore: 60 }),
      rec({ topicId: "topic-a", scoreDifference: 10, subsequentQuizScore: 50 }),
    ],
    totalStudyPaths: 3,
    studyPathsWithVideoRecommendation: 0,
  });
  const a = insights.topicImprovementSummary.find((t) => t.topicId === "topic-a")!;
  assert.equal(a.interventions, 2);
  assert.equal(a.observationsWithOutcome, 2);
  assert.equal(a.averageObservedImprovement, 15);
  assert.equal(a.evidenceState, "insufficient");
});

/* ----------------------- guardrails: no DB / AI / A7 ------------------- */

const SRC = readFileSync(
  fileURLToPath(new URL("./remedial-intelligence.ts", import.meta.url)),
  "utf8",
);

test("R7 source: no Supabase, no React, no AI, no writes", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""); // strip comments/prose
  assert.doesNotMatch(code, /@\/integrations\/supabase|from ["']react["']|useState|useEffect/i);
  assert.doesNotMatch(code, /gemini|generativelanguage|anthropic|openai|\.rpc\(|createServerFn/i);
  assert.doesNotMatch(code, /\binsert\(|\bupsert\(|supabase\./i);
});

test("R7 source: does not import or mutate A7 / VARK / Mastery / grading modules", () => {
  assert.doesNotMatch(
    SRC,
    /adaptive-modality|vark-inference|vark-content-recommendation|computeModuleMastery|grade_quiz|initial-modality/,
  );
});
