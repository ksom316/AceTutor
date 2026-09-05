/**
 * Authorization unit tests for predictVarkMlCategory's student-role gate
 * (isAuthorizedStudent, vark-student-auth.ts). Imports the pure check
 * directly (not the server function module, which pulls in
 * @tanstack/react-start's runtime) — no test framework dependency added,
 * uses Node's built-in test runner.
 *
 * Run: node --experimental-strip-types --test src/lib/vark-inference.functions.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuthorizedStudent } from "./vark-student-auth.ts";

test("role === 'student' is authorized", () => {
  assert.equal(isAuthorizedStudent({ data: { role: "student" }, error: null }), true);
});

test("role === 'teacher' is rejected", () => {
  assert.equal(isAuthorizedStudent({ data: { role: "teacher" }, error: null }), false);
});

test("role === 'admin' is rejected", () => {
  assert.equal(isAuthorizedStudent({ data: { role: "admin" }, error: null }), false);
});

test("missing row (data: null) is rejected, not defaulted to student", () => {
  assert.equal(isAuthorizedStudent({ data: null, error: null }), false);
});

test("a failed query is rejected even if data looks like a student row", () => {
  assert.equal(
    isAuthorizedStudent({ data: { role: "student" }, error: new Error("network") }),
    false,
  );
});
