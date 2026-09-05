/**
 * FIX 2 — one active official quiz per student, globally. Pure tests for the
 * shared client check + structural checks that the real enforcement is the
 * race-safe DB trigger and that both runner routes route through one path.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/quiz-start.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isBlockingActiveAttempt,
  isOneActiveOfficialQuizError,
  ONE_ACTIVE_OFFICIAL_QUIZ_TOKEN,
  type ActiveQuizAttempt,
} from "@/lib/quiz-start";

const moduleA: ActiveQuizAttempt = {
  attemptId: "att-a",
  kind: "module",
  paramId: "topic-a",
  title: "Module A",
  contextName: "Course 1",
  expiresAt: "2099-01-01T00:00:00Z",
};
const general1: ActiveQuizAttempt = {
  attemptId: "att-g",
  kind: "general",
  paramId: "cq-1",
  title: "General Course Quiz",
  contextName: "Course 1",
  expiresAt: "2099-01-01T00:00:00Z",
};

/* ---------------- isBlockingActiveAttempt ---------------- */

test("7. no active attempt -> a new official attempt is not blocked", () => {
  assert.equal(isBlockingActiveAttempt(null, { kind: "module", topicId: "topic-a" }), false);
  assert.equal(
    isBlockingActiveAttempt(undefined, { kind: "general", courseQuizId: "cq-1" }),
    false,
  );
});

test("8. active module quiz blocks a DIFFERENT module quiz", () => {
  assert.equal(isBlockingActiveAttempt(moduleA, { kind: "module", topicId: "topic-b" }), true);
});

test("9. active module quiz blocks the General Course Quiz", () => {
  assert.equal(isBlockingActiveAttempt(moduleA, { kind: "general", courseQuizId: "cq-1" }), true);
});

test("10. active General Course Quiz blocks a module quiz", () => {
  assert.equal(isBlockingActiveAttempt(general1, { kind: "module", topicId: "topic-a" }), true);
});

test("11. starting the SAME active quiz is a resume, not a block", () => {
  assert.equal(isBlockingActiveAttempt(moduleA, { kind: "module", topicId: "topic-a" }), false);
  assert.equal(isBlockingActiveAttempt(general1, { kind: "general", courseQuizId: "cq-1" }), false);
});

test("isOneActiveOfficialQuizError matches the DB sentinel only", () => {
  assert.equal(
    isOneActiveOfficialQuizError({
      message: `${ONE_ACTIVE_OFFICIAL_QUIZ_TOKEN}: You already have…`,
    }),
    true,
  );
  assert.equal(isOneActiveOfficialQuizError({ message: "duplicate key value" }), false);
  assert.equal(isOneActiveOfficialQuizError(null), false);
});

/* ---------------- structural: DB trigger + routes ---------------- */

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260905240000_one_active_official_quiz.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const bootstrap = readFileSync(
  fileURLToPath(new URL("../../supabase/bootstrap_new_project.sql", import.meta.url)),
  "utf8",
);
const moduleRoute = readFileSync(
  fileURLToPath(new URL("../routes/_authenticated/quiz.$topicId.tsx", import.meta.url)),
  "utf8",
);
const generalRoute = readFileSync(
  fileURLToPath(new URL("../routes/_authenticated/course-quiz.$quizId.tsx", import.meta.url)),
  "utf8",
);
const practiceFns = readFileSync(
  fileURLToPath(new URL("./practice-quiz.functions.ts", import.meta.url)),
  "utf8",
);
const quizMeDialog = readFileSync(
  fileURLToPath(new URL("../components/course/QuizMeDialog.tsx", import.meta.url)),
  "utf8",
);

test("12/13. finished + expired attempts do not block (filters), 14. race-safe (advisory lock)", () => {
  for (const sql of [migration, bootstrap]) {
    const fn = sql.slice(sql.indexOf("function public.enforce_one_active_official_quiz"));
    // race safety: a per-student advisory lock serialises simultaneous Starts
    assert.match(fn, /pg_advisory_xact_lock\(\s*hashtext\('acetutor:official-quiz-start'\)/);
    // finished / expired attempts are excluded, so they never block a new one
    assert.match(fn, /a\.finished_at is null/);
    assert.match(fn, /now\(\) < a\.expires_at/);
    // the SAME quiz is allowed through (resume, not a new attempt)
    assert.match(fn, /a\.topic_id = new\.topic_id/);
    assert.match(fn, /a\.course_quiz_id = new\.course_quiz_id/);
    assert.match(fn, /ONE_ACTIVE_OFFICIAL_QUIZ/);
  }
  // trigger is wired on quiz_attempts BEFORE INSERT
  assert.match(
    bootstrap,
    /create trigger trg_enforce_one_active_official_quiz\s*\n\s*before insert on public\.quiz_attempts/,
  );
});

test("both runner routes check the shared active-attempt path before inserting", () => {
  for (const route of [moduleRoute, generalRoute]) {
    assert.match(route, /loadActiveOfficialAttempt\(user\.id\)/);
    assert.match(route, /isBlockingActiveAttempt\(/);
    assert.match(route, /isOneActiveOfficialQuizError\(aErr\)/);
    assert.match(route, /ActiveQuizElsewherePanel/);
  }
});

test("15. Quiz Me practice never INSERTS a quiz_attempts row — outside this restriction", () => {
  // A5 reads quiz_attempts for difficulty, but practice never writes one, so
  // the BEFORE INSERT trigger never sees it.
  assert.doesNotMatch(practiceFns, /from\(["']quiz_attempts["']\)[\s\S]{0,80}\.insert/);
  assert.doesNotMatch(quizMeDialog, /\bquiz_attempts\b/);
  // practice-quiz.functions only ever .select()s from quiz_attempts (A5 difficulty)
  assert.doesNotMatch(practiceFns, /\.from\(["']quiz_attempts["']\)\s*\.insert/);
});
