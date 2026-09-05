import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { resolvePostAuthDestination } from "@/lib/post-auth-redirect";
import { LECTURER_ACCOUNT_ON_STUDENT_SURFACE_MESSAGE } from "@/lib/cross-role-auth";

type CallbackSearch = {
  redirect?: string;
};

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: AuthCallback,
});

/**
 * Public landing page for the OAuth redirect. Google sends the browser here with
 * a `?code=` (PKCE) or `#access_token=` (implicit) fragment. The Supabase client
 * has `detectSessionInUrl: true`, so it exchanges those for a session on load and
 * fires SIGNED_IN, which `use-auth` picks up. We just wait for that here — unlike
 * the protected routes, this page never bounces to /login mid-exchange, so the
 * auth params are never dropped.
 *
 * IMPORTANT: With PKCE flow, the code exchange happens asynchronously on page
 * load. The `useAuth()` hook may resolve to `{ user: null, loading: false }`
 * before Supabase has finished exchanging the code — particularly in production
 * where network latency is higher. We must manually check `getSession()` after
 * a short delay before concluding that the exchange failed.
 */
function AuthCallback() {
  const { user, loading } = useAuth();
  const { redirect: searchRedirect } = Route.useSearch();
  const navigate = useNavigate();
  const settled = useRef(false);

  useEffect(() => {
    if (loading || settled.current) return;

    if (user) {
      settled.current = true;
      void syncProfileAndNavigate(user, searchRedirect, navigate);
      return;
    }

    // loading=false, user=null at this point. This could mean:
    // 1. The PKCE code exchange hasn't finished yet (common in production).
    // 2. There is no code in the URL — we arrived here directly (unlikely
    //    but handle gracefully).
    // 3. The exchange genuinely failed.
    //
    // Check if there's a ?code= in the URL, which means exchange is ongoing.
    // Errors can arrive in the query string OR the hash fragment depending on
    // the flow (PKCE vs implicit), so check both.
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasCode = urlParams.has("code") || hashParams.has("access_token");
    const hasError = urlParams.has("error") || hashParams.has("error");

    if (hasError) {
      settled.current = true;
      const description =
        urlParams.get("error_description") ||
        hashParams.get("error_description") ||
        urlParams.get("error") ||
        hashParams.get("error");
      toast.error(description || "Google sign-in failed. Please try again.");
      navigate({ to: "/login", replace: true });
      return;
    }

    if (hasCode) {
      // There's a code in the URL but no user yet — Supabase is still
      // exchanging it. Wait for a bit and check getSession() directly.
      void waitForSessionAndNavigate(navigate, searchRedirect, settled);
      return;
    }

    // No code in URL, no user — shouldn't normally reach here via OAuth.
    settled.current = true;
    navigate({ to: "/login", replace: true });
  }, [user, loading, searchRedirect, navigate]);

  // No "error description" spinner here — the existing spinner matches the UI.
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Signing you in…
      </div>
    </div>
  );
}

/**
 * Wait for the PKCE code exchange to complete by polling getSession().
 * Once a session is found, route the user appropriately.
 * If no session appears after 15 seconds, show an error.
 */
async function waitForSessionAndNavigate(
  navigate: ReturnType<typeof useNavigate>,
  searchRedirect: string | undefined,
  settled: { current: boolean },
) {
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    // The Supabase client needs a microtask/macrotask boundary to process
    // the URL fragment. Wait 1 second between checks.
    await new Promise((r) => setTimeout(r, 1000));

    if (settled.current) return; // another path already handled it

    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      settled.current = true;
      await syncProfileAndNavigate(data.session.user, searchRedirect, navigate);
      return;
    }
  }

  if (settled.current) return;
  settled.current = true;

  // Check for error params that may have appeared (denied consent etc.)
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const description =
    params.get("error_description") ||
    hash.get("error_description") ||
    params.get("error") ||
    hash.get("error");
  toast.error(description || "Google sign-in timed out. Please try again.");
  navigate({ to: "/login", replace: true });
}

/**
 * Sync the Google profile info (name, avatar) into the database, then hand off
 * to the shared post-auth router: a claimed lecturer lands in their workspace, a
 * first-time student in learning-preferences onboarding, and an explicit in-app
 * redirect (or the student home) wins for everyone else.
 */
async function syncProfileAndNavigate(
  user: NonNullable<ReturnType<typeof useAuth>["user"]>,
  searchRedirect: string | undefined,
  navigate: ReturnType<typeof useNavigate>,
) {
  // OAuth is a STUDENT-surface flow (the "Continue with Google" button is only
  // shown on the student sign-in/up card). One identity = one role: if this
  // account is a claimed lecturer, stop here — it must sign in with the
  // Lecturer option, not Google.
  const { data: lecturerCourse } = await supabase.rpc("current_lecturer_course");
  if (lecturerCourse) {
    await supabase.auth.signOut();
    toast.error(LECTURER_ACCOUNT_ON_STUDENT_SURFACE_MESSAGE);
    navigate({ to: "/login", replace: true });
    return;
  }

  const meta = user.user_metadata ?? {};
  const googleName = meta.full_name || meta.name;
  const googleAvatar = meta.avatar_url || meta.picture;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  // Fill in anything the profile is missing from the Google account.
  const patch: { full_name?: string; avatar_url?: string } = {};
  if (googleName && (!profile?.full_name || profile.full_name === user.email))
    patch.full_name = googleName;
  if (googleAvatar && !profile?.avatar_url) patch.avatar_url = googleAvatar;
  if (Object.keys(patch).length) {
    await supabase.from("profiles").update(patch).eq("id", user.id);
  }

  // Determine the redirect target: sessionStorage > URL param > fallback.
  const storedRedirect = sessionStorage.getItem("oauth_redirect");
  sessionStorage.removeItem("oauth_redirect");

  const redirectTarget =
    storedRedirect && storedRedirect.startsWith("/")
      ? storedRedirect
      : searchRedirect?.startsWith("/")
        ? searchRedirect
        : undefined;

  // Role- and preference-aware routing lives in one shared place so the Google
  // flow, the email-confirmation flow and password login can never diverge.
  const dest = await resolvePostAuthDestination(user.id, redirectTarget);

  navigate({ to: dest.to, replace: true });
}
