/**
 * Phase A8 — evaluation-layer tests. Pure functions via Node's runner + the
 * alias loader, plus structural checks on the server function and route.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/model-evaluation.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  aggregateAdaptation,
  aggregateVarkUsage,
  buildDefenseSummary,
  classifyEvidenceState,
  effectiveVarkCategoryByUser,
  getOfflineModelEvaluation,
  linkModalityOutcomes,
  scopeEvaluationInputs,
  DEPLOYED_VARK_MODEL_VERSION,
  EVALUATION_NOTES,
  OUTCOME_ASSOCIATION_MIN_SAMPLES,
  type InteractionEvalRow,
  type VarkProfileEvalRow,
} from "@/lib/model-evaluation";
import type { LessonModality } from "@/lib/lesson-shared";
import type { VarkCategory } from "@/lib/vark";

const artifact = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../ml/vark/service/model/model_metadata.json", import.meta.url)),
    "utf8",
  ),
);

/* ---------------- PART A: offline metrics ---------------- */

test("1. offline evaluation data matches the committed training artifact", () => {
  const o = getOfflineModelEvaluation();
  assert.equal(o.modelVersion, artifact.model_version);
  assert.equal(o.deployedModelType, artifact.model_type);
  assert.equal(o.winner, artifact.winner);
  assert.deepEqual([...o.featureNames], artifact.feature_names);
  assert.equal(o.trainingDataSource, artifact.dataset_type);
  assert.equal(o.deploymentStatus, artifact.deployment_status);
  for (const [key, src] of [
    ["randomForest", artifact.models_compared.random_forest],
    ["gradientBoosting", artifact.models_compared.gradient_boosting],
  ] as const) {
    const m = o.models[key];
    assert.equal(m.accuracy, src.accuracy);
    assert.equal(m.macroPrecision, src.macro_precision);
    assert.equal(m.macroRecall, src.macro_recall);
    assert.equal(m.macroF1, src.macro_f1);
    assert.equal(m.cvAccuracyMean, src.cross_validation.accuracy_mean);
    assert.equal(m.cvAccuracyStd, src.cross_validation.accuracy_std);
    assert.equal(m.cvMacroF1Mean, src.cross_validation.macro_f1_mean);
    assert.equal(m.cvMacroF1Std, src.cross_validation.macro_f1_std);
  }
  assert.deepEqual([...o.limitations], artifact.limitations);
});

test("2. synthetic-training disclaimer is always present", () => {
  const o = getOfflineModelEvaluation();
  assert.match(o.syntheticDisclaimer, /SYNTHETIC/);
  assert.equal(o.syntheticDisclaimer, artifact.limitations[0]);
  // and it flows through into the exported defense summary
  const summary = buildDefenseSummary({
    generatedAt: "2026-09-05T00:00:00.000Z",
    vark: aggregateVarkUsage([]),
    adaptation: emptyAdaptation(),
  });
  assert.match(summary.deployedModel.syntheticDisclaimer, /SYNTHETIC/);
  assert.ok(EVALUATION_NOTES.some((n) => /synthetic/i.test(n)));
  assert.ok(EVALUATION_NOTES.some((n) => /not deep RL|not.*Q-learning/i.test(n)));
});

test("3. deployed model version is correct", () => {
  assert.equal(DEPLOYED_VARK_MODEL_VERSION, "vark-assessment-a2.1-v1");
  assert.equal(getOfflineModelEvaluation().modelVersion, DEPLOYED_VARK_MODEL_VERSION);
  assert.equal(artifact.model_version, DEPLOYED_VARK_MODEL_VERSION);
});

/* ---------------- PART B: live VARK usage ---------------- */

function profile(over: Partial<VarkProfileEvalRow>): VarkProfileEvalRow {
  return {
    userId: `u${Math.random()}`,
    assessmentCompletedAt: "2026-09-01T00:00:00Z",
    mlPredictedCategory: null,
    mlPredictionConfidence: null,
    mlModelVersion: null,
    predictedCategory: null,
    ...over,
  };
}

test("4. ML coverage calculation", () => {
  const rows = [
    profile({ mlPredictedCategory: "visual", mlPredictionConfidence: 0.8, mlModelVersion: "v1" }),
    profile({
      mlPredictedCategory: "audio" as VarkCategory,
      mlPredictionConfidence: 0.4,
      mlModelVersion: "v1",
    }),
    profile({}), // completed, no ML
    profile({ assessmentCompletedAt: null }), // not completed — excluded from both
  ];
  const m = aggregateVarkUsage(rows);
  assert.equal(m.completedAssessments, 3);
  assert.equal(m.withMlPrediction, 2);
  assert.equal(m.mlCoveragePercent, 67); // 2/3
});

test("5. category distribution aggregation", () => {
  const rows = [
    profile({ mlPredictedCategory: "visual" }),
    profile({ mlPredictedCategory: "visual" }),
    profile({ mlPredictedCategory: "read_write" }),
    profile({ mlPredictedCategory: "not_a_category" }), // ignored
  ];
  const m = aggregateVarkUsage(rows);
  assert.deepEqual(m.mlCategoryDistribution, {
    visual: 2,
    auditory: 0,
    read_write: 1,
    kinesthetic: 0,
  });
});

test("6. average confidence calculation (rounded %, null when none)", () => {
  const m = aggregateVarkUsage([
    profile({ mlPredictedCategory: "visual", mlPredictionConfidence: 0.9, mlModelVersion: "v1" }),
    profile({ mlPredictedCategory: "auditory", mlPredictionConfidence: 0.6, mlModelVersion: "v2" }),
  ]);
  assert.equal(m.averageMlConfidencePercent, 75);
  assert.deepEqual(m.modelVersionsObserved, ["v1", "v2"]);
  assert.equal(aggregateVarkUsage([profile({})]).averageMlConfidencePercent, null);
});

/* ---------------- PART C: A7 adaptation ---------------- */

const T_VARK_CONFIRMED = "topic-vc";
const T_OVERRIDE = "topic-ov";

function eng(
  userId: string,
  topicId: string,
  modality: LessonModality,
  at: string,
): InteractionEvalRow {
  return {
    userId,
    topicId,
    eventType: "meaningful_engagement",
    modality,
    recommendationSource: "vark",
    scorePercent: null,
    createdAt: at,
  };
}
function outcome(userId: string, topicId: string, pct: number, at: string): InteractionEvalRow {
  return {
    userId,
    topicId,
    eventType: "official_quiz_completed",
    modality: null,
    recommendationSource: null,
    scorePercent: pct,
    createdAt: at,
  };
}

// A student who meaningfully studied TEXT before two strong outcomes.
function textStudyUnit(userId: string, topicId: string): InteractionEvalRow[] {
  return [
    eng(userId, topicId, "text", "2026-01-01T00:00:00Z"),
    outcome(userId, topicId, 85, "2026-01-01T01:00:00Z"),
    eng(userId, topicId, "text", "2026-01-02T00:00:00Z"),
    outcome(userId, topicId, 90, "2026-01-02T01:00:00Z"),
  ];
}

const topicModalities = new Map<string, LessonModality[]>([
  [T_VARK_CONFIRMED, ["text", "video", "audio"]],
  [T_OVERRIDE, ["text", "video", "audio"]],
]);

function emptyAdaptation() {
  return aggregateAdaptation({
    interactions: [],
    topicModalities: new Map(),
    effectiveVarkCategoryByUser: new Map(),
  });
}

test("7. adaptive override-rate calculation", () => {
  // read_write student on T_VARK_CONFIRMED -> text winner == vark -> vark_confirmed
  // visual student on T_OVERRIDE -> text winner != video (vark) -> adaptive_override
  const interactions = [
    ...textStudyUnit("stu-rw", T_VARK_CONFIRMED),
    ...textStudyUnit("stu-vis", T_OVERRIDE),
  ];
  const cats = new Map<string, VarkCategory | null>([
    ["stu-rw", "read_write"],
    ["stu-vis", "visual"],
  ]);
  const m = aggregateAdaptation({
    interactions,
    topicModalities,
    effectiveVarkCategoryByUser: cats,
  });
  assert.equal(m.adaptationUnits, 2);
  assert.equal(m.evaluableUnits, 2);
  assert.equal(m.reconstruction.reasonCodeCounts.vark_confirmed, 1);
  assert.equal(m.reconstruction.reasonCodeCounts.adaptive_override, 1);
  assert.equal(m.reconstruction.adaptiveOverrideCount, 1);
  assert.equal(m.reconstruction.varkFallbackCount, 1);
  assert.equal(m.reconstruction.adaptiveOverrideRatePercent, 50); // 1 / 2 evaluable
});

test("8. zero-data state does not throw and returns safe nulls", () => {
  const vark = aggregateVarkUsage([]);
  assert.equal(vark.completedAssessments, 0);
  assert.equal(vark.mlCoveragePercent, null);
  assert.equal(vark.averageMlConfidencePercent, null);
  assert.deepEqual(vark.modelVersionsObserved, []);

  const a = emptyAdaptation();
  assert.equal(a.adaptationUnits, 0);
  assert.equal(a.evaluableUnits, 0);
  assert.equal(a.reconstruction.adaptiveOverrideRatePercent, null);
  assert.ok(a.outcomeAssociationByModality.every((x) => x.evidenceState === "none"));

  const summary = buildDefenseSummary({ generatedAt: "2026-09-05T00:00:00Z", vark, adaptation: a });
  assert.equal(summary.live.adaptation.adaptationUnits, 0);
});

test("9. low-sample / insufficient-evidence state is flagged with its count", () => {
  assert.equal(classifyEvidenceState(0, 5), "none");
  assert.equal(classifyEvidenceState(3, 5), "insufficient");
  assert.equal(classifyEvidenceState(5, 5), "sufficient");

  // one linked text outcome -> below OUTCOME_ASSOCIATION_MIN_SAMPLES
  const m = aggregateAdaptation({
    interactions: [
      eng("s1", T_OVERRIDE, "text", "2026-01-01T00:00:00Z"),
      outcome("s1", T_OVERRIDE, 70, "2026-01-01T01:00:00Z"),
    ],
    topicModalities,
    effectiveVarkCategoryByUser: new Map([["s1", "visual"]]),
  });
  const text = m.outcomeAssociationByModality.find((x) => x.modality === "text")!;
  assert.equal(text.linkedOutcomeCount, 1);
  assert.equal(text.averageScorePercent, 70);
  assert.equal(text.evidenceState, "insufficient");
  assert.ok(OUTCOME_ASSOCIATION_MIN_SAMPLES > 1);
});

test("10. per-modality linked-outcome aggregation windows correctly", () => {
  // window 1 (before outcome@t2): text  -> 40%
  // window 2 (t2..t4): audio           -> 90%
  const links = linkModalityOutcomes(
    [
      { score_percent: 40, created_at: "2026-01-02T00:00:00Z" },
      { score_percent: 90, created_at: "2026-01-04T00:00:00Z" },
    ],
    [
      { modality: "text", created_at: "2026-01-01T00:00:00Z" },
      { modality: "audio", created_at: "2026-01-03T00:00:00Z" },
    ],
  );
  assert.deepEqual(links, [
    { modality: "text", scorePercent: 40 },
    { modality: "audio", scorePercent: 90 },
  ]);

  const m = aggregateAdaptation({
    interactions: [
      eng("s1", T_OVERRIDE, "text", "2026-01-01T00:00:00Z"),
      outcome("s1", T_OVERRIDE, 40, "2026-01-02T00:00:00Z"),
      eng("s1", T_OVERRIDE, "audio", "2026-01-03T00:00:00Z"),
      outcome("s1", T_OVERRIDE, 90, "2026-01-04T00:00:00Z"),
    ],
    topicModalities,
    effectiveVarkCategoryByUser: new Map([["s1", "visual"]]),
  });
  const byMod = Object.fromEntries(m.outcomeAssociationByModality.map((x) => [x.modality, x]));
  assert.equal(byMod.text.linkedOutcomeCount, 1);
  assert.equal(byMod.text.averageScorePercent, 40);
  assert.equal(byMod.audio.linkedOutcomeCount, 1);
  assert.equal(byMod.audio.averageScorePercent, 90);
  assert.equal(byMod.video.linkedOutcomeCount, 0);
  assert.equal(byMod.video.averageScorePercent, null);
});

test("12. reasonCode aggregation is reconstructable from interaction data", () => {
  const interactions = [
    // no_evidence: engagement but no outcome
    eng("a", "t1", "text", "2026-01-01T00:00:00Z"),
    // insufficient_evidence: exactly one linked outcome
    eng("b", "t2", "text", "2026-01-01T00:00:00Z"),
    outcome("b", "t2", 80, "2026-01-01T01:00:00Z"),
    // vark_confirmed: two linked text outcomes, read_write student
    ...textStudyUnit("c", T_VARK_CONFIRMED),
  ];
  const m = aggregateAdaptation({
    interactions,
    topicModalities: new Map([
      ["t1", ["text", "video"]],
      ["t2", ["text", "video"]],
      [T_VARK_CONFIRMED, ["text", "video", "audio"]],
    ]),
    effectiveVarkCategoryByUser: new Map<string, VarkCategory | null>([
      ["a", "read_write"],
      ["b", "read_write"],
      ["c", "read_write"],
    ]),
  });
  assert.equal(m.reconstruction.reasonCodeCounts.no_evidence, 1);
  assert.equal(m.reconstruction.reasonCodeCounts.insufficient_evidence, 1);
  assert.equal(m.reconstruction.reasonCodeCounts.vark_confirmed, 1);
  assert.equal(m.adaptationUnits, 3);
  assert.equal(m.evaluableUnits, 1);
  // total reconstructed decisions == adaptationUnits
  const total = Object.values(m.reconstruction.reasonCodeCounts).reduce((x, y) => x + y, 0);
  assert.equal(total, 3);
});

test("logged recommendation_source counts come straight from persisted rows", () => {
  const m = aggregateAdaptation({
    interactions: [
      { ...eng("s", "t", "text", "2026-01-01T00:00:00Z"), recommendationSource: "adaptive" },
      { ...eng("s", "t", "audio", "2026-01-02T00:00:00Z"), recommendationSource: "vark" },
      { ...eng("s", "t", "video", "2026-01-03T00:00:00Z"), recommendationSource: null },
    ],
    topicModalities,
    effectiveVarkCategoryByUser: new Map(),
  });
  assert.deepEqual(m.reconstruction ? m.loggedRecommendationSourceCounts : null, {
    vark: 1,
    adaptive: 1,
  });
});

/* ---------------- PART E: export summary / no PII ---------------- */

const PII_KEY = /user_?id|email|full_?name|\bname\b|responses|token|secret|question|prompt|answer/i;

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

function fullSummary() {
  const vark = aggregateVarkUsage([
    profile({
      userId: "u1",
      mlPredictedCategory: "visual",
      mlPredictionConfidence: 0.7,
      mlModelVersion: "vark-assessment-a2.1-v1",
    }),
  ]);
  const adaptation = aggregateAdaptation({
    interactions: textStudyUnit("u1", T_VARK_CONFIRMED),
    topicModalities,
    effectiveVarkCategoryByUser: new Map([["u1", "read_write"]]),
  });
  return buildDefenseSummary({ generatedAt: "2026-09-05T12:00:00.000Z", vark, adaptation });
}

test("11. no PII fields anywhere in the exported summary", () => {
  assertNoPiiKeys(fullSummary());
});

test("13. export summary contains no student-level rows", () => {
  const s = fullSummary();
  const json = JSON.stringify(s);
  // no UUIDs (student/topic ids) leak into the payload
  assert.doesNotMatch(json, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  // fixture user id must not appear
  assert.doesNotMatch(json, /u1|stu-rw|stu-vis/);
  assert.equal(typeof s.generatedAt, "string");
  assert.ok("offline" in s && "live" in s && "evaluationNotes" in s);
});

test("effectiveVarkCategoryByUser prefers ML then questionnaire", () => {
  const m = effectiveVarkCategoryByUser([
    profile({ userId: "x", mlPredictedCategory: "visual", predictedCategory: "audio" }),
    profile({ userId: "y", mlPredictedCategory: null, predictedCategory: "read_write" }),
    profile({ userId: "z", mlPredictedCategory: null, predictedCategory: null }),
  ]);
  assert.equal(m.get("x"), "visual");
  assert.equal(m.get("y"), "read_write");
  assert.equal(m.get("z"), null);
});

/* ---------------- CHECK 1: course scoping / service-role safety ---------------- */

test("course scoping: lecturer A's aggregation excludes lecturer B's course data", () => {
  const aStudents = ["a1", "a2"];
  const aTopics = [T_VARK_CONFIRMED, T_OVERRIDE];
  const varkRows = [
    profile({ userId: "a1", mlPredictedCategory: "visual" }),
    profile({ userId: "b1", mlPredictedCategory: "auditory" }), // lecturer B's student
  ];
  const interactionRows = [
    ...textStudyUnit("a1", T_VARK_CONFIRMED), // A student + A topic  -> kept
    ...textStudyUnit("b1", "topic-b"), // B student + B topic  -> dropped
    eng("a2", "topic-b", "text", "2026-01-01T00:00:00Z"), // A student, B topic -> dropped
  ];
  const scoped = scopeEvaluationInputs({
    studentIds: aStudents,
    courseTopicIds: aTopics,
    varkRows,
    interactionRows,
  });
  assert.deepEqual(
    scoped.varkRows.map((r) => r.userId),
    ["a1"],
  );
  assert.equal(scoped.interactionRows.length, 4); // only a1 / T_VARK_CONFIRMED's rows
  assert.ok(scoped.interactionRows.every((r) => r.userId === "a1" && aTopics.includes(r.topicId!)));

  // and the aggregates built from the scoped rows carry only A's data
  const vark = aggregateVarkUsage(scoped.varkRows);
  assert.equal(vark.completedAssessments, 1);
  assert.deepEqual(vark.mlCategoryDistribution, {
    visual: 1,
    auditory: 0,
    read_write: 0,
    kinesthetic: 0,
  });
});

test("course scoping: global vark_profiles are not aggregated when the student set is applied", () => {
  const global = [profile({ userId: "x" }), profile({ userId: "y" }), profile({ userId: "z" })];
  const scoped = scopeEvaluationInputs({
    studentIds: ["y"],
    courseTopicIds: ["t"],
    varkRows: global,
    interactionRows: [],
  });
  assert.equal(scoped.varkRows.length, 1);
  assert.equal(aggregateVarkUsage(scoped.varkRows).completedAssessments, 1);
  // empty scope -> nothing survives
  assert.equal(
    scopeEvaluationInputs({
      studentIds: [],
      courseTopicIds: [],
      varkRows: global,
      interactionRows: [],
    }).varkRows.length,
    0,
  );
});

test("course scoping: the scoped path still exports zero student identifiers", () => {
  const scoped = scopeEvaluationInputs({
    studentIds: ["a1"],
    courseTopicIds: [T_VARK_CONFIRMED],
    varkRows: [
      profile({
        userId: "a1",
        mlPredictedCategory: "visual",
        mlPredictionConfidence: 0.7,
        mlModelVersion: "vark-assessment-a2.1-v1",
      }),
    ],
    interactionRows: textStudyUnit("a1", T_VARK_CONFIRMED),
  });
  const s = buildDefenseSummary({
    generatedAt: "2026-09-05T00:00:00.000Z",
    vark: aggregateVarkUsage(scoped.varkRows),
    adaptation: aggregateAdaptation({
      interactions: scoped.interactionRows,
      topicModalities,
      effectiveVarkCategoryByUser: effectiveVarkCategoryByUser(scoped.varkRows),
    }),
  });
  assertNoPiiKeys(s);
  assert.doesNotMatch(JSON.stringify(s), /\ba1\b|topic-vc|topic-ov/);
});

/* ---------------- CHECK 2: 8-feature experiment reproducibility ---------------- */

test("8-feature historical experiment loads from a committed file (no gitignored artifact)", () => {
  const exp = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../ml/vark/experiments/behavioral-8feature-experiment.json", import.meta.url),
      ),
      "utf8",
    ),
  );
  const p = getOfflineModelEvaluation().priorExperiment8Feature;
  assert.ok(p, "priorExperiment8Feature is always present now");
  assert.equal(p.modelVersion, exp.modelVersion);
  assert.equal(p.deploymentStatus, "experimental_not_deployable");
  assert.equal(p.datasetType, "synthetic");
  assert.equal(p.isDeployedModel, false);
  assert.deepEqual(p.randomForest, exp.models.randomForest);
  assert.deepEqual(p.gradientBoosting, exp.models.gradientBoosting);
  assert.deepEqual([...p.featureNames], exp.featureNames);
  assert.equal(p.featureNames.length, 8);
  // clearly NOT the deployed model
  assert.notEqual(p.modelVersion, getOfflineModelEvaluation().modelVersion);
  assert.equal(exp._label.is_deployed_model, false);
  assert.match(exp._label.experiment, /behavioral 8-feature/i);
  assert.equal(exp._label.dataset, "synthetic");
  assert.equal(exp._label.deployment_status, "experimental_not_deployable");
});

/* ---------------- structural: server fn + route ---------------- */

const fnSrc = readFileSync(
  fileURLToPath(new URL("./model-evaluation.functions.ts", import.meta.url)),
  "utf8",
);
const routeSrc = readFileSync(
  fileURLToPath(new URL("../routes/lecturer.evaluation.tsx", import.meta.url)),
  "utf8",
);

test("server fn is lecturer-gated and returns only the aggregate summary", () => {
  assert.match(fnSrc, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(fnSrc, /current_lecturer_course/);
  assert.match(fnSrc, /NOT_A_LECTURER/);
  assert.match(fnSrc, /Promise<DefenseSummary>/);
  // the DB column projections never pull identifying / free-text fields
  const selects = fnSrc.match(/\.select\(\s*["'][^"']*["']/g) ?? [];
  assert.ok(selects.length >= 3);
  for (const s of selects) {
    assert.doesNotMatch(s, /full_name|email|responses|\bprompt\b|body_md|question/);
  }
});

test("server fn scopes every service-role read to the lecturer's course", () => {
  // scope sets resolved from trusted server-side data
  assert.match(
    fnSrc,
    /from\("enrollments"\)\s*\.select\("user_id"\)\s*\.eq\("course_id", lecturerCourseId\)/,
  );
  assert.match(
    fnSrc,
    /from\("topics"\)\s*\.select\("id"\)\s*\.eq\("course_id", lecturerCourseId\)/,
  );
  // every admin read below is filtered by those sets
  assert.match(fnSrc, /from\("vark_profiles"\)[\s\S]*?\.in\("user_id", studentIds\)/);
  assert.match(
    fnSrc,
    /from\("learning_interactions"\)[\s\S]*?\.in\("user_id", studentIds\)[\s\S]*?\.in\("topic_id", courseTopicIds\)/,
  );
  assert.match(fnSrc, /from\("lessons"\)[\s\S]*?\.in\("topic_id", courseTopicIds\)/);
  // pure re-scope before aggregation (supabaseAdmin bypasses RLS)
  assert.match(fnSrc, /scopeEvaluationInputs\(\{/);
  assert.match(fnSrc, /aggregateVarkUsage\(scoped\.varkRows\)/);
  assert.match(fnSrc, /interactions: scoped\.interactionRows/);
  assert.match(fnSrc, /effectiveVarkCategoryByUser\(scoped\.varkRows\)/);
});

test("route shows the synthetic disclaimer and never renders a user id", () => {
  assert.match(routeSrc, /[Ss]ynthetic/);
  assert.match(routeSrc, /getModelEvaluation/);
  assert.doesNotMatch(routeSrc, /user_id|\.userId|full_name|email/);
});
