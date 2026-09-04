import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { staggerContainer, staggerItem } from "@/lib/motion";
import logoAsset from "@/assets/ace-logo.jpg";

// Consistent with the signup flow (src/routes/signup.tsx).
const passwordSchema = z.string().min(6, "Use at least 6 characters").max(72);

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

type Phase = "verifying" | "ready" | "invalid" | "updating" | "success";

/**
 * Public landing page for a Supabase password-recovery link. The client has
 * `detectSessionInUrl: true` + `flowType: "pkce"`, so it exchanges the `?code=`
 * on load and emits `PASSWORD_RECOVERY` / `SIGNED_IN`. We wait for that (or an
 * already-present session), then let the user set a new password via
 * `updateUser`. A tampered/expired link never produces a session → "invalid".
 *
 * PKCE note: the recovery link only works in the same browser that requested it
 * (the code verifier lives in that browser's localStorage).
 */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    const settle = (next: Phase, err?: string) => {
      if (settled.current) return;
      settled.current = true;
      if (err) setLinkError(err);
      setPhase(next);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) settle("ready");
    });

    // An error can come back in the query string or the hash fragment.
    const qs = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const urlError =
      qs.get("error_description") ||
      hash.get("error_description") ||
      qs.get("error") ||
      hash.get("error");
    const hasCode = qs.has("code") || hash.has("access_token");

    if (urlError) {
      settle("invalid", urlError);
    } else {
      // Maybe the session is already established (event fired before this mount,
      // or the user is simply signed in). Otherwise give the PKCE exchange a
      // moment; if nothing arrives and there was no code to exchange, the link
      // is invalid.
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) settle("ready");
        else if (!hasCode) settle("invalid", "This password reset link is invalid or has expired.");
      });
      const t = setTimeout(() => {
        supabase.auth.getSession().then(({ data }) => {
          if (data.session) settle("ready");
          else settle("invalid", "This password reset link is invalid or has expired.");
        });
      }, 4000);
      return () => {
        clearTimeout(t);
        sub.subscription.unsubscribe();
      };
    }

    return () => sub.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0].message);
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      return;
    }
    setPhase("updating");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPhase("ready");
      setFormError(error.message || "Couldn't update your password. Try requesting a new link.");
      return;
    }
    setPhase("success");
    // Force a clean sign-in with the new password.
    await supabase.auth.signOut();
    toast.success("Password updated — please sign in.");
    setTimeout(() => navigate({ to: "/login", replace: true }), 1200);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="absolute inset-x-0 top-0 -z-10 h-[480px] [background:radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]" />
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="w-full max-w-md"
      >
        <motion.div variants={staggerItem} className="flex flex-col items-center text-center">
          <div className="flex items-center gap-3">
            <img
              src={logoAsset}
              alt="AceTutor"
              width={44}
              height={44}
              className="rounded-xl object-contain shadow-sm"
            />
            <span className="text-2xl font-bold tracking-tight">AceTutor</span>
          </div>
          <h1 className="mt-6 font-display text-3xl font-bold">Choose a new password</h1>
        </motion.div>

        <motion.div
          variants={staggerItem}
          className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          {phase === "verifying" && (
            <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" /> Verifying your reset link…
            </div>
          )}

          {phase === "invalid" && (
            <div className="text-center">
              <p className="text-sm text-destructive">
                {linkError ?? "This password reset link is invalid or has expired."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Reset links expire after a short while and only work in the browser that requested
                them. Request a fresh one to continue.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <Button asChild className="h-11 w-full rounded-xl">
                  <Link to="/forgot-password">Request a new link</Link>
                </Button>
                <Button asChild variant="ghost" className="h-10 w-full rounded-xl">
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </div>
            </div>
          )}

          {phase === "success" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <p className="text-sm text-muted-foreground">
                Password updated. Taking you to sign in…
              </p>
            </div>
          )}

          {(phase === "ready" || phase === "updating") && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                    maxLength={72}
                    className="rounded-xl px-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                  maxLength={72}
                  className="rounded-xl"
                />
              </div>
              {formError && <p className="text-xs text-destructive">{formError}</p>}
              <Button
                type="submit"
                disabled={phase === "updating"}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-primary to-primary/80 font-semibold text-primary-foreground shadow-md"
              >
                {phase === "updating" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…
                  </>
                ) : (
                  "Update password"
                )}
              </Button>
              <Link
                to="/login"
                className="block text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </motion.div>
      </motion.div>
    </main>
  );
}
