/**
 * R8.4 — Remedial Intelligence Evaluation: pure lecturer-facing aggregate over
 * R7 records + R8 history recommendations. Observational only, A8 evidence
 * philosophy, A8 privacy standard (no identifiers, no UUIDs), and structural
 * proof that A7 / R4 / the DB are untouched.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-intelligence-evaluation.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildRemedialIntelligenceEvaluation,
  REMEDIAL_EVALUATION_SOURCES,
  toRemedialInterventionRecords,
  VIDEO_EVIDENCE_MESSAGE,
} from "@/lib/remedial-intelligence-evaluation";
import type { RemedialInterventionRecord } from "@/lib/remedial-intelligence";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/* -------------------------------- helpers -------------------------------- */

let seq = 0;
const rec = (over: Partial<RemedialInterventionRecord>): RemedialInterventionRecord => ({
  studyPathId: `11111111-1111-1111-1111-${String(seq++).padStart(12, "0")}`,
  topicId: "22222222-2222-2222-2222-222222222222",
  baselineScore: 40,
  remedialFormatUsed: "visual",
  recommendedFormat: null,
  recommendationSource: null,
  meaningfulEngagement: true,
  subsequentQuizScore: 80,
  scoreDifference: 40,
  contentVersion: "2026-01-01T00:00:00Z",
  ...over,
});

const EVAL_BASE = {
  generatedAt: "2026-09-06T00:00:00.000Z",
  studyPathsWithRemedialContent: 0,
  studyPathsWithVideoRecommendation: 0,
  studentsWithHistoryRecommendation: 0,
  currentHistoryLeanings: [] as {
    confidence: "medium" | "high";
    format: "text" | "audio" | "visual";
  }[],
};

// A8's key regex — identifier-shaped KEYS. Value-level id/UUID leakage is
// caught separately by the UUID + fixture-string checks below.
const PII_KEY =
  /user_?id|\bstudypathid\b|\bstudy_path_id\b|attemptid|attempt_id|topicid|\btopic_id\b|email|full_?name|\bname\b|responses|token|secret|question|prompt|answer/i;

function assertNoPiiKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPiiKeys(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assert.ok(!PII_KEY.test(k), `PII-looking key "${k}" at ${path}`);
      assertNoPiiKeys(v, `${path}.${k}`);
    }
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/* ------------------------------ 1. empty state --------------------------- */

test("1. empty data returns a safe zero state (no fake conclusions)", () => {
  const out = buildRemedialIntelligenceEvaluation({ ...EVAL_BASE, records: [] });
  assert.equal(out.overview.studyPathsWithRemedialContent, 0);
  assert.equal(out.overview.meaningfulRemedialEngagements, 0);
  assert.equal(out.overview.linkedOfficialQuizOutcomes, 0);
  assert.equal(out.overview.historyRecommendations, 0);
  assert.equal(out.overview.evidenceState, "none");
  for (const s of out.recommendationSourcePerformance) {
    assert.equal(s.recommendationsIssued, 0);
    assert.equal(s.followRate, null);
    assert.equal(s.evidenceState, "none");
  }
  for (const f of out.formatEffectiveness) {
    assert.equal(f.interventions, 0);
    assert.equal(f.observedImprovement, null);
  }
  assert.equal(out.video.evidenceState, "unavailable");
  assert.ok(out.limitations.length >= 5);
  assert.ok(out.disclaimer.length > 0);
});

test("all five recommendation sources always appear, in priority order", () => {
  const out = buildRemedialIntelligenceEvaluation({ ...EVAL_BASE, records: [] });
  assert.deepEqual(
    out.recommendationSourcePerformance.map((s) => s.source),
    [...REMEDIAL_EVALUATION_SOURCES],
  );
  assert.deepEqual(
    [...REMEDIAL_EVALUATION_SOURCES],
    ["history", "adaptive", "vark", "preference", "default"],
  );
});

/* ---------------------- 4. history recommendations --------------------- */

test("4. history recommendations counted per (study path, content version) instance", () => {
  const records = [
    // one study-path-content, two format records, all history-sourced => 1 instance
    rec({
      studyPathId: "sp-1",
      contentVersion: "v1",
      recommendationSource: "history",
      recommendedFormat: "visual",
      remedialFormatUsed: "visual",
    }),
    rec({
      studyPathId: "sp-1",
      contentVersion: "v1",
      recommendationSource: "history",
      recommendedFormat: "visual",
      remedialFormatUsed: "text",
      meaningfulEngagement: false,
    }),
    // a second study path, history => instance 2
    rec({
      studyPathId: "sp-2",
      contentVersion: "v1",
      recommendationSource: "history",
      recommendedFormat: "audio",
      remedialFormatUsed: "audio",
    }),
    // adaptive-sourced => not a history instance
    rec({ studyPathId: "sp-3", recommendationSource: "adaptive", recommendedFormat: "text" }),
  ];
  const out = buildRemedialIntelligenceEvaluation({
    ...EVAL_BASE,
    records,
    studentsWithHistoryRecommendation: 2,
  });
  assert.equal(out.overview.historyRecommendations, 2);
  assert.equal(out.historyLearning.recommendationCount, 2);
  assert.equal(out.historyLearning.studentsWithHistoryRecommendation, 2);
  assert.deepEqual(out.historyLearning.formatsRecommended, [
    { format: "audio", count: 1 },
    { format: "visual", count: 1 },
  ]);
});

test("D. current confidence + preferred-format distribution from server leanings", () => {
  const out = buildRemedialIntelligenceEvaluation({
    ...EVAL_BASE,
    records: [],
    currentHistoryLeanings: [
      { confidence: "high", format: "visual" },
      { confidence: "high", format: "visual" },
      { confidence: "medium", format: "audio" },
    ],
  });
  assert.equal(out.historyLearning.currentlyEligibleStudents, 3);
  assert.deepEqual(out.historyLearning.currentConfidenceDistribution, { medium: 1, high: 2 });
  assert.deepEqual(
    out.historyLearning.currentPreferredFormats,
    [
      { format: "audio", count: 1 },
      { format: "visual", count: 2 },
    ].sort((a, b) => b.count - a.count),
  );
});

test("D. outcomes after history recommendations are observed, evidence-gated", () => {
  const records = Array.from({ length: 6 }, (_, i) =>
    rec({
      studyPathId: `sp-${i}`,
      recommendationSource: "history",
      recommendedFormat: "visual",
      baselineScore: 40,
      subsequentQuizScore: 70,
      scoreDifference: 30,
    }),
  );
  const out = buildRemedialIntelligenceEvaluation({ ...EVAL_BASE, records });
  const o = out.historyLearning.outcomesAfterHistoryRecommendations;
  assert.equal(o.observationsWithOutcome, 6);
  assert.equal(o.averageBaselineScore, 40);
  assert.equal(o.averageSubsequentScore, 70);
  assert.equal(o.observedImprovement, 30);
  assert.equal(o.evidenceState, "sufficient");
});

/* ---------------------- 5. follow rate calculation -------------------- */

test("5. follow rate = followed / issued, per source; followed needs meaningful engagement", () => {
  const records = [
    // history: recommended visual, engaged visual => followed
    rec({
      studyPathId: "a",
      recommendationSource: "history",
      recommendedFormat: "visual",
      remedialFormatUsed: "visual",
      meaningfulEngagement: true,
    }),
    // history: recommended visual, only SELECTED visual (no engagement) => not followed
    rec({
      studyPathId: "b",
      recommendationSource: "history",
      recommendedFormat: "visual",
      remedialFormatUsed: "visual",
      meaningfulEngagement: false,
    }),
    // history: recommended audio, switched to text => not followed
    rec({
      studyPathId: "c",
      recommendationSource: "history",
      recommendedFormat: "audio",
      remedialFormatUsed: "text",
      meaningfulEngagement: true,
    }),
  ];
  const out = buildRemedialIntelligenceEvaluation({ ...EVAL_BASE, records });
  const history = out.recommendationSourcePerformance.find((s) => s.source === "history")!;
  assert.equal(history.recommendationsIssued, 3);
  assert.equal(history.recommendationsFollowed, 1);
  assert.ok(Math.abs((history.followRate ?? 0) - 1 / 3) < 1e-9);
});

/* -------------------- 6. format effectiveness calc ------------------- */

test("6. format effectiveness: baseline / after / observed improvement per format", () => {
  const records = [
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
      meaningfulEngagement: false,
      subsequentQuizScore: null,
      scoreDifference: null,
    }),
  ];
  const out = buildRemedialIntelligenceEvaluation({ ...EVAL_BASE, records });
  const text = out.formatEffectiveness.find((f) => f.format === "text")!;
  assert.equal(text.interventions, 2);
  assert.equal(text.meaningfulEngagements, 2);
  assert.equal(text.linkedQuizOutcomes, 2);
  assert.equal(text.averageBaselineScore, 45);
  assert.equal(text.averageSubsequentScore, 70);
  assert.equal(text.observedImprovement, 25);
  const audio = out.formatEffectiveness.find((f) => f.format === "audio")!;
  assert.equal(audio.meaningfulEngagements, 0);
  assert.equal(audio.observedImprovement, null);
});

/* ------------------- 7. low sample -> insufficient ------------------- */

test("7. low sample sizes report 'insufficient', >=5 report 'sufficient'", () => {
  const few = buildRemedialIntelligenceEvaluation({
    ...EVAL_BASE,
    records: Array.from({ length: 3 }, () => rec({ remedialFormatUsed: "visual" })),
  });
  assert.equal(
    few.formatEffectiveness.find((f) => f.format === "visual")!.evidenceState,
    "insufficient",
  );
  assert.equal(few.overview.evidenceState, "insufficient");

  const many = buildRemedialIntelligenceEvaluation({
    ...EVAL_BASE,
    records: Array.from({ length: 5 }, () => rec({ remedialFormatUsed: "visual" })),
  });
  assert.equal(
    many.formatEffectiveness.find((f) => f.format === "visual")!.evidenceState,
    "sufficient",
  );
});

/* ----------------- 8. video stays unavailable ---------------------- */

test("8. video is 'unavailable' and never estimated, even with stray video records", () => {
  const out = buildRemedialIntelligenceEvaluation({
    ...EVAL_BASE,
    studyPathsWithVideoRecommendation: 12,
    records: Array.from({ length: 9 }, () =>
      rec({ remedialFormatUsed: "video" as never, subsequentQuizScore: 99, scoreDifference: 59 }),
    ),
  });
  const video = out.formatEffectiveness.find((f) => f.format === "video")!;
  assert.equal(video.evidenceState, "unavailable");
  assert.equal(video.interventions, 0);
  assert.equal(video.observedImprovement, null);
  assert.equal(out.video.evidenceState, "unavailable");
  assert.equal(out.video.recommendationsPresent, 12);
  assert.equal(out.video.message, VIDEO_EVIDENCE_MESSAGE);
  assert.match(out.video.message, /not currently measured/);
});

/* -------------------- 9. no causal wording ------------------------- */

test("9. no causal wording anywhere in the output", () => {
  const out = buildRemedialIntelligenceEvaluation({
    ...EVAL_BASE,
    records: Array.from({ length: 6 }, () => rec({ recommendationSource: "history" })),
    studentsWithHistoryRecommendation: 3,
    currentHistoryLeanings: [{ confidence: "high", format: "visual" }],
  });
  const json = JSON.stringify(out);
  assert.doesNotMatch(
    json,
    /remediation improved|improved (their )?scores|caused (an? )?improvement|because of the format|proves|guarantee/i,
  );
  assert.equal(out.observedImprovementLabel, "Observed improvement after remediation");
  assert.match(out.disclaimer, /Observational only/);
});

/* ----------- 3 / 12 / 13. no identifiers / UUIDs / PII ------------- */

test("3/12/13. evaluation output carries no identifiers, UUIDs, or PII", () => {
  const records = [
    rec({
      studyPathId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      topicId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      contentVersion: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      recommendationSource: "history",
      recommendedFormat: "visual",
    }),
    rec({
      recommendationSource: "adaptive",
      recommendedFormat: "text",
      remedialFormatUsed: "text",
    }),
  ];
  const out = buildRemedialIntelligenceEvaluation({
    ...EVAL_BASE,
    records,
    studyPathsWithRemedialContent: 9,
    studentsWithHistoryRecommendation: 4,
    currentHistoryLeanings: [{ confidence: "medium", format: "audio" }],
  });
  assertNoPiiKeys(out);
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, UUID, "a UUID leaked into the evaluation output");
  assert.doesNotMatch(json, /aaaaaaaa|bbbbbbbb|cccccccc/);
  // no per-student array of any kind
  assert.doesNotMatch(json, /"students":\s*\[/);
});

/* ------------------- toRemedialInterventionRecords ------------------ */

test("toRemedialInterventionRecords: raw rows -> R7 records via the sufficiency bar", () => {
  const records = toRemedialInterventionRecords({
    studyPaths: [{ id: "sp1", topicId: "t1", attemptId: "att-base" }],
    moduleAttempts: [
      // baseline: sufficient (>=3 answered, >=50% coverage), 40%
      {
        id: "att-base",
        topic_id: "t1",
        score: 4,
        total: 10,
        finished_at: "2026-01-01T00:00:00Z",
        answered_count: 10,
        started_at: "2026-01-01T00:00:00Z",
      },
      // retake: sufficient, 80%, later
      {
        id: "att-next",
        topic_id: "t1",
        score: 8,
        total: 10,
        finished_at: "2026-02-01T00:00:00Z",
        answered_count: 10,
        started_at: "2026-02-01T00:00:00Z",
      },
      // a partial attempt that must be IGNORED (1/10 answered)
      {
        id: "att-partial",
        topic_id: "t1",
        score: 1,
        total: 10,
        finished_at: "2026-03-01T00:00:00Z",
        answered_count: 1,
        started_at: "2026-03-01T00:00:00Z",
      },
    ],
    interactions: [
      {
        studyPathId: "sp1",
        eventType: "remedial_meaningful_engagement",
        remedialFormat: "visual",
        recommendedFormat: "visual",
        recommendationSource: "history",
        contentVersion: "2026-01-10T00:00:00Z",
        createdAt: "2026-01-10T00:00:00Z",
      },
      // junk rows that must be dropped
      {
        studyPathId: null,
        eventType: "remedial_format_selected",
        remedialFormat: "text",
        recommendedFormat: null,
        recommendationSource: null,
        contentVersion: null,
        createdAt: "2026-01-11T00:00:00Z",
      },
      {
        studyPathId: "sp1",
        eventType: "lesson_opened",
        remedialFormat: "text",
        recommendedFormat: null,
        recommendationSource: null,
        contentVersion: null,
        createdAt: "2026-01-12T00:00:00Z",
      },
    ],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].remedialFormatUsed, "visual");
  assert.equal(records[0].meaningfulEngagement, true);
  assert.equal(records[0].baselineScore, 40);
  assert.equal(records[0].subsequentQuizScore, 80);
  assert.equal(records[0].scoreDifference, 40);
  assert.equal(records[0].recommendationSource, "history");
});

/* --------------- 2 / 10 / 11. structural: scope + no A7/R4 touch ------ */

const fnSrc = read("./remedial-intelligence-evaluation.functions.ts");
const libSrc = read("./remedial-intelligence-evaluation.ts");

test("2. server feed scopes every read to the lecturer's course (students + topics)", () => {
  assert.match(fnSrc, /\.rpc\("current_lecturer_course"\)/);
  assert.match(fnSrc, /if \(!lecturerCourseId\) throw new Error\("NOT_A_LECTURER"\)/);
  // every service-role read is filtered to enrolled students AND course topics
  assert.match(
    fnSrc,
    /\.from\("study_paths"\)[\s\S]{0,220}\.in\("user_id", studentIds\)[\s\S]{0,80}\.in\("topic_id", courseTopicIds\)/,
  );
  assert.match(
    fnSrc,
    /\.from\("quiz_attempts"\)[\s\S]{0,220}\.in\("user_id", studentIds\)[\s\S]{0,80}\.in\("topic_id", courseTopicIds\)/,
  );
  assert.match(
    fnSrc,
    /\.from\("learning_interactions"\)[\s\S]{0,260}\.in\("user_id", studentIds\)[\s\S]{0,120}\.in\("topic_id", courseTopicIds\)/,
  );
  // belt-and-braces re-scope on the pure side after supabaseAdmin
  assert.match(fnSrc, /students\.has\(p\.user_id\)[\s\S]{0,60}topics\.has\(p\.topic_id\)/);
});

test("10. R8.4 does not read, import, or modify A7 / VARK / Mastery / grading", () => {
  for (const src of [fnSrc, libSrc]) {
    assert.doesNotMatch(
      src,
      /adaptive-modality|vark-inference|vark-content-recommendation|computeModuleMastery|grade_quiz|initial-modality/,
    );
  }
  const a7 = read("./adaptive-modality.ts");
  const a7fn = read("./adaptive-modality.functions.ts");
  for (const src of [a7, a7fn]) {
    assert.doesNotMatch(src, /remedial-intelligence-evaluation/);
  }
});

test("11. R8.4 writes nothing and does not touch R4 tracking", () => {
  for (const src of [fnSrc, libSrc]) {
    assert.doesNotMatch(
      src,
      /\.(insert|update|upsert|delete)\(|\.rpc\("(?!current_lecturer_course)/,
    );
  }
  // no migration shipped for this phase
  assert.doesNotMatch(libSrc, /alter table|create table/i);
  const tracking = read("./remedial-tracking.ts");
  assert.doesNotMatch(tracking, /remedial-intelligence-evaluation/);
});

test("lib is pure — no React / Supabase / API / writes", () => {
  const code = libSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  assert.doesNotMatch(
    code,
    /@\/integrations\/supabase|from ["']react["']|useState|useEffect|createServerFn/i,
  );
  assert.doesNotMatch(code, /fetch\(|gemini|generativelanguage|anthropic|openai|\.rpc\(/i);
});
