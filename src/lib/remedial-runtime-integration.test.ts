/**
 * R8.3 — runtime integration of the R8 personal remedial-history engine into
 * the Study Path remedial recommendation, plus the 'history'
 * recommendation-source migration.
 *
 * Two kinds of check:
 *   1. an end-to-end PURE pipeline test — raw-shaped rows -> R7 records ->
 *      R8.1 engine -> R8.2 resolver — the exact composition the server fn now
 *      runs, minus the DB.
 *   2. structural asserts on remedial.functions.ts / the migration / bootstrap
 *      / the A7 files (no live DB here).
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-runtime-integration.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildRemedialInterventionRecords,
  type RemedialInteractionRow,
} from "@/lib/remedial-intelligence";
import { deriveRemedialFormatRecommendation } from "@/lib/remedial-adaptation";
import { resolveRemedialRecommendation } from "@/lib/remedial-recommendation";
import type { OfficialModuleOutcome } from "@/lib/remedial-outcome-linking";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/* ============ 1. end-to-end pure pipeline (what the server fn runs) ======= */

/** k study paths on distinct topics: baseline 40 -> visual meaningful
 *  engagement -> +45 retake. */
function visualImprovementHistory(k: number) {
  const studyPaths = Array.from({ length: k }, (_, i) => ({
    id: `sp${i}`,
    topicId: `t${i}`,
    baselineScore: 40,
    hasRemedialVideoRecommendation: false,
  }));
  const remedialInteractions: RemedialInteractionRow[] = studyPaths.map((p) => ({
    studyPathId: p.id,
    eventType: "remedial_meaningful_engagement",
    format: "visual",
    recommendedFormat: null,
    recommendationSource: null,
    contentVersion: "v1",
    createdAt: "2026-01-02T00:00:00Z",
  }));
  const moduleOutcomes: OfficialModuleOutcome[] = studyPaths.map((p) => ({
    attemptId: `att-${p.id}`,
    topicId: p.topicId,
    scorePercent: 85,
    completedAt: "2026-01-10T00:00:00Z",
  }));
  return { studyPaths, remedialInteractions, moduleOutcomes };
}

test("pipeline: strong personal visual history overrides an A7 'audio' adaptive rec", () => {
  const records = buildRemedialInterventionRecords(visualImprovementHistory(6));
  const remedialAdaptation = deriveRemedialFormatRecommendation(records);
  assert.equal(remedialAdaptation.confidence, "high");
  assert.equal(remedialAdaptation.preferredFormat, "visual");

  const out = resolveRemedialRecommendation({
    remedialAdaptation,
    adaptiveRecommendation: { modality: "audio", source: "adaptive" },
    varkRecommendation: "text",
    preferredModality: "written",
    availableModalities: ["text", "audio", "visual"],
  });
  assert.equal(out.modality, "visual");
  assert.equal(out.source, "history");
  assert.equal(out.personalHistory.replacedSource, "adaptive");
});

test("pipeline: a student with no remedial history changes nothing (existing chain wins)", () => {
  const records = buildRemedialInterventionRecords({
    studyPaths: [],
    remedialInteractions: [],
    moduleOutcomes: [],
  });
  const remedialAdaptation = deriveRemedialFormatRecommendation(records);
  assert.equal(remedialAdaptation.confidence, "none");

  const out = resolveRemedialRecommendation({
    remedialAdaptation,
    adaptiveRecommendation: { modality: "audio", source: "adaptive" },
    varkRecommendation: null,
    preferredModality: null,
    availableModalities: ["text", "audio", "visual"],
  });
  assert.equal(out.source, "adaptive");
  assert.equal(out.modality, "audio");
  assert.equal(out.personalHistory.applied, false);
});

test("pipeline: 3 observations => low confidence => existing behaviour preserved", () => {
  const records = buildRemedialInterventionRecords(visualImprovementHistory(3));
  const remedialAdaptation = deriveRemedialFormatRecommendation(records);
  assert.equal(remedialAdaptation.confidence, "low");

  const out = resolveRemedialRecommendation({
    remedialAdaptation,
    adaptiveRecommendation: null,
    varkRecommendation: "text",
    preferredModality: null,
    availableModalities: ["text", "audio", "visual"],
  });
  assert.equal(out.source, "vark");
  assert.equal(out.modality, "text");
});

test("pipeline: interactions with no meaningful engagement never produce a history override", () => {
  const h = visualImprovementHistory(8);
  const records = buildRemedialInterventionRecords({
    ...h,
    remedialInteractions: h.remedialInteractions.map((r) => ({
      ...r,
      eventType: "remedial_format_selected" as const,
    })),
  });
  const remedialAdaptation = deriveRemedialFormatRecommendation(records);
  assert.equal(remedialAdaptation.confidence, "none");
  const out = resolveRemedialRecommendation({
    remedialAdaptation,
    adaptiveRecommendation: null,
    varkRecommendation: "audio",
    preferredModality: null,
    availableModalities: ["text", "audio", "visual"],
  });
  assert.equal(out.source, "vark");
});

/* ================== 2. migration + bootstrap: 'history' source ============= */

const migration = read(
  "../../supabase/migrations/20260915120000_remedial_history_recommendation_source.sql",
);
const bootstrap = read("../../supabase/bootstrap_new_project.sql");

test("migration widens the CHECK constraint to include 'history' (additive)", () => {
  assert.match(
    migration,
    /recommendation_source in \('vark', 'adaptive', 'preference', 'default', 'history'\)/,
  );
  // it only recreates the constraint + the one function — no new column, no
  // other table, no A7 / VARK / preferences / mastery / grading object
  assert.doesNotMatch(
    migration,
    /add column|alter table public\.(vark_profiles|learning_preferences|quiz_attempts|study_paths|vark_assessments)\b/i,
  );
  assert.doesNotMatch(migration, /grade_quiz|computeModuleMastery|adaptive_modality/i);
});

test("migration's log_remedial_interaction keeps every existing guard, adds 'history'", () => {
  const fn = migration.slice(migration.indexOf("function public.log_remedial_interaction"));
  const body = fn.slice(0, fn.indexOf("$$;") + 3);
  assert.match(body, /security definer/);
  assert.match(body, /role = 'student' and status = 'established'/);
  assert.match(body, /NOT_AN_ESTABLISHED_STUDENT/);
  assert.match(body, /v_sp\.user_id <> v_uid[\s\S]{0,40}STUDY_PATH_NOT_OWNED/);
  assert.match(body, /_remedial_format not in \('text', 'audio', 'visual'\)/);
  assert.match(
    body,
    /_recommendation_source not in \('vark', 'adaptive', 'preference', 'default', 'history'\)/,
  );
});

test("bootstrap carries the same widened constraint + function", () => {
  assert.match(
    bootstrap,
    /recommendation_source in \('vark', 'adaptive', 'preference', 'default', 'history'\)/,
  );
  const fn = bootstrap.slice(bootstrap.indexOf("function public.log_remedial_interaction"));
  const body = fn.slice(0, fn.indexOf("$$;") + 3);
  assert.match(
    body,
    /_recommendation_source not in \('vark', 'adaptive', 'preference', 'default', 'history'\)/,
  );
});

/* ===================== 3. server fn wiring (structural) ================== */

const fnSrc = read("./remedial.functions.ts");

test("remedial.functions.ts composes the R8 pipeline in the modality resolver", () => {
  const resolver = fnSrc.slice(
    fnSrc.indexOf("async function resolveRemedialModalityForStudyPath"),
    fnSrc.indexOf("async function loadOwnStudyPath"),
  );
  assert.match(resolver, /buildStudentRemedialHistory\(supabase, userId\)/);
  assert.match(resolver, /deriveRemedialFormatRecommendation\(/);
  assert.match(resolver, /resolveRemedialRecommendation\(\{/);
  assert.match(resolver, /availableModalities: AVAILABLE_REMEDIAL_FORMATS/);
  // the existing chain is still fed in unchanged
  assert.match(resolver, /adaptiveRecommendation: adaptive/);
  assert.match(resolver, /varkRecommendation: varkModality/);
  assert.match(resolver, /preferredModality: prefs\?\.lesson_format \?\? null/);
  // still reuses A7, still only READS vark / preferences
  assert.match(resolver, /resolveAdaptiveModalityRecommendation\(/);
  assert.doesNotMatch(resolver, /\.(insert|update|upsert|delete)\(/);
});

test("the history builder is READ-ONLY and best-effort", () => {
  const builder = fnSrc.slice(
    fnSrc.indexOf("async function buildStudentRemedialHistory"),
    fnSrc.indexOf("async function resolveRemedialModalityForStudyPath"),
  );
  // only .select over the three tables it reads
  assert.match(builder, /\.from\("study_paths"\)\s*\.select/);
  assert.match(builder, /\.from\("quiz_attempts"\)\s*\.select/);
  assert.match(builder, /\.from\("learning_interactions"\)\s*\n?\s*\.select/);
  assert.doesNotMatch(builder, /\.(insert|update|upsert|delete)\(|\.rpc\(/);
  // any failure => [] (never throws, never blocks the recommendation)
  assert.match(builder, /catch \(e\)[\s\S]{0,160}return \[\]/);
  // row -> record mapping is the SHARED mapper (also used by the R8.4 feed),
  // never a bespoke re-implementation
  assert.match(builder, /toRemedialInterventionRecords\(/);
});

test("R8.3 does not touch A7 / VARK / Mastery / grading source", () => {
  const a7 = read("./adaptive-modality.ts");
  const a7fn = read("./adaptive-modality.functions.ts");
  const a7logger = read("./learning-interactions.ts");
  for (const src of [a7, a7fn]) {
    assert.doesNotMatch(
      src,
      /remedial-adaptation|remedial-recommendation|remedial-intelligence|"history"/,
    );
  }
  // A7's own client logger still only knows 'vark' | 'adaptive'
  assert.match(a7logger, /type RecommendationSource = "vark" \| "adaptive"/);
  assert.doesNotMatch(a7logger, /"history"/);
});

test("the tracking source type is widened (so 'history' can be logged), engagement logic untouched", () => {
  const hook = read("../hooks/use-remedial-tracking.ts");
  const logger = read("./remedial-tracking.ts");
  assert.match(hook, /RemedialModalitySource \| "history" \| null/);
  assert.match(logger, /RemedialModalitySource \| "history" \| null/);
  // no new queries / writes / A7 wiring crept into the R4 tracking files
  for (const src of [hook, logger]) {
    assert.doesNotMatch(
      src,
      /vark_profiles|learning_preferences|computeModuleMastery|buildModalityEvidence|\.rpc\("grade_quiz/i,
    );
  }
});
