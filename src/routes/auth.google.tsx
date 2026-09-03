import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GoogleIcon } from "@/components/site/GoogleIcon";

type GoogleSearch = {
  redirect?: string;
};

export const Route = createFileRoute("/auth/google")({
  validateSearch: (search: Record<string, unknown>): GoogleSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: GoogleAccountPicker,
});

/**
 * Demo "Choose an account" page mirroring Google's OAuth chooser, styled with
 * the app's tokens. Picking a demo account signs into Supabase directly
 * (creating the account on first use, like real OAuth), then hands off to
 * /auth/callback which syncs the profile and sends the user to their redirect
 * target (the Home page by default). "Use another account" falls back to the
 * real Google OAuth flow.
 */
const DEMO_PASSWORD = "acetutor-google-demo-2026";

const DEMO_ACCOUNTS = [
  {
    name: "Jane Doe",
    email: "jane.doe.demo@gmail.com",
    hue: "bg-primary",
  },
  {
    name: "Alex Mensah",
    email: "alex.mensah.demo@gmail.com",
    hue: "bg-[oklch(0.66_0.17_330)]",
  },
] as const;

function GoogleAccountPicker() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const target = redirect?.startsWith("/") ? redirect : "/dashboard";

  const pick = async (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    if (busy) return;
    setBusy(acc.email);

    // Mirror real OAuth semantics: sign in if the account exists, otherwise
    // create it on the spot carrying the "Google" profile info along.
    let { error } = await supabase.auth.signInWithPassword({
      email: acc.email,
      password: DEMO_PASSWORD,
    });
    if (error) {
      const signUp = await supabase.auth.signUp({
        email: acc.email,
        password: DEMO_PASSWORD,
        options: { data: { full_name: acc.name } },
      });
      error = signUp.error;
    }

    if (error) {
      setBusy(null);
      toast.error(error.message || "Could not sign in with this account");
      return;
    }
    // /auth/callback syncs the profile and sends the user to `target`.
    navigate({ to: "/auth/callback", search: { redirect: target }, replace: true });
  };

  const useAnotherAccount = async () => {
    if (busy) return;
    setBusy("oauth");

    // Store the redirect target in sessionStorage before starting the OAuth
    // round-trip so the callback page can read it after the redirect completes.
    // This avoids putting query params in the redirectTo URL, which can cause
    // issues with Supabase's URL validation and fallback to the configured
    // Site URL in production.
    sessionStorage.setItem("oauth_redirect", target);

    const redirectOrigin = window.location.origin;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // No query params in redirectTo — just the clean callback path.
        redirectTo: `${redirectOrigin}/auth/callback`,
        // Always show Google's own account chooser so the user can pick any
        // Google account signed in on this device (instead of Google silently
        // reusing the last one).
        queryParams: { prompt: "select_account" },
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      setBusy(null);
      toast.error(error?.message || "Google sign-in failed");
      return;
    }

    // NOTE: we do NOT fetch-probe the URL. A fetch with `redirect: "manual"`
    // still hits Supabase's /auth/v1/authorize endpoint, which creates and
    // stores the PKCE state on the server. By the time the browser actually
    // navigates to the URL, the state has been consumed — causing a
    // "bad_oauth_state" error on the real redirect. Just assign directly.
    window.location.assign(data.url);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Ambient gradient glow, matching the login/signup pages */}
      <div className="absolute inset-x-0 top-0 -z-10 h-[480px] [background:radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          {/* Google header */}
          <div className="flex flex-col items-center text-center">
            <GoogleIcon className="h-9 w-9" />
            <h1 className="mt-4 font-display text-2xl font-semibold">Choose an account</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              to continue to <span className="font-medium text-primary">AceTutor</span>
            </p>
          </div>

          {/* Account list */}
          <ul className="mt-8 divide-y divide-border/60 border-y border-border/60">
            {DEMO_ACCOUNTS.map((acc) => (
              <li key={acc.email}>
                <button
                  type="button"
                  onClick={() => pick(acc)}
                  disabled={!!busy}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-secondary disabled:opacity-60"
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-primary-foreground ${acc.hue}`}
                  >
                    {acc.name[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{acc.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {acc.email}
                    </span>
                  </span>
                  {busy === acc.email && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={useAnotherAccount}
                disabled={!!busy}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-secondary disabled:opacity-60"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground">
                  {busy === "oauth" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                </span>
                <span className="text-sm font-medium">Use another account</span>
              </button>
            </li>
          </ul>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            To continue, Google will share your name, email address and profile picture with
            AceTutor. Before using this app, review AceTutor's{" "}
            <a href="/privacy" className="font-medium text-primary hover:underline">
              privacy policy
            </a>{" "}
            and{" "}
            <a href="/terms" className="font-medium text-primary hover:underline">
              terms of service
            </a>
            .
          </p>
        </div>

        {/* Footer strip, echoing Google's chooser */}
        <div className="mt-4 flex items-center justify-between px-2 text-xs text-muted-foreground">
          <span>English (US)</span>
          <div className="flex gap-4">
            <a href="/contact" className="hover:text-foreground">
              Help
            </a>
            <a href="/privacy" className="hover:text-foreground">
              Privacy
            </a>
            <a href="/terms" className="hover:text-foreground">
              Terms
            </a>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
