import { supabase } from "@/integrations/supabase/client";
import { varkOnboardingStatus } from "@/lib/vark";

/**
 * The single source of truth for "where does this freshly-authenticated user
 * go?". Every entry point into an authenticated session — email/password login,
 * email/password signup (immediate session), the email-confirmation callback and
 * the Google OAuth callback — routes through {@link resolvePostAuthDestination}
 * instead of hard-coding its own target, so the decision lives in exactly one
 * place and cannot drift between flows.
 *
 * The decision is read straight from the database (`user_roles` +
 * `lecturer_slots` + `learning_preferences`, all RLS-scoped to the caller) —
 * never from form state, user metadata or the URL, apart from a *genuine* in-app
 * `redirect` deep link (a specific protected page the user was trying to reach).
 *
 *   teacher + claimed slot                -> lecturer workspace
 *   student, no learning_preferences row  -> learning-preferences onboarding
 *   student, prefs done, VARK "pending"   -> VARK Learning Style Check step
 *   genuine deep-link redirect            -> that path
 *   everyone else (returning student)     -> student home  ("/")
 *
 * "Has a learning_preferences row" — not "has non-null preference values" — is
 * the preferences onboarding gate: completing the form and pressing "Skip for
 * now" both leave a row, so a student is asked exactly once and never looped
 * back. The VARK step gate is `varkOnboardingStatus` (src/lib/vark.ts): the
 * prompt shows only while the student has neither completed nor explicitly
 * skipped it, so it too is shown at most once.
 *
 * A `redirect` that merely points at a generic landing surface ("/" or
 * "/dashboard") is NOT treated as a deep link: the `_authenticated` guard plants
 * `?redirect=<current-path>` for any unauthenticated hit on a protected route,
 * including the brief window while the user is signing out from `/dashboard`, so
 * honouring it would send every returning student to `/dashboard` instead of
 * home. Those surfaces are always reachable from the nav, so falling through to
 * role-based routing loses nothing.
 *
 * This helper is only ever called at the *moment of authentication*. Learning
 * preferences stay optional: the route guards do NOT gate on them, so a student
 * who skips onboarding is never trapped or looped back into it.
 */

/** Authenticated student landing page (the home shell, not the public landing). */
export const STUDENT_HOME = "/";
/** Claimed-lecturer workspace. */
export const LECTURER_HOME = "/lecturer";
/** Learning-preferences onboarding. */
export const PREFERENCES_ONBOARDING = "/onboarding/preferences";
/** Optional VARK "Learning Style Check" onboarding step — shown once, after
 *  preferences, until the student completes OR skips it. Never blocks. */
export const VARK_ONBOARDING = "/onboarding/vark";

/**
 * Paths that never count as a genuine deep-link `redirect`:
 *  - auth screens would bounce the user back to a form (or loop);
 *  - "/" and "/dashboard" are generic landing surfaces, not a specific page the
 *    user was trying to reach — the guard synthesises them during sign-out, so
 *    honouring them overrides the "returning student -> home" rule.
 * Everything else (e.g. `/courses/dsa`, `/quiz/…`, `/result/…`) is a real
 * destination and is preserved.
 */
const NON_DEEPLINK_PATHS = new Set(["/login", "/signup", "/auth/callback", "/", "/dashboard"]);

/** An in-app `redirect` is honoured only when it is a same-origin path pointing
 *  at a specific page (not an auth screen or a generic landing surface). */
function safeRedirect(redirect: string | null | undefined): string | undefined {
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return undefined;
  const path = redirect.split(/[?#]/)[0];
  if (NON_DEEPLINK_PATHS.has(path)) return undefined;
  return redirect;
}

export type PostAuthReason =
  | "lecturer"
  | "onboarding"
  | "vark-onboarding"
  | "redirect"
  | "student-home";

export type PostAuthDestination = { to: string; reason: PostAuthReason };

export async function resolvePostAuthDestination(
  userId: string,
  redirect?: string | null,
): Promise<PostAuthDestination> {
  const [roleRes, slotRes, prefsRes, varkRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    // RLS (lecturer_slots_select_own) already scopes this to the caller's slot.
    supabase.from("lecturer_slots").select("course_id").maybeSingle(),
    // Only the row's *existence* matters here: a completed set and a
    // deliberate "Skip for now" both leave a row, and neither should be sent
    // back through onboarding. A missing row means the student has never dealt
    // with it.
    supabase.from("learning_preferences").select("user_id").eq("user_id", userId).maybeSingle(),
    // The optional VARK step. Unlike preferences, "skipped" is tracked with its
    // own column (onboarding_skipped_at) so it can be told apart from "never
    // seen it" — only a genuinely pending student is prompted.
    supabase
      .from("vark_profiles")
      .select("assessment_completed_at, onboarding_skipped_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // Only trust the role when the query actually succeeded. A failed role query
  // (network / RLS / auth not settled) must not let a lecturer fall into the
  // student onboarding gate, nor a student be misclassified.
  const role: string | null = roleRes.error ? null : (roleRes.data?.role ?? "student");

  // A claimed lecturer's home is always the lecturer workspace — never student
  // onboarding, never the student home, regardless of any redirect.
  if (role === "teacher" && slotRes.data?.course_id) {
    return { to: LECTURER_HOME, reason: "lecturer" };
  }

  // Onboarding gate. Send to /onboarding/preferences ONLY when we can positively
  // confirm this is a student who has never dealt with it:
  //   - role query succeeded and says "student", AND
  //   - the learning_preferences probe succeeded (no error) and returned NO row.
  // A query error (RLS hiccup, transient network, auth token not propagated yet)
  // is NEVER read as "no preferences" — that is exactly what was bouncing
  // returning students who had already skipped back into onboarding.
  const prefsRowMissing = !prefsRes.error && prefsRes.data === null;
  if (role === "student" && prefsRowMissing) {
    return { to: PREFERENCES_ONBOARDING, reason: "onboarding" };
  }

  // VARK "Learning Style Check" — the optional step after preferences. Prompt a
  // student ONCE: preferences done (row present, above), the VARK probe
  // succeeded, and the student has neither completed nor skipped it. A probe
  // error is never read as "pending" (same rule as the preferences probe), so a
  // transient failure can't loop a returning student back into onboarding.
  if (
    role === "student" &&
    !prefsRowMissing &&
    !prefsRes.error &&
    !varkRes.error &&
    varkOnboardingStatus(varkRes.data ?? null) === "pending"
  ) {
    return { to: VARK_ONBOARDING, reason: "vark-onboarding" };
  }

  const safe = safeRedirect(redirect);
  if (safe) return { to: safe, reason: "redirect" };

  return { to: STUDENT_HOME, reason: "student-home" };
}
