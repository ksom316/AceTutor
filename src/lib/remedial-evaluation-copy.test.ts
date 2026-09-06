/**
 * P1.3 — plain-language copy for the lecturer Remedial Intelligence page.
 * Pure sentence builders over the R8.4 aggregate numbers. They must stay
 * OBSERVATIONAL, must pass the numbers through unchanged, and must never see a
 * student identifier.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-evaluation-copy.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  evidenceStateLabel,
  evidenceStateHint,
  followRateSentence,
  formatEffectivenessSentence,
  observedImprovementSentence,
  recommendationSourceLabel,
  REMEDIAL_CAUSATION_NOTE,
} from "@/lib/remedial-evaluation-copy";
import type { RemedialFormatEvaluation } from "@/lib/remedial-intelligence-evaluation";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const CAUSAL = /\bcaused\b|\bcauses\b|\bproven\b|\bproves\b|because of|will improve|guarantee/i;

/* ---------------------- 3. observational wording --------------------- */

test("3. the causation note is present and explicit", () => {
  assert.equal(
    REMEDIAL_CAUSATION_NOTE,
    "These are observations, not proof that remediation caused improvement.",
  );
});

test("3. observed-improvement sentences never claim causation", () => {
  for (const points of [-12, -1, 0, 1, 8, 45, null]) {
    const s = observedImprovementSentence(points, "text remediation");
    assert.doesNotMatch(s, CAUSAL);
    // phrased as "students who completed X later scored …", not "X improved …"
    if (points != null && points !== 0) {
      assert.match(s, /Students who completed text remediation later scored an average of/);
    }
  }
});

test("3. positive delta reads 'points higher', negative reads 'points lower'", () => {
  assert.match(observedImprovementSentence(12, "remedial activities"), /12 points higher/);
  assert.match(observedImprovementSentence(-5, "remedial activities"), /5 points lower/);
  assert.match(observedImprovementSentence(1, "x"), /1 point higher/); // singular
  assert.match(observedImprovementSentence(0, "x"), /about the same/);
  assert.match(observedImprovementSentence(null, "x"), /Not enough before\/after data/);
});

/* ------------------ 1. values passed through unchanged --------------- */

test("1. the exact R8.4 number is embedded, never re-derived or rounded again", () => {
  assert.match(observedImprovementSentence(37, "s"), /\b37 points higher\b/);
  assert.match(
    followRateSentence({
      recommendationsIssued: 30,
      recommendationsFollowed: 20,
      followRate: 20 / 30,
    }),
    /Of 30 recommendations, 20 were followed \(66\.7%\)/,
  );
});

test("followRateSentence is null-safe", () => {
  assert.match(
    followRateSentence({ recommendationsIssued: 0, recommendationsFollowed: 0, followRate: null }),
    /No recommendations from this source yet/,
  );
  assert.match(
    followRateSentence({ recommendationsIssued: 1, recommendationsFollowed: 1, followRate: 1 }),
    /Of 1 recommendation, 1 was followed \(100\.0%\)/,
  );
});

/* --------------------- evidence state labels ------------------------ */

test("evidence states keep the three A8 labels visible", () => {
  assert.equal(evidenceStateLabel("none"), "No evidence");
  assert.equal(evidenceStateLabel("insufficient"), "Insufficient evidence");
  assert.equal(evidenceStateLabel("sufficient"), "Sufficient evidence");
  assert.equal(evidenceStateLabel("unavailable"), "Not measured yet");
  for (const s of ["none", "insufficient", "sufficient", "unavailable"] as const) {
    assert.ok(evidenceStateHint(s, 5).length > 0);
  }
});

test("recommendation source labels expose no algorithm names", () => {
  const all = (["history", "adaptive", "vark", "preference", "default"] as const)
    .map(recommendationSourceLabel)
    .join(" | ");
  assert.doesNotMatch(all, /\bA7\b|\bA4\b|\bR8\b|\bVARK\b|adaptive-modality|reinforcement/);
});

/* -------------------- format effectiveness sentence ---------------- */

const fmtRow = (over: Partial<RemedialFormatEvaluation>): RemedialFormatEvaluation => ({
  format: "text",
  interventions: 6,
  meaningfulEngagements: 6,
  linkedQuizOutcomes: 6,
  averageBaselineScore: 40,
  averageSubsequentScore: 62,
  observedImprovement: 22,
  evidenceState: "sufficient",
  ...over,
});

test("formatEffectivenessSentence: observed delta + observation count + evidence, no causation", () => {
  const s = formatEffectivenessSentence(fmtRow({ observedImprovement: 22, linkedQuizOutcomes: 6 }));
  assert.match(s, /22 points higher/);
  assert.match(s, /6 before\/after observations/);
  assert.match(s, /sufficient evidence/);
  assert.doesNotMatch(s, CAUSAL);
});

test("formatEffectivenessSentence: video stays 'not measured', no estimate", () => {
  const s = formatEffectivenessSentence(
    fmtRow({
      format: "video",
      evidenceState: "unavailable",
      linkedQuizOutcomes: 0,
      observedImprovement: null,
    }),
  );
  assert.match(s, /isn't measured yet/);
  assert.doesNotMatch(s, /higher|lower/);
});

test("formatEffectivenessSentence: no outcomes yet -> honest 'not followed by a quiz yet'", () => {
  const s = formatEffectivenessSentence(
    fmtRow({ linkedQuizOutcomes: 0, observedImprovement: null }),
  );
  assert.match(s, /No text remediation has been followed by an official module quiz yet/);
});

/* ------------------ 4 / 6. structural: no PII, no AI --------------- */

const libSrc = read("./remedial-evaluation-copy.ts");
const pageSrc = read("../routes/lecturer.remedial-evaluation.tsx");
const indexSrc = read("../routes/lecturer.index.tsx");

test("4. the copy layer takes only aggregate numbers — no identifier fields", () => {
  const code = libSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  // identifier-shaped field access, not the word "students" in prose copy
  assert.doesNotMatch(code, /user_?id|full_?name|\bemail\b|student_?id|\.name\b/i);
});

test("6. lecturer pages call no AI and add no new server analytics", () => {
  for (const src of [libSrc, pageSrc, indexSrc]) {
    assert.doesNotMatch(src, /callAI|course-chat\.functions|createServerFn|openrouter|gemini/i);
  }
  // the eval page still just reads the existing R8.4 server fn
  assert.match(pageSrc, /getRemedialIntelligenceEvaluation/);
});

test("2. the eval page renders R8.4 values, it does not recompute them", () => {
  assert.doesNotMatch(
    pageSrc,
    /buildRemedialIntelligenceEvaluation|aggregateRemedialFormatEffectiveness|classifyEvidenceState/,
  );
  // the causation note is shown on the page
  assert.match(pageSrc, /REMEDIAL_CAUSATION_NOTE|CausationNote/);
});

test("2. the lecturer dashboard 'needs attention' list reuses the shared threshold", () => {
  assert.match(indexSrc, /avgByModule\.filter\(\(m\) => m\.avg < WEAK_THRESHOLD\)/);
  assert.doesNotMatch(indexSrc, /const WEAK_THRESHOLD\s*=|function computeCourseMastery/);
});

test("5. eval page has a 'No remedial data yet' empty state", () => {
  assert.match(pageSrc, /No remedial data yet/);
  assert.match(indexSrc, /No quiz results yet/);
});
