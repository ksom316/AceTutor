/**
 * Regression: OpenRouter's current free roster includes reasoning-tuned models
 * that wrap their chain-of-thought in <think>…</think> inside message.content
 * (or stream it into a separate `reasoning` field). Before `stripModelReasoning`
 * the tutor showed the raw thinking and — worse — the JSON extractors in Study
 * Path / crossword / quiz-gen grabbed a `{` from inside the thought and every
 * generation failed even though OpenRouter returned a 200.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/course-chat-reasoning.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { stripModelReasoning } from "@/lib/course-chat.functions";

test("clean content is returned untouched", () => {
  assert.equal(stripModelReasoning('{"title":"x"}'), '{"title":"x"}');
  assert.equal(stripModelReasoning("Here is a plain answer."), "Here is a plain answer.");
});

test("a complete <think> block is removed, leaving the JSON that follows", () => {
  const raw =
    "<think>The student missed { comparisons }, so I should build one weakArea…</think>\n\n" +
    '{"title":"Study Path","weakAreas":[]}';
  assert.equal(stripModelReasoning(raw), '{"title":"Study Path","weakAreas":[]}');
});

test("<thinking> and <reasoning> tag variants are handled", () => {
  assert.equal(stripModelReasoning("<thinking>hmm {}</thinking>ANSWER"), "ANSWER");
  assert.equal(stripModelReasoning("<reasoning>a</reasoning> b"), "b");
});

test("a dangling unterminated <think> (truncated mid-thought) collapses to empty, then falls back to reasoning", () => {
  const out = stripModelReasoning("<think>still thinking about the { schema", "the real answer");
  assert.equal(out, "the real answer");
});

test("empty content falls back to the separate reasoning channel", () => {
  assert.equal(
    stripModelReasoning("", "answer from reasoning field"),
    "answer from reasoning field",
  );
  assert.equal(stripModelReasoning("   ", "x"), "x");
});

test("no reasoning anywhere → empty string (caller treats as empty response)", () => {
  assert.equal(stripModelReasoning(""), "");
  assert.equal(stripModelReasoning("<think>only thoughts</think>"), "");
});

test("prose that merely mentions the word thinking is not touched", () => {
  const s = "When thinking about arrays, remember they are contiguous.";
  assert.equal(stripModelReasoning(s), s);
});
