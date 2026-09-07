/**
 * Regression: a server env var pasted WITH surrounding quotes or padding must
 * not reach OpenRouter verbatim. `OPENROUTER_API_KEY="sk-or-…"` used to be sent
 * as `Authorization: Bearer "sk-or-…"` and rejected with 401 "Missing
 * Authentication header" — indistinguishable at the UI from any other AI
 * outage. `cleanEnv` strips the wrapper so a correct-but-quoted key still works.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/course-chat-env.test.ts
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanEnv } from "@/lib/course-chat.functions";

const KEY = "COURSE_CHAT_ENV_TEST_VAR";

afterEach(() => {
  delete process.env[KEY];
});

test("returns a plain value unchanged", () => {
  process.env[KEY] = "sk-or-v1-abcdef";
  assert.equal(cleanEnv(KEY), "sk-or-v1-abcdef");
});

test("strips surrounding double quotes (the .env / dashboard paste mistake)", () => {
  process.env[KEY] = '"sk-or-v1-abcdef"';
  assert.equal(cleanEnv(KEY), "sk-or-v1-abcdef");
});

test("strips surrounding single quotes", () => {
  process.env[KEY] = "'openrouter/free'";
  assert.equal(cleanEnv(KEY), "openrouter/free");
});

test("trims whitespace, including around a quoted value", () => {
  process.env[KEY] = '   "  sk-or-v1-abcdef  "  ';
  assert.equal(cleanEnv(KEY), "sk-or-v1-abcdef");
});

test("does not strip a lone quote or mismatched quotes", () => {
  process.env[KEY] = '"unbalanced';
  assert.equal(cleanEnv(KEY), '"unbalanced');
  process.env[KEY] = "'mixed\"";
  assert.equal(cleanEnv(KEY), "'mixed\"");
});

test("missing or blank → undefined (so `?? default` still applies)", () => {
  assert.equal(cleanEnv(KEY), undefined);
  process.env[KEY] = "   ";
  assert.equal(cleanEnv(KEY), undefined);
  process.env[KEY] = '""';
  assert.equal(cleanEnv(KEY), undefined);
});
