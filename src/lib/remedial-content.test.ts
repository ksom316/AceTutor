/**
 * R1 — remedial content validation + structural checks on the generator,
 * persistence and security.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-content.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseRemedialContent,
  remedialContentSchema,
  remedialContentToScript,
} from "@/lib/remedial-content";

const FALLBACK = ["Big-O of nested loops", "Recurrence relations"];

/* ---------------- 9. generated output validation ---------------- */

test("9. a well-formed model reply validates", () => {
  const raw = JSON.stringify({
    title: "Analysing loop complexity",
    weakConcepts: ["Big-O of nested loops"],
    summary: "The likely mistake is multiplying loop bounds incorrectly.",
    explanation:
      "A nested loop where the inner runs to i gives a triangular number of steps…".padEnd(60, "."),
    workedExample: "For n = 4, the inner loop runs 1 + 2 + 3 + 4 = 10 times.",
    keyPoints: ["Count total inner iterations", "Sum 1..n is n(n+1)/2", "That is O(n^2)"],
    practicePrompt: "Write the step count for a loop that runs to 2*i.",
  });
  const parsed = parseRemedialContent(raw, FALLBACK);
  assert.ok(parsed);
  assert.equal(parsed.weakConcepts[0], "Big-O of nested loops");
  assert.equal(parsed.keyPoints.length, 3);
  assert.ok(parsed.workedExample && parsed.practicePrompt);
});

test("9b. code fences, snake_case keys and missing optionals are tolerated", () => {
  const raw =
    "```json\n" +
    JSON.stringify({
      title: "T",
      weak_concepts: [],
      summary: "s".repeat(10),
      explanation: "e".repeat(80),
      key_points: ["a", "b"],
    }) +
    "\n```";
  const parsed = parseRemedialContent(raw, FALLBACK);
  assert.ok(parsed);
  assert.deepEqual(parsed.weakConcepts, FALLBACK); // fell back
  assert.equal(parsed.workedExample, undefined);
  assert.equal(parsed.practicePrompt, undefined);
});

test("9c. garbage / empty / no key points -> null", () => {
  assert.equal(parseRemedialContent("not json", FALLBACK), null);
  assert.equal(parseRemedialContent("", FALLBACK), null);
  assert.equal(
    parseRemedialContent(
      JSON.stringify({
        title: "T",
        summary: "x".repeat(10),
        explanation: "y".repeat(40),
        keyPoints: [],
      }),
      FALLBACK,
    ),
    null,
  );
});

test("9d. schema rejects an over-long / empty explanation", () => {
  assert.equal(
    remedialContentSchema.safeParse({
      weakConcepts: ["a"],
      summary: "s",
      explanation: "",
      keyPoints: ["k"],
      title: "t",
    }).success,
    false,
  );
});

test("remedialContentToScript is format-independent and covers every section", () => {
  const content = remedialContentSchema.parse({
    title: "T",
    weakConcepts: ["c"],
    summary: "the summary",
    explanation: "the explanation body".padEnd(40, "."),
    workedExample: "the example",
    keyPoints: ["one", "two"],
    practicePrompt: "do this",
  });
  const script = remedialContentToScript(content);
  for (const s of ["the summary", "the explanation", "the example", "one", "two", "do this"]) {
    assert.match(script, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

/* ---------------- structural: server fn ---------------- */

const fnSrc = readFileSync(
  fileURLToPath(new URL("./remedial.functions.ts", import.meta.url)),
  "utf8",
);
const migration = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/20260905250000_study_path_remedial.sql", import.meta.url),
  ),
  "utf8",
);
const bootstrap = readFileSync(
  fileURLToPath(new URL("../../supabase/bootstrap_new_project.sql", import.meta.url)),
  "utf8",
);
const hookSrc = readFileSync(
  fileURLToPath(new URL("../hooks/use-remedial-lesson.ts", import.meta.url)),
  "utf8",
);

test("10. cached remedial content is reused unless regenerate is requested", () => {
  assert.match(
    fnSrc,
    /if \(!data\.regenerate && row\.remedial_content && row\.remedial_generated_at\)[\s\S]{0,260}status: "existing"/,
  );
});

test("11. an explicit regenerate replaces the content (bypasses the cache)", () => {
  assert.match(fnSrc, /regenerate: z\.boolean\(\)\.optional\(\)/);
  // the cache branch is guarded by `!data.regenerate`, so regenerate falls
  // through to generation + save
  assert.match(fnSrc, /save_study_path_remedial/);
  assert.match(hookSrc, /generate\.mutate\(regenerate\)|regenerate: !!regenerate/);
});

test("12. another student cannot generate for someone else's Study Path", () => {
  // loaded through the RLS-scoped context.supabase (not the service client) …
  assert.match(fnSrc, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.doesNotMatch(fnSrc, /supabaseAdmin|client\.server/);
  // … with an explicit user_id re-check
  assert.match(fnSrc, /row\.user_id !== userId[\s\S]{0,40}STUDY_PATH_NOT_OWNED/);
  // topic/course relationship is validated
  assert.match(fnSrc, /topic\.course_id !== row\.course_id[\s\S]{0,40}COURSE_MISMATCH/);
  // studyPathId is the only client input (both fns)
  assert.match(fnSrc, /studyPathId: z\.string\(\)\.uuid\(\)/);
});

test("13. generation failure never destroys the Study Path", () => {
  // the only write is save_study_path_remedial, which the migration proves only
  // touches remedial_* columns
  assert.doesNotMatch(fnSrc, /\.rpc\("save_study_path"|\.rpc\("delete_study_path"|delete\(\)/);
  assert.doesNotMatch(fnSrc, /\.from\("study_paths"\)[\s\S]{0,80}\.(update|upsert|insert|delete)/);
  for (const sql of [migration, bootstrap]) {
    const fn = sql.slice(sql.indexOf("function public.save_study_path_remedial"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    assert.match(
      body,
      /set remedial_content\s*=\s*_content,\s*remedial_modality\s*=\s*_modality,\s*remedial_generated_at\s*=\s*now\(\)/,
    );
    assert.doesNotMatch(body, /\bcontent\s*=|weak_question_ids\s*=|completed_at\s*=|delete from/i);
    assert.match(body, /and user_id = v_uid/); // ownership re-check
  }
});

test("14. official quiz / Mastery / A7 state is never written", () => {
  assert.doesNotMatch(fnSrc, /\.from\("quiz_attempts"\)[\s\S]{0,80}\.(update|insert|upsert)/);
  assert.doesNotMatch(fnSrc, /\.rpc\(["']grade_quiz|computeModuleMastery|\.from\("progress"\)/);
  // A7: read-only reuse of the recommendation compute, never a write to
  // learning_interactions / vark_profiles / learning_preferences
  assert.doesNotMatch(
    fnSrc,
    /\.from\("learning_interactions"\)[\s\S]{0,80}\.(insert|update|upsert)/,
  );
  assert.doesNotMatch(fnSrc, /\.from\("vark_profiles"\)[\s\S]{0,80}\.(insert|update|upsert)/);
  assert.doesNotMatch(
    fnSrc,
    /\.from\("learning_preferences"\)[\s\S]{0,80}\.(insert|update|upsert)/,
  );
  assert.match(fnSrc, /resolveAdaptiveModalityRecommendation\(/); // reuses A7, unchanged
});

test("8b. the modality resolver only READS vark_profiles / learning_preferences", () => {
  const resolver = fnSrc.slice(
    fnSrc.indexOf("async function resolveRemedialModalityForStudyPath"),
    fnSrc.indexOf("async function loadOwnStudyPath"),
  );
  assert.match(resolver, /\.from\("vark_profiles"\)\s*\.select/);
  assert.match(resolver, /\.from\("learning_preferences"\)\s*\.select/);
  assert.doesNotMatch(resolver, /\.(insert|update|upsert|delete)\(/);
});

test("the AI receives no user id, email, or quiz answers", () => {
  const start = fnSrc.indexOf("async function runRemedialGeneration");
  const gen = fnSrc.slice(start, fnSrc.indexOf("/* ---------------- server fns", start));
  assert.ok(gen.length > 200);
  assert.doesNotMatch(gen, /userId|user_id|email|correct_index|correctAnswer|\bchoices\b/);
  assert.match(gen, /missedQuestionPrompts/); // prompts only
  // the missed-question lookup goes through the prompts-only RPC (SEC-01:
  // students have no direct read on `questions`), which returns no answer key
  assert.match(fnSrc, /supabase\.rpc\("get_question_prompts", \{/);
  assert.doesNotMatch(fnSrc, /\.from\("questions"\)/);
});

test("analytics: R1 logs nothing (no meaningful_engagement / selection / completion events)", () => {
  assert.doesNotMatch(
    fnSrc,
    /meaningful_engagement|modality_selected|logInteraction|learning_interactions.*insert/,
  );
});
