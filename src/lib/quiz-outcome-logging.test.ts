/**
 * Tests for the Phase A6 reliability correction: official_quiz_completed is
 * now logged exclusively inside grade_quiz() (SQL, SECURITY DEFINER), not
 * from a client page. There is no live Postgres/Supabase instance available
 * in this environment, so these are STRUCTURAL/STATIC checks against the
 * actual migration SQL text (supabase/migrations/20260905190000_learning_
 * interactions.sql) plus TypeScript compile-time checks on the client-side
 * exclusion — not a live-database integration test. They catch regressions
 * in the SQL text (a removed guard, a dropped exception block, a reordered
 * statement) even though they can't execute the SQL itself.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/quiz-outcome-logging.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LearningInteractionInput } from "@/lib/learning-interactions";

const MIGRATION_PATH = fileURLToPath(
  new URL("../../supabase/migrations/20260905190000_learning_interactions.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

// Isolate just the grade_quiz() function body for the position-sensitive
// assertions below (there's exactly one `create or replace function
// public.grade_quiz` in this file).
const grateQuizStart = sql.indexOf("create or replace function public.grade_quiz");
assert.ok(grateQuizStart >= 0, "expected grade_quiz() to be redefined in the A6 migration");
const grateQuizBody = sql.slice(grateQuizStart);

test("an official module attempt's grading inserts an official_quiz_completed row", () => {
  assert.match(grateQuizBody, /insert into public\.learning_interactions/);
  assert.match(grateQuizBody, /'official_quiz_completed'/);
});

test(
  "the outcome insert is scoped to the module-quiz branch (v_topic_id is not null), " +
    "never the General Course Quiz branch (v_cq_id)",
  () => {
    // The insert must appear inside the SAME `if v_topic_id is not null then …
    // end if;` block that already handles the module-only progress side
    // effect — i.e. after that "if v_topic_id is not null then" and before
    // its closing "end if;", not inside the "elsif v_cq_id is not null" arm.
    const moduleBranchStart = grateQuizBody.indexOf("if v_topic_id is not null then");
    const insertIdx = grateQuizBody.indexOf("'official_quiz_completed'");
    const cqBranchIdx = grateQuizBody.indexOf("elsif v_cq_id is not null then");
    assert.ok(moduleBranchStart >= 0 && insertIdx > moduleBranchStart);
    // The elsif branch (General Course Quiz totals/deadline lookup) is earlier
    // in the function, entirely separate from the module-only block the
    // insert lives in.
    assert.ok(cqBranchIdx >= 0 && cqBranchIdx < insertIdx);
  },
);

test(
  "the outcome insert happens only AFTER quiz_attempts.finished_at is set, " +
    "and an already-finished attempt short-circuits before ever reaching it",
  () => {
    const finishedAtUpdateIdx = grateQuizBody.indexOf("finished_at = now()");
    const insertIdx = grateQuizBody.indexOf("'official_quiz_completed'");
    assert.ok(finishedAtUpdateIdx >= 0 && insertIdx > finishedAtUpdateIdx);

    // The early-return guard for an already-finished attempt.
    const earlyReturnIdx = grateQuizBody.indexOf("if v_finished is not null then");
    assert.ok(earlyReturnIdx >= 0 && earlyReturnIdx < insertIdx);
  },
);

test(
  "score_percent is computed from v_score/v_total (server-derived), " +
    "never from the _answers input parameter directly",
  () => {
    const insertBlockMatch = grateQuizBody.match(
      /insert into public\.learning_interactions[\s\S]*?do nothing;/,
    );
    assert.ok(insertBlockMatch, "expected the full insert...on conflict...do nothing statement");
    const insertBlock = insertBlockMatch![0];
    assert.match(insertBlock, /v_score/);
    assert.match(insertBlock, /v_total/);
    assert.doesNotMatch(insertBlock, /_answers/);
  },
);

test(
  "one quiz_attempt_id can produce at most one official_quiz_completed row " +
    "(partial unique index + on conflict do nothing)",
  () => {
    assert.match(
      sql,
      /create unique index learning_interactions_official_outcome_uq[\s\S]*?where event_type = 'official_quiz_completed';/,
    );
    assert.match(
      grateQuizBody,
      /on conflict \(quiz_attempt_id\) where event_type = 'official_quiz_completed'\s*\n\s*do nothing;/,
    );
  },
);

test(
  "the outcome insert is wrapped in its own exception block, so a logging " +
    "failure cannot roll back the grading update above it",
  () => {
    const insertIdx = grateQuizBody.indexOf("'official_quiz_completed'");
    const precedingText = grateQuizBody.slice(0, insertIdx);
    const lastBeginIdx = precedingText.lastIndexOf("\n    begin\n");
    assert.ok(lastBeginIdx >= 0, "expected a nested begin block wrapping the outcome insert");
    const followingText = grateQuizBody.slice(insertIdx);
    assert.match(followingText, /exception when others then\s*\n\s*null;/);
  },
);

test(
  "client inserts of official_quiz_completed are rejected at the RLS layer, " +
    "independent of the TS helper",
  () => {
    assert.match(sql, /event_type <> 'official_quiz_completed'/);
  },
);

test(
  "LearningInteractionInput (the client-loggable event shape) no longer " +
    "accepts official_quiz_completed at compile time",
  () => {
    // @ts-expect-error - official_quiz_completed must not be constructible via
    // the client-side logging helper; it is grade_quiz()-only now. This
    // directive above is the real assertion, enforced by `npx tsc --noEmit`
    // (this file's own `node --test` run doesn't type-check at all, since
    // --experimental-strip-types only strips annotations).
    const rejected: LearningInteractionInput = { event_type: "official_quiz_completed" };
    assert.ok(rejected);
  },
);
