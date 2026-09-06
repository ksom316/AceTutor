/**
 * R8.1 — Personal Remedial Recommendation Engine: pure evaluation over R7's
 * RemedialInterventionRecord[]. Evidence-gated, observational wording only,
 * video never estimated, no DB / AI / writes, and no A7 dependency.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-adaptation.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  deriveRemedialFormatRecommendation,
  REMEDIAL_ADAPTATION_STRONG_IMPROVEMENT_POINTS,
} from "@/lib/remedial-adaptation";
import {
  REMEDIAL_INTELLIGENCE_MIN_SAMPLES,
  REMEDIAL_STUDENT_MIN_OBSERVATIONS,
  type RemedialInterventionRecord,
} from "@/lib/remedial-intelligence";

let n = 0;
const rec = (over: Partial<RemedialInterventionRecord>): RemedialInterventionRecord => ({
  studyPathId: `sp-${n++}`,
  topicId: "sql-normalization",
  baselineScore: 40,
  remedialFormatUsed: "visual",
  recommendedFormat: null,
  recommendationSource: null,
  meaningfulEngagement: true,
  subsequentQuizScore: 85,
  scoreDifference: 45,
  contentVersion: "v1",
  ...over,
});

/** k usable positive visual observations of +`improvement`. */
const visualRuns = (k: number, improvement: number): RemedialInterventionRecord[] =>
  Array.from({ length: k }, () =>
    rec({
      remedialFormatUsed: "visual",
      baselineScore: 40,
      subsequentQuizScore: 40 + improvement,
      scoreDifference: improvement,
    }),
  );

/* ------------------------------ empty / thin ----------------------------- */

test("no records => confidence none, no preferred format, reason asks for history", () => {
  const out = deriveRemedialFormatRecommendation([]);
  assert.equal(out.confidence, "none");
  assert.equal(out.preferredFormat, null);
  assert.equal(out.leaningFormat, null);
  assert.equal(out.totalObservations, 0);
  assert.match(out.reason, /[Nn]ot enough/);
});

test("records without meaningful engagement are not usable", () => {
  const out = deriveRemedialFormatRecommendation(
    visualRuns(6, 40).map((r) => ({ ...r, meaningfulEngagement: false })),
  );
  assert.equal(out.confidence, "none");
  assert.equal(out.totalObservations, 0);
});

test("records with no before/after pair (missing scoreDifference) are not usable", () => {
  const out = deriveRemedialFormatRecommendation(
    visualRuns(6, 40).map((r) => ({ ...r, scoreDifference: null, baselineScore: null })),
  );
  assert.equal(out.confidence, "none");
  assert.equal(out.totalObservations, 0);
});

test("one strong positive attempt is never a conclusion", () => {
  const out = deriveRemedialFormatRecommendation(visualRuns(1, 45));
  assert.equal(out.confidence, "none");
  assert.equal(out.preferredFormat, null);
  assert.equal(REMEDIAL_STUDENT_MIN_OBSERVATIONS, 2);
});

/* ------------------------------- low / act ------------------------------ */

test("2–4 positive observations => low confidence, leaning but not preferred", () => {
  const out = deriveRemedialFormatRecommendation(visualRuns(3, 30));
  assert.equal(out.confidence, "low");
  assert.equal(out.preferredFormat, null);
  assert.equal(out.leaningFormat, "visual");
  assert.match(out.reason, /early positive association/);
  assert.match(out.reason, /3 of 5/);
});

test("5+ strong consistent positive observations => high, preferred = visual, association wording", () => {
  const out = deriveRemedialFormatRecommendation(visualRuns(5, 45));
  assert.equal(REMEDIAL_INTELLIGENCE_MIN_SAMPLES, 5);
  assert.equal(out.confidence, "high");
  assert.equal(out.preferredFormat, "visual");
  assert.equal(out.leaningFormat, "visual");
  assert.equal(
    out.reason,
    "Visual remediation has previously been associated with improvement in your completed study paths.",
  );
});

test("5+ small positive observations => medium (below the strong-improvement bar)", () => {
  const small = REMEDIAL_ADAPTATION_STRONG_IMPROVEMENT_POINTS - 5;
  const out = deriveRemedialFormatRecommendation(visualRuns(6, small));
  assert.equal(out.confidence, "medium");
  assert.equal(out.preferredFormat, "visual");
  assert.match(out.reason, /some improvement/);
  assert.doesNotMatch(out.reason, /caused/i);
});

test("5+ observations but mostly non-positive => not high even if the mean scrapes positive", () => {
  const records = [
    ...visualRuns(2, 60), // 2 big wins
    ...visualRuns(4, -5), // 4 small losses  -> mean = (120-20)/6 ~ 17 but only 33% positive
  ];
  const out = deriveRemedialFormatRecommendation(records);
  assert.equal(out.preferredFormat, "visual");
  assert.equal(out.confidence, "medium");
});

/* --------------------------- format comparison ------------------------- */

test("a format with a negative observed average is never chosen", () => {
  const out = deriveRemedialFormatRecommendation([
    ...visualRuns(6, -10).map((r) => ({ ...r, remedialFormatUsed: "text" as const })),
    ...visualRuns(5, 30),
  ]);
  assert.equal(out.preferredFormat, "visual");
  const text = out.perFormat.find((f) => f.format === "text")!;
  assert.ok((text.averageObservedImprovement ?? 0) < 0);
});

test("when two formats both qualify, the higher observed average wins", () => {
  const out = deriveRemedialFormatRecommendation([
    ...visualRuns(6, 15),
    ...visualRuns(6, 40).map((r) => ({ ...r, remedialFormatUsed: "audio" as const })),
  ]);
  assert.equal(out.preferredFormat, "audio");
});

test("tie on average + observations resolves deterministically by format order", () => {
  const a = deriveRemedialFormatRecommendation([
    ...visualRuns(5, 20),
    ...visualRuns(5, 20).map((r) => ({ ...r, remedialFormatUsed: "audio" as const })),
  ]);
  const b = deriveRemedialFormatRecommendation([
    ...visualRuns(5, 20).map((r) => ({ ...r, remedialFormatUsed: "audio" as const })),
    ...visualRuns(5, 20),
  ]);
  assert.equal(a.preferredFormat, "audio"); // audio precedes visual in REMEDIAL_INTELLIGENCE_FORMATS
  assert.equal(b.preferredFormat, a.preferredFormat); // input order does not matter
});

/* ------------------------------- video (§7) ---------------------------- */

test("video is never a candidate and is never estimated", () => {
  const out = deriveRemedialFormatRecommendation(
    Array.from({ length: 8 }, () =>
      rec({
        remedialFormatUsed: "video" as never,
        subsequentQuizScore: 95,
        scoreDifference: 55,
      }),
    ),
  );
  assert.equal(out.confidence, "none");
  assert.equal(out.preferredFormat, null);
  const video = out.perFormat.find((f) => f.format === "video")!;
  assert.equal(video.observations, 0);
  assert.equal(video.averageObservedImprovement, null);
  assert.equal(video.evidenceState, "unavailable");
});

/* ------------------------------ topic filter -------------------------- */

test("options.topicId restricts the evidence considered", () => {
  const records = [
    ...visualRuns(5, 45).map((r) => ({ ...r, topicId: "sql-normalization" })),
    ...visualRuns(5, 45).map((r) => ({
      ...r,
      topicId: "indexing",
      remedialFormatUsed: "audio" as const,
    })),
  ];
  const sql = deriveRemedialFormatRecommendation(records, { topicId: "sql-normalization" });
  assert.equal(sql.preferredFormat, "visual");
  const indexing = deriveRemedialFormatRecommendation(records, { topicId: "indexing" });
  assert.equal(indexing.preferredFormat, "audio");
  const unknown = deriveRemedialFormatRecommendation(records, { topicId: "no-such-topic" });
  assert.equal(unknown.confidence, "none");
});

/* --------------------------- transparency / safety ------------------- */

test("perFormat exposes the raw counts behind the decision", () => {
  const out = deriveRemedialFormatRecommendation(visualRuns(5, 45));
  const visual = out.perFormat.find((f) => f.format === "visual")!;
  assert.equal(visual.observations, 5);
  assert.equal(visual.positiveObservations, 5);
  assert.equal(visual.averageObservedImprovement, 45);
  assert.equal(visual.evidenceState, "sufficient");
  assert.equal(out.totalObservations, 5);
});

test("never emits causal wording", () => {
  for (const k of [0, 1, 3, 5, 8]) {
    const out = deriveRemedialFormatRecommendation(visualRuns(k, 45));
    assert.doesNotMatch(out.reason, /caused|because of the format|makes you|will improve/i);
  }
});

test("pure: does not mutate the input array or its records", () => {
  const input = visualRuns(4, 30);
  const snapshot = JSON.stringify(input);
  deriveRemedialFormatRecommendation(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test("deterministic: same input => identical output", () => {
  const input = visualRuns(6, 25);
  assert.deepEqual(
    deriveRemedialFormatRecommendation(input),
    deriveRemedialFormatRecommendation(input),
  );
});

/* --------------------------- guardrails ------------------------------ */

const SRC = readFileSync(
  fileURLToPath(new URL("./remedial-adaptation.ts", import.meta.url)),
  "utf8",
);
const CODE = SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

test("R8.1 source: pure — no Supabase / React / API / writes", () => {
  assert.doesNotMatch(CODE, /@\/integrations\/supabase|from ["']react["']|useState|useEffect/i);
  assert.doesNotMatch(CODE, /fetch\(|gemini|generativelanguage|anthropic|openai|\.rpc\(/i);
  assert.doesNotMatch(CODE, /\binsert\(|\bupsert\(|\bupdate\(|supabase\./i);
});

test("R8.1 source: does not touch A7 / VARK / Mastery / grading / preferences", () => {
  assert.doesNotMatch(
    CODE,
    /adaptive-modality|vark-inference|vark-content-recommendation|learning-preferences|computeModuleMastery|grade_quiz|initial-modality/,
  );
});

test("R8.1 reuses R7's RemedialInterventionRecord type, does not redefine it", () => {
  assert.match(CODE, /type RemedialInterventionRecord[\s\S]*?from "@\/lib\/remedial-intelligence"/);
  assert.doesNotMatch(CODE, /(type|interface)\s+RemedialInterventionRecord\s*[=({]/);
});
