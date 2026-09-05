/**
 * FIX 1 — cross-role account/email reuse. Pure decision tests + structural
 * checks that the enforcement is server/DB-side, keyed on an EXPLICIT role
 * `status`, not on student activity.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/cross-role-auth.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  friendlyClaimError,
  isRoleConflictStudentError,
  resolveRoleClaimConflict,
  ROLE_CONFLICT_STUDENT_TOKEN,
  SIGNUP_INTENT_LECTURER,
  STUDENT_ACCOUNT_ON_LECTURER_SURFACE_MESSAGE,
} from "@/lib/cross-role-auth";

const base = {
  existingRole: null as "student" | "teacher" | "admin" | null,
  roleStatus: null as "provisional" | "established" | null,
  hasLegacyStudentActivity: false,
  slotExists: true,
  slotClaimed: false,
  slotClaimedBySelf: false,
};

/* ---------------- resolveRoleClaimConflict ---------------- */

test("1. an established lecturer role is honoured as-is (never demoted)", () => {
  const d = resolveRoleClaimConflict({
    ...base,
    existingRole: "teacher",
    roleStatus: "established",
  });
  assert.deepEqual(d, { ok: true }); // a teacher row = retry/mid-claim; role stays teacher
});

test("2. an ESTABLISHED student cannot be claimed as a lecturer — decided on status, not activity", () => {
  const noActivity = resolveRoleClaimConflict({
    ...base,
    existingRole: "student",
    roleStatus: "established",
    hasLegacyStudentActivity: false, // <- irrelevant; status alone rejects
  });
  assert.deepEqual(noActivity, { ok: false, code: "ROLE_CONFLICT_STUDENT" });
});

test("3. a PROVISIONAL student placeholder (lecturer-intent signup) still converts", () => {
  const d = resolveRoleClaimConflict({
    ...base,
    existingRole: "student",
    roleStatus: "provisional",
    hasLegacyStudentActivity: false,
  });
  assert.deepEqual(d, { ok: true });
});

test("defensive backstop: a provisional/legacy row WITH student history is still rejected", () => {
  assert.deepEqual(
    resolveRoleClaimConflict({
      ...base,
      existingRole: "student",
      roleStatus: "provisional",
      hasLegacyStudentActivity: true,
    }),
    { ok: false, code: "ROLE_CONFLICT_STUDENT" },
  );
  // legacy: role-less row (pre-migration edge) with history
  assert.deepEqual(
    resolveRoleClaimConflict({
      ...base,
      existingRole: null,
      roleStatus: null,
      hasLegacyStudentActivity: true,
    }),
    { ok: false, code: "ROLE_CONFLICT_STUDENT" },
  );
});

test("5. id validity is checked before the role conflict, and nothing is overwritten", () => {
  assert.deepEqual(resolveRoleClaimConflict({ ...base, slotExists: false }), {
    ok: false,
    code: "INVALID_ID",
  });
  assert.deepEqual(resolveRoleClaimConflict({ ...base, slotClaimed: true }), {
    ok: false,
    code: "ID_CLAIMED",
  });
  assert.deepEqual(resolveRoleClaimConflict({ ...base, slotClaimedBySelf: true }), {
    ok: false,
    code: "ALREADY_LECTURER",
  });
  // an established student sees the conflict, not "invalid id", when the id IS valid
  assert.equal(
    resolveRoleClaimConflict({ ...base, existingRole: "student", roleStatus: "established" }).ok,
    false,
  );
});

test("friendlyClaimError surfaces the student-conflict message without the sentinel", () => {
  const raw = `${ROLE_CONFLICT_STUDENT_TOKEN}: This email is already registered as a student account. ...`;
  assert.equal(friendlyClaimError(raw), STUDENT_ACCOUNT_ON_LECTURER_SURFACE_MESSAGE);
  assert.ok(isRoleConflictStudentError(raw));
  assert.equal(friendlyClaimError("Invalid Lecturer ID."), "Invalid Lecturer ID.");
  assert.equal(friendlyClaimError(""), "Could not verify your Lecturer ID.");
  assert.equal(SIGNUP_INTENT_LECTURER, "lecturer");
});

/* ---------------- structural: DB + flows ---------------- */

const migration = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/20260905230000_one_role_per_user.sql", import.meta.url),
  ),
  "utf8",
);
const bootstrap = readFileSync(
  fileURLToPath(new URL("../../supabase/bootstrap_new_project.sql", import.meta.url)),
  "utf8",
);
const signupSrc = readFileSync(
  fileURLToPath(new URL("../routes/signup.tsx", import.meta.url)),
  "utf8",
);
const loginSrc = readFileSync(
  fileURLToPath(new URL("../routes/login.tsx", import.meta.url)),
  "utf8",
);
const callbackSrc = readFileSync(
  fileURLToPath(new URL("../routes/auth.callback.tsx", import.meta.url)),
  "utf8",
);
const authLayoutSrc = readFileSync(
  fileURLToPath(new URL("../routes/_authenticated.tsx", import.meta.url)),
  "utf8",
);
const lecturerLayoutSrc = readFileSync(
  fileURLToPath(new URL("../routes/lecturer.tsx", import.meta.url)),
  "utf8",
);

test("role establishment is EXPLICIT: status column + status-primary claim guard", () => {
  for (const sql of [migration, bootstrap]) {
    assert.match(sql, /status\s+text\s+not null\s+default 'established'/i);
    assert.match(sql, /check \(status in \('provisional', 'established'\)\)/);
    assert.match(sql, /unique \(user_id\)/);

    // handle_new_user: only ever 'student'; lecturer intent -> provisional
    const trg = sql.slice(sql.indexOf("function public.handle_new_user"));
    assert.match(trg, /role\s+='student'|'student',/); // never inserts 'teacher'
    assert.doesNotMatch(trg.slice(0, trg.indexOf("$$;")), /'teacher'/);
    assert.match(trg, /signup_intent'\s*=\s*'lecturer'[\s\S]{0,40}'provisional'/);

    // claim_lecturer_slot: established student rejected purely on status
    const fn = sql.slice(sql.indexOf("function public.claim_lecturer_slot"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    assert.match(
      body,
      /v_role = 'student' and v_status = 'established'[\s\S]{0,160}ROLE_CONFLICT_STUDENT/,
    );
    assert.doesNotMatch(body, /delete from public\.user_roles/i);
    assert.match(body, /update public\.user_roles set role = 'teacher', status = 'established'/);
    // the activity probe is present but AFTER the status check (defensive only)
    assert.ok(
      body.indexOf("v_status = 'established'") < body.indexOf("learning_interactions"),
      "status rule comes before the activity backstop",
    );
  }
});

test("lecturer signup declares intent; the marker only weakens the row", () => {
  assert.match(signupSrc, /signup_intent:\s*"lecturer"/);
  // student signup / Google carry no such marker -> established student
  const studentBlock = signupSrc.slice(signupSrc.indexOf("---- Student signup ----"));
  assert.doesNotMatch(studentBlock, /signup_intent/);
});

test("3b. same-role login: the student path only turns AWAY a lecturer", () => {
  assert.match(loginSrc, /current_lecturer_course[\s\S]{0,200}signOut/);
  assert.match(loginSrc, /LECTURER_ACCOUNT_ON_STUDENT_SURFACE_MESSAGE/);
});

test("4. Google OAuth cannot bypass role ownership", () => {
  assert.match(callbackSrc, /current_lecturer_course/);
  assert.match(callbackSrc, /signOut\(\)/);
  assert.match(callbackSrc, /LECTURER_ACCOUNT_ON_STUDENT_SURFACE_MESSAGE/);
  // OAuth never sends a signup_intent -> a Google user is always an established student
  assert.doesNotMatch(
    readFileSync(
      fileURLToPath(new URL("../components/site/GoogleAuthButton.tsx", import.meta.url)),
      "utf8",
    ),
    /signup_intent/,
  );
});

test("6. direct route navigation still respects the role guards", () => {
  assert.match(authLayoutSrc, /const \{ isLecturer/);
  assert.match(authLayoutSrc, /lecturerMustLeave/);
  assert.match(authLayoutSrc, /navigate\(\{ to: "\/lecturer" \}\)/);
  assert.match(lecturerLayoutSrc, /const \{ isLecturer/);
  assert.match(lecturerLayoutSrc, /navigate\(\{ to: "\/dashboard" \}\)/);
});
