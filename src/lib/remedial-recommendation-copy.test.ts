/**
 * P1.1 — student-facing "why this format is recommended" copy. Pure mapping
 * from the R8.2 recommendation source to one observational sentence. Also
 * structural proof that the presentation polish did not touch R4 tracking,
 * A7 / R8 recommendation logic, add AI, or change the DB.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-recommendation-copy.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  remedialRecommendationExplanation,
  REMEDIAL_RECOMMENDATION_SOURCES,
} from "@/lib/remedial-recommendation-copy";
import { REMEDIAL_MODALITIES, REMEDIAL_MODALITY_LABEL } from "@/lib/remedial-modality";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const CAUSAL =
  /\bproven\b|\bproves\b|\bbetter than\b|will improve|guarantee|guaranteed|because of the format|makes you learn|causes? you to/i;

/* -------------------------- 1. source -> text mapping -------------------- */

test("1. every recommendation source maps to a distinct, non-empty explanation", () => {
  const details = new Set<string>();
  for (const source of REMEDIAL_RECOMMENDATION_SOURCES) {
    const { badge, detail } = remedialRecommendationExplanation(source, "visual");
    assert.ok(badge.length > 0 && detail.length > 0, `empty copy for ${source}`);
    details.add(detail);
  }
  assert.equal(details.size, REMEDIAL_RECOMMENDATION_SOURCES.length);
});

test("1b. the wording matches the intended phrasing per source", () => {
  assert.match(
    remedialRecommendationExplanation("history", "visual").detail,
    /previous remedial sessions showed positive observed outcomes with Visual explanations/,
  );
  assert.match(
    remedialRecommendationExplanation("adaptive", "text").detail,
    /recent learning activity/,
  );
  assert.match(
    remedialRecommendationExplanation("vark", "audio").detail,
    /based on your learning preferences/,
  );
  assert.match(
    remedialRecommendationExplanation("preference", "text").detail,
    /based on your selected learning format/,
  );
  assert.match(
    remedialRecommendationExplanation("default", "text").detail,
    /default learning format/,
  );
});

test("history wording names the recommended format, observationally", () => {
  for (const m of REMEDIAL_MODALITIES) {
    const { detail } = remedialRecommendationExplanation("history", m);
    assert.match(
      detail,
      new RegExp(`observed outcomes with ${REMEDIAL_MODALITY_LABEL[m]} explanations`),
    );
  }
});

/* -------------------- 2 / 3. observational, non-causal ----------------- */

test("2. history wording is observational (observed outcomes, not a claim)", () => {
  const { detail } = remedialRecommendationExplanation("history", "visual");
  assert.match(detail, /observed outcomes/);
  assert.doesNotMatch(detail, CAUSAL);
  // still makes clear the student can choose
  assert.match(detail, /choose any format|switch|pick/i);
});

test("3. no causal wording in ANY source's copy", () => {
  for (const source of REMEDIAL_RECOMMENDATION_SOURCES) {
    for (const m of REMEDIAL_MODALITIES) {
      const { badge, detail } = remedialRecommendationExplanation(source, m);
      assert.doesNotMatch(`${badge} ${detail}`, CAUSAL);
    }
  }
});

test("copy never exposes internal algorithm names", () => {
  const INTERNAL =
    /\bA7\b|\bA4\b|\bR8\b|\bVARK\b|adaptive-modality|reinforcement|classifier|algorithm/;
  for (const source of REMEDIAL_RECOMMENDATION_SOURCES) {
    const { badge, detail } = remedialRecommendationExplanation(source, "visual");
    assert.doesNotMatch(`${badge} ${detail}`, INTERNAL);
  }
});

/* -------------- 4. existing recommendation logic unchanged ------------- */

const copySrc = read("./remedial-recommendation-copy.ts");
const panelSrc = read("../components/course/RemedialExplanation.tsx");
const videoCardSrc = read("../components/course/RemedialVideoCard.tsx");
const learningRouteSrc = read("../routes/_authenticated/learning.$studyPathId.tsx");

test("4. the copy layer only READS the resolved source — it never re-resolves or edits R8", () => {
  // pure: no resolver internals, no engine, no AI, no DB (comments stripped)
  const code = copySrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  assert.doesNotMatch(
    code,
    /resolveRemedialRecommendation|deriveRemedialFormatRecommendation|resolveRecommendedRemedialModality|adaptive-modality|buildStudentRemedialHistory/,
  );
  assert.doesNotMatch(
    code,
    /@\/integrations\/supabase|from ["']react["']|createServerFn|callAI|\.rpc\(/,
  );
  // the panel still gets its recommendation from the unchanged hook, untouched
  assert.match(
    panelSrc,
    /remedial\.recommendation\?\.modality \?\? studyPath\.remedial\?\.modality \?\? "text"/,
  );
  assert.match(panelSrc, /remedial\.recommendation\b/);
});

/* --------------------- 5. format switching still works ---------------- */

test("5. the format toggle still logs a real change and sets the format", () => {
  assert.match(panelSrc, /if \(m !== activeFormat\) tracking\.logFormatSelection\(m\)/);
  assert.match(
    panelSrc,
    /onClick=\{\(\) => \{[\s\S]{0,400}logFormatSelection\(m\);\s*\n\s*setFormat\(m\)/,
  );
  // switching is never removed / disabled
  assert.doesNotMatch(panelSrc, /REMEDIAL_MODALITIES\.map[\s\S]{0,400}disabled/);
  assert.match(panelSrc, /REMEDIAL_MODALITIES\.map\(\(m\) =>/);
});

/* --------------------- 6. R4 tracking is untouched ------------------- */

test("6. R4 tracking files + wiring are unchanged by P1.1", () => {
  const trackingHook = read("../hooks/use-remedial-tracking.ts");
  const trackingLib = read("./remedial-tracking.ts");
  for (const src of [trackingHook, trackingLib]) {
    assert.doesNotMatch(src, /remedial-recommendation-copy/);
  }
  // the panel still feeds tracking the recommended format + source, unchanged
  assert.match(panelSrc, /recommendedFormat: remedial\.recommendation\?\.modality/);
  assert.match(panelSrc, /recommendationSource: remedial\.recommendation\?\.source \?\? null/);
});

/* --------------------- 7. no AI generation added -------------------- */

test("7. P1.1 adds no AI generation", () => {
  for (const src of [copySrc, panelSrc, videoCardSrc, learningRouteSrc]) {
    assert.doesNotMatch(
      src,
      /callAI|course-chat\.functions|generateRemedialLesson\(|openrouter|gemini/i,
    );
  }
  // the panel still only triggers the EXISTING generate mutation
  assert.match(panelSrc, /remedial\.generate\((?:true|false)\)/);
});

/* --------------------- 8. no DB schema changes -------------------- */

test("8. P1.1 ships no migration and no schema change", () => {
  for (const src of [copySrc, panelSrc, videoCardSrc, learningRouteSrc]) {
    assert.doesNotMatch(src, /alter table|create table|create or replace function|add column/i);
  }
  // the "Why this study path?" score is a plain read of quiz_attempts
  assert.match(learningRouteSrc, /\.from\("quiz_attempts"\)\s*\.select\("score, total"\)/);
  assert.doesNotMatch(
    learningRouteSrc,
    /\.from\("quiz_attempts"\)[\s\S]{0,80}\.(insert|update|upsert|delete)/,
  );
});

/* --------------------- video presentation ------------------------- */

test("video card: 'Additional video resource', course vs YouTube kept, no score claim", () => {
  assert.match(videoCardSrc, /Additional video resource/);
  assert.match(videoCardSrc, /Course material/);
  assert.match(videoCardSrc, /YouTube recommendation/);
  assert.match(videoCardSrc, /text, audio and visual explanations/i);
  assert.doesNotMatch(videoCardSrc, /improve your score|will help you score|proven/i);
});

test("study path page: 'Why this study path?' uses stored data only", () => {
  assert.match(learningRouteSrc, /Why this study path\?/);
  assert.match(learningRouteSrc, /areas\.map\(/);
  assert.match(learningRouteSrc, /anchorScorePercent/);
  assert.doesNotMatch(learningRouteSrc, /callAI|generate.*explanation.*text/i);
});
