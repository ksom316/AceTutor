import { supabase } from "@/integrations/supabase/client";

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
 *   teacher + claimed slot             -> lecturer workspace
 *   student without saved preferences  -> learning-preferences onboarding
 *   genuine deep-link redirect         -> that path
 *   everyone else (returning student)  -> student home  ("/")
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

/**
 * Paths that never count as a genuine deep-link `redirect`:
 *  - auth screens would bounce the user back to a form (or loop);
 *  - "/" and "/dashboard" are generic landing surfaces, not a specific page the
 *    user was trying to reach — the guard synthesises them during sign-out, so
 *    honouring them overrides the "returning student -> home" rule.
 * Everything else (e.g. `/courses/dsa`, `/quiz/…`, `/result/…`) is a real
 * destination and is preserved.
 */
const NON_DEEPLINK_PATHS = new Set([
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/google",
  "/",
  "/dashboard",
]);

/** An in-app `redirect` is honoured only when it is a same-origin path pointing
 *  at a specific page (not an auth screen or a generic landing surface). */
function safeRedirect(redirect: string | null | undefined): string | undefined {
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return undefined;
  const path = redirect.split(/[?#]/)[0];
  if (NON_DEEPLINK_PATHS.has(path)) return undefined;
  return redirect;
}

export type PostAuthReason = "lecturer" | "onboarding" | "redirect" | "student-home";

export type PostAuthDestination = { to: string; reason: PostAuthReason };

export async function resolvePostAuthDestination(
  userId: string,
  redirect?: string | null,
): Promise<PostAuthDestination> {
  const [roleRes, slotRes, prefsRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    // RLS (lecturer_slots_select_own) already scopes this to the caller's slot.
    supabase.from("lecturer_slots").select("course_id").maybeSingle(),
    supabase
      .from("learning_preferences")
      .select("explanation_style, lesson_format, wrong_answer_help")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const role = roleRes.data?.role ?? "student";

  // A claimed lecturer's home is always the lecturer workspace — never student
  // onboarding, never the student home, regardless of any redirect.
  if (role === "teacher" && slotRes.data?.course_id) {
    return { to: LECTURER_HOME, reason: "lecturer" };
  }

  // A student who has never saved a learning preference is sent to onboarding
  // first — this takes precedence over a generic redirect (the completing screen
  // itself offers "Skip for now"). Admins and lecturers are exempt.
  if (role === "student") {
    const p = prefsRes.data;
    const hasPreferences = !!(p?.explanation_style || p?.lesson_format || p?.wrong_answer_help);
    if (!hasPreferences) {
      return { to: PREFERENCES_ONBOARDING, reason: "onboarding" };
    }
  }

  const safe = safeRedirect(redirect);
  if (safe) return { to: safe, reason: "redirect" };

  return { to: STUDENT_HOME, reason: "student-home" };
}
