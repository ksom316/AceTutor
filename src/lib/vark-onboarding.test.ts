/**
 * `varkOnboardingStatus` — the single rule for whether the optional VARK
 * "Learning Style Check" onboarding prompt should still be shown. Used by
 * post-auth-redirect.ts, the onboarding routes and the Profile page.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/vark-onboarding.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { varkOnboardingStatus } from "@/lib/vark";

const T = "2026-09-09T10:00:00.000Z";

test("no row → pending", () => {
  assert.equal(varkOnboardingStatus(null), "pending");
});

test("row with both timestamps null → pending", () => {
  assert.equal(
    varkOnboardingStatus({ assessment_completed_at: null, onboarding_skipped_at: null }),
    "pending",
  );
});

test("assessment completed → completed", () => {
  assert.equal(
    varkOnboardingStatus({ assessment_completed_at: T, onboarding_skipped_at: null }),
    "completed",
  );
});

test("skipped only → skipped", () => {
  assert.equal(
    varkOnboardingStatus({ assessment_completed_at: null, onboarding_skipped_at: T }),
    "skipped",
  );
});

test("completion wins over a prior skip", () => {
  assert.equal(
    varkOnboardingStatus({ assessment_completed_at: T, onboarding_skipped_at: T }),
    "completed",
  );
});
