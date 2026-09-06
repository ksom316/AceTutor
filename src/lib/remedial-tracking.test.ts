/**
 * R4 — structural checks: format-selection semantics, security, fail-safety,
 * and A7 / VARK / Learning-Preferences / Mastery regression.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-tracking.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const panelSrc = read("../components/course/RemedialExplanation.tsx");
const hookSrc = read("../hooks/use-remedial-tracking.ts");
const loggerSrc = read("../lib/remedial-tracking.ts");
const playerSrc = read("../components/course/RemedialAudioPlayer.tsx");
const migration = read(
  "../../supabase/migrations/20260905260000_remedial_interaction_tracking.sql",
);
const bootstrap = read("../../supabase/bootstrap_new_project.sql");
const a7FnSrc = read("./adaptive-modality.functions.ts");
const a7EvidenceSrc = read("./adaptive-modality.ts");
const a8Src = read("./model-evaluation.ts");
const speechSrc = read("../hooks/use-speech-synthesis.ts");

/* ---------------- 1-3. format selection is an ACTION, not a render ---------------- */

test("1. the automatic initial format never logs a selection", () => {
  // logFormatSelection is called ONLY from the toggle onClick, never from a
  // useEffect / on mount / on render.
  assert.doesNotMatch(hookSrc, /useEffect\([\s\S]{0,200}logFormatSelection/);
  assert.doesNotMatch(panelSrc, /useEffect\([\s\S]{0,200}logFormatSelection/);
  // `activeFormat = format ?? recommended` — the auto value; the tracked
  // selection fires only from the toggle button's onClick
  assert.match(
    panelSrc,
    /onClick=\{\(\) => \{[\s\S]{0,400}logFormatSelection\(m\);\s*\n\s*setFormat\(m\)/,
  );
});

test("2/3. only a click that CHANGES the format logs, and it goes through the RPC", () => {
  assert.match(panelSrc, /if \(m !== activeFormat\) tracking\.logFormatSelection\(m\)/);
  assert.match(hookSrc, /eventType: "remedial_format_selected"/);
  assert.match(loggerSrc, /supabase\.rpc\("log_remedial_interaction"/);
});

/* ---------------- 23. A7 is READ-ONLY ---------------- */

test("23. remedial events never enter A7 evidence / reward / counts", () => {
  // the A7 query still reads EXACTLY 'meaningful_engagement' (a different
  // string from 'remedial_meaningful_engagement') and 'official_quiz_completed'
  assert.match(a7FnSrc, /\.eq\("event_type", "meaningful_engagement"\)/);
  assert.match(a7FnSrc, /\.eq\("event_type", "official_quiz_completed"\)/);
  assert.doesNotMatch(a7FnSrc, /remedial_/);
  // buildModalityEvidence / the reward compute never mention remedial
  assert.doesNotMatch(a7EvidenceSrc, /remedial/i);
  // A8's A7 reconstruction filters the same two strings — remedial rows drop out
  assert.match(a8Src, /eventType === "meaningful_engagement"/);
  assert.doesNotMatch(a8Src, /remedial_meaningful_engagement|remedial_format_selected/);
  // the R4 tracking hook feeds nothing back into A7
  assert.doesNotMatch(
    hookSrc,
    /buildModalityEvidence|computeAdaptiveModalityRecommendation|adaptive-modality/,
  );
});

/* ---------------- 24-26. VARK / Preferences / Mastery / grading untouched ---------------- */

test("24/25/26. R4 writes nothing to VARK / Learning Preferences / Mastery / grading", () => {
  for (const src of [hookSrc, loggerSrc, playerSrc]) {
    assert.doesNotMatch(
      src,
      /vark_profiles|learning_preferences|computeModuleMastery|\.rpc\("grade_quiz|\.from\("quiz_attempts"\)[\s\S]{0,60}\.(insert|update|upsert)|\.from\("progress"\)/i,
    );
  }
  // the R4 migration touches only learning_interactions (+ its own function)
  assert.doesNotMatch(
    migration,
    /alter table public\.(vark_profiles|learning_preferences|quiz_attempts|progress|study_paths)\b/,
  );
  assert.doesNotMatch(migration, /grade_quiz|computeModuleMastery/);
});

/* ---------------- 27a. RPC requires an ESTABLISHED student role ---------------- */

test("27a. only an established student may log — lecturer / admin / provisional rejected", () => {
  for (const sql of [migration, bootstrap]) {
    const fn = sql.slice(sql.indexOf("function public.log_remedial_interaction"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    // trusted source is public.user_roles — role = 'student' AND status = 'established'
    assert.match(
      body,
      /from public\.user_roles\s+where user_id = v_uid and role = 'student' and status = 'established'/,
    );
    assert.match(body, /NOT_AN_ESTABLISHED_STUDENT/);
    // unauthenticated is rejected first of all
    assert.match(body, /if v_uid is null then raise exception 'AUTH_REQUIRED'/);
    assert.ok(body.indexOf("AUTH_REQUIRED") < body.indexOf("NOT_AN_ESTABLISHED_STUDENT"));
    // the role check runs BEFORE the study-path lookup (a non-student is
    // rejected even if malformed data gave them a study_paths row)
    assert.ok(body.indexOf("NOT_AN_ESTABLISHED_STUDENT") < body.indexOf("from public.study_paths"));
    // it must NOT trust client params / auth metadata / signup_intent
    assert.doesNotMatch(body, /signup_intent|raw_user_meta_data|jwt|request\.header/i);
  }
});

/* ---------------- 27. cross-user ownership ---------------- */

test("27. another student cannot log against someone else's Study Path", () => {
  for (const sql of [migration, bootstrap]) {
    const fn = sql.slice(sql.indexOf("function public.log_remedial_interaction"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    assert.match(body, /security definer/);
    assert.match(body, /v_sp\.user_id <> v_uid[\s\S]{0,40}STUDY_PATH_NOT_OWNED/);
    // topic / course / version are DERIVED from the row, never taken from args
    assert.match(body, /v_sp\.course_id, v_sp\.topic_id/);
    assert.match(body, /v_sp\.remedial_generated_at/);
    // event type + format constrained
    assert.match(
      body,
      /_event_type not in \('remedial_format_selected', 'remedial_meaningful_engagement'\)/,
    );
    assert.match(body, /_remedial_format not in \('text', 'audio', 'visual'\)/);
  }
  // official_quiz_completed stays authoritative — R4 never inserts it
  assert.doesNotMatch(migration, /official_quiz_completed'\s*\)\s*\)?\s*;?\s*insert/i);
  // RLS blocks direct client inserts of the R4 events (like official_quiz_completed)
  assert.match(
    bootstrap,
    /event_type not in \(\s*'official_quiz_completed', 'remedial_format_selected', 'remedial_meaningful_engagement'\s*\)/,
  );
  assert.match(loggerSrc, /supabase\.rpc\("log_remedial_interaction"/);
  assert.doesNotMatch(loggerSrc, /\.from\("learning_interactions"\)\s*\.insert/);
});

/* ---------------- 28. tracking failure is invisible ---------------- */

test("28. a tracking failure never throws / breaks the remedial UI", () => {
  // the logger swallows every error
  assert.match(loggerSrc, /try \{[\s\S]*?\} catch \(e\) \{[\s\S]*?console\.error/);
  assert.doesNotMatch(loggerSrc, /throw /);
  // every call site is fire-and-forget (`void`), never awaited in the render path
  assert.match(hookSrc, /void logRemedialInteraction\(/);
  // the audio progress feed is optional and cannot affect playback
  assert.match(playerSrc, /onSpokenProgress\?:/);
  assert.match(playerSrc, /onSpokenRef\.current\?\.\(/);
  // R2 speech hook is unchanged in behaviour (support tri-state + cancel-before-speak still there)
  assert.match(speechSrc, /useState<boolean \| null>\(null\)/);
  assert.match(
    speechSrc,
    /window\.speechSynthesis\.cancel\(\);[\s\S]*?new window\.SpeechSynthesisUtterance/,
  );
});

/* ---------------- schema shape ---------------- */

test("R4 extends learning_interactions with checked columns (no JSON blob)", () => {
  for (const sql of [migration, bootstrap]) {
    assert.match(sql, /study_path_id\s+uuid[\s\S]{0,80}references public\.study_paths/);
    assert.match(sql, /\bremedial_format\s+text/);
    assert.match(sql, /\brecommended_remedial_format\s+text/);
    assert.match(sql, /remedial_content_version\s+timestamptz/);
    assert.match(
      sql,
      /remedial_format is null or remedial_format in \('text', 'audio', 'visual'\)/,
    );
    assert.match(
      sql,
      /event_type in \([\s\S]{0,300}'remedial_format_selected', 'remedial_meaningful_engagement'/,
    );
    // dedup: one meaningful engagement per (study_path, format, version)
    assert.match(
      sql,
      /unique index[\s\S]{0,120}\(study_path_id, remedial_format, remedial_content_version\)[\s\S]{0,80}where event_type = 'remedial_meaningful_engagement'/,
    );
  }
  assert.doesNotMatch(migration, /jsonb|json_build_object|metadata\s+jsonb/i);
});
