import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/site/GoogleIcon";
import { supabase } from "@/integrations/supabase/client";

/**
 * "Continue with Google" button shared by the sign-in and sign-up pages. Goes
 * straight to Supabase's real Google OAuth flow — no in-app intermediate
 * screen — so the very next thing the browser shows is Google's own account
 * chooser. `/auth/callback` then runs the shared post-auth router. An
 * explicit `redirect` (a deep link) is carried through via sessionStorage
 * (read back by /auth/callback after the redirect completes); with none, the
 * callback decides the destination by role/preferences.
 */
export function GoogleAuthButton({
  label = "Continue with Google",
  redirect,
}: {
  /** Button text, e.g. "Sign up with Google" / "Sign in with Google". */
  label?: string;
  /** Optional in-app deep-link path to land on after the Google round-trip. */
  redirect?: string;
}) {
  const [loading, setLoading] = useState(false);

  // If the user hits Back before completing Google auth, the browser can
  // restore this page from the bfcache instead of reloading it — the whole JS
  // heap (including this component's "loading" state) comes back exactly as
  // it was at the moment `window.location.assign` navigated away, leaving the
  // button stuck on "Opening Google…" forever. `pageshow` fires on both a
  // fresh load and a bfcache restore; `event.persisted` is true only for the
  // restore, which is the one case that needs the reset (a fresh mount already
  // starts with loading=false).
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const start = async () => {
    if (loading) return; // guard against double-clicks during navigation
    setLoading(true);

    const target = redirect?.startsWith("/") ? redirect : undefined;
    // Store the redirect target in sessionStorage before starting the OAuth
    // round-trip so the callback page can read it after the redirect completes.
    // This avoids putting query params in redirectTo, which can cause issues
    // with Supabase's URL validation and fallback to the configured Site URL
    // in production.
    if (target) sessionStorage.setItem("oauth_redirect", target);
    else sessionStorage.removeItem("oauth_redirect");

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // No query params in redirectTo — just the clean callback path.
          redirectTo: `${window.location.origin}/auth/callback`,
          // Always show Google's own account chooser so the user can pick any
          // Google account signed in on this device (instead of Google silently
          // reusing the last one).
          queryParams: { prompt: "select_account" },
          skipBrowserRedirect: true,
        },
      });

      if (error || !data?.url) {
        setLoading(false);
        toast.error(error?.message || "Google sign-in failed");
        return;
      }

      // NOTE: we do NOT fetch-probe the URL. A fetch with `redirect: "manual"`
      // still hits Supabase's /auth/v1/authorize endpoint, which creates and
      // stores the PKCE state on the server. By the time the browser actually
      // navigates to the URL, the state has been consumed — causing a
      // "bad_oauth_state" error on the real redirect. Just assign directly.
      window.location.assign(data.url);
    } catch (err) {
      // A thrown rejection (network failure, etc.) before the redirect could
      // ever happen — same reset as the handled-error path above.
      setLoading(false);
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    }
  };

  return (
    <Button
      variant="outline"
      onClick={start}
      disabled={loading}
      className="w-full rounded-xl h-11 gap-2"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening Google…
        </>
      ) : (
        <>
          <GoogleIcon className="h-4 w-4" />
          {label}
        </>
      )}
    </Button>
  );
}
