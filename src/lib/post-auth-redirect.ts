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
 * never from form state, user metadata or the URL, apart from an explicit in-app
 * `redirect` deep link.
 *
 *   teacher + claimed slot            -> lecturer workspace
 *   student without saved preferences -> learning-preferences onboarding
 *   explicit in-app redirect          -> that path
 *   everyone else (student / admin)   -> student home
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

/** Auth screens can never be a post-auth landing target — that would bounce the
 *  user straight back to a form (or loop). */
const NON_LANDING_PATHS = new Set(["/login", "/signup", "/auth/callback", "/auth/google"]);

/** An in-app `redirect` is honoured only when it is a same-origin path that is
 *  not itself an auth screen. */
function safeRedirect(redirect: string | null | undefined): string | undefined {
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return undefined;
  const path = redirect.split(/[?#]/)[0];
  if (NON_LANDING_PATHS.has(path)) return undefined;
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
