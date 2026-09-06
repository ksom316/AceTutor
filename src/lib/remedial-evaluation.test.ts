/**
 * R4 — pure aggregation of remedial-intervention evidence (for a later A8 /
 * lecturer surface).
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-evaluation.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateRemedialEvaluation, REMEDIAL_EVAL_MIN_SAMPLES } from "@/lib/remedial-evaluation";
import type { RemedialOutcomeLink } from "@/lib/remedial-outcome-linking";

let attemptSeq = 0;
const link = (over: Partial<RemedialOutcomeLink>): RemedialOutcomeLink => ({
  studyPathId: "sp",
  topicId: "t",
  formatUsed: "audio",
  recommendedFormat: "audio",
  baselineScorePercent: 40,
  subsequentScorePercent: 80,
  subsequentAttemptId: `att-${++attemptSeq}`,
  engagedAt: "2026-01-10T00:00:00Z",
  subsequentQuizAt: "2026-01-20T00:00:00Z",
  observedScoreDifference: 40,
  ...over,
});

test("20. selections + engagements are grouped by text / audio / visual", () => {
  const m = aggregateRemedialEvaluation({
    formatSelections: [{ format: "audio" }, { format: "audio" }, { format: "visual" }],
    meaningfulEngagements: [
      { format: "audio", recommendedFormat: "audio" },
      { format: "text", recommendedFormat: "audio" },
    ],
    outcomeLinks: [],
  });
  assert.deepEqual(m.formatSelectionsByFormat, { text: 0, audio: 2, visual: 1 });
  assert.deepEqual(m.meaningfulEngagementsByFormat, { text: 1, audio: 1, visual: 0 });
});

test("21. recommended-format match rate = matched / (engagements carrying a recommendation)", () => {
  const m = aggregateRemedialEvaluation({
    formatSelections: [],
    meaningfulEngagements: [
      { format: "audio", recommendedFormat: "audio" }, // match
      { format: "text", recommendedFormat: "audio" }, // mismatch
      { format: "visual", recommendedFormat: null }, // not counted
    ],
    outcomeLinks: [],
  });
  assert.equal(m.recommendedFormatMatchRate, 0.5);

  const none = aggregateRemedialEvaluation({
    formatSelections: [],
    meaningfulEngagements: [{ format: "text", recommendedFormat: null }],
    outcomeLinks: [],
  });
  assert.equal(none.recommendedFormatMatchRate, null);
});

test("19b/metrics. per-format before/after averages + labelled observed difference", () => {
  const m = aggregateRemedialEvaluation({
    formatSelections: [],
    meaningfulEngagements: [],
    outcomeLinks: [
      link({
        formatUsed: "audio",
        baselineScorePercent: 40,
        subsequentScorePercent: 80,
        observedScoreDifference: 40,
      }),
      link({
        formatUsed: "audio",
        baselineScorePercent: 50,
        subsequentScorePercent: 60,
        observedScoreDifference: 10,
      }),
      link({
        formatUsed: "text",
        baselineScorePercent: 30,
        subsequentScorePercent: 45,
        observedScoreDifference: 15,
      }),
    ],
  });
  assert.equal(m.engagementsFollowedByOfficialQuiz, 3);
  assert.equal(m.formatLevelObservationalLinks, 3);
  assert.equal(m.outcomeByFormat.audio.pairCount, 2);
  assert.equal(m.outcomeByFormat.audio.averageBaselineScore, 45);
  assert.equal(m.outcomeByFormat.audio.averageSubsequentScore, 70);
  assert.equal(m.outcomeByFormat.audio.averageObservedScoreDifference, 25);
  assert.equal(m.outcomeByFormat.text.pairCount, 1);
  assert.equal(m.outcomeByFormat.visual.pairCount, 0);
  assert.equal(m.outcomeByFormat.visual.averageObservedScoreDifference, null);
  // wording never implies causation
  assert.match(m.disclaimer, /OBSERVATIONAL|Observational/);
  assert.doesNotMatch(m.disclaimer, /caused|improvement caused|because of/i);
});

test("format-level links vs unique subsequent quizzes: 40% -> Text + Audio -> 80%", () => {
  const m = aggregateRemedialEvaluation({
    formatSelections: [],
    meaningfulEngagements: [],
    outcomeLinks: [
      link({ formatUsed: "text", subsequentAttemptId: "att-retake" }),
      link({ formatUsed: "audio", subsequentAttemptId: "att-retake" }),
    ],
  });
  // A. two format-level observations
  assert.equal(m.formatLevelObservationalLinks, 2);
  assert.equal(m.outcomeByFormat.text.pairCount, 1);
  assert.equal(m.outcomeByFormat.audio.pairCount, 1);
  // B. ONE unique subsequent official quiz attempt
  assert.equal(m.uniqueSubsequentOfficialQuizzes, 1);
});

test("22. low-sample state preserved (A8 philosophy), no fake significance", () => {
  const m = aggregateRemedialEvaluation({
    formatSelections: [],
    meaningfulEngagements: [],
    outcomeLinks: [link({ formatUsed: "audio" }), link({ formatUsed: "audio" })],
  });
  assert.equal(REMEDIAL_EVAL_MIN_SAMPLES, 5);
  assert.equal(m.outcomeByFormat.audio.evidenceState, "insufficient"); // 2 < 5
  assert.equal(m.outcomeByFormat.text.evidenceState, "none"); // 0
  const many = aggregateRemedialEvaluation({
    formatSelections: [],
    meaningfulEngagements: [],
    outcomeLinks: Array.from({ length: 6 }, () => link({ formatUsed: "text" })),
  });
  assert.equal(many.outcomeByFormat.text.evidenceState, "sufficient");
});

test("baseline-less pairs still count for pairCount and subsequent average", () => {
  const m = aggregateRemedialEvaluation({
    formatSelections: [],
    meaningfulEngagements: [],
    outcomeLinks: [
      link({
        formatUsed: "visual",
        baselineScorePercent: null,
        subsequentScorePercent: 70,
        observedScoreDifference: null,
      }),
    ],
  });
  assert.equal(m.outcomeByFormat.visual.pairCount, 1);
  assert.equal(m.outcomeByFormat.visual.averageBaselineScore, null);
  assert.equal(m.outcomeByFormat.visual.averageSubsequentScore, 70);
  assert.equal(m.outcomeByFormat.visual.averageObservedScoreDifference, null);
});
