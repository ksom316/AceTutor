import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { staggerContainer, staggerItem } from "@/lib/motion";
import logoAsset from "@/assets/ace-logo.jpg";

const emailSchema = z.string().trim().email("Enter a valid email").max(255);

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

/**
 * Public "send me a reset link" page. Uses Supabase Auth
 * `resetPasswordForEmail` with a redirect to `/reset-password`. The response is
 * never surfaced — whatever happens, the same neutral panel is shown so the page
 * cannot be used to probe which emails have accounts.
 */
function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return;
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch (err) {
      // Deliberately swallowed — a transport error must not reveal anything
      // about the address either. Logged for the operator only.
      console.error("[forgot-password] resetPasswordForEmail failed:", err);
    } finally {
      setLoading(false);
      setSent(true);
    }
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
          <h1 className="mt-6 font-display text-3xl font-bold">Reset your password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {sent
              ? "Check your inbox for the next step."
              : "Enter your account email and we'll send you a reset link."}
          </p>
        </motion.div>

        <motion.div
          variants={staggerItem}
          className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          {sent ? (
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <MailCheck className="h-6 w-6" />
              </span>
              <p className="mt-4 text-sm text-muted-foreground">
                If an account exists for this email, password reset instructions have been sent. The
                link opens on this device and expires after a short while.
              </p>
              <Button asChild className="mt-5 h-11 w-full rounded-xl">
                <Link to="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@school.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={255}
                    className="rounded-xl pl-9"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-primary to-primary/80 font-semibold text-primary-foreground shadow-md"
              >
                {loading ? "Sending…" : "Send reset link"}
              </Button>
              <Link
                to="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </form>
          )}
        </motion.div>
      </motion.div>
    </main>
  );
}
