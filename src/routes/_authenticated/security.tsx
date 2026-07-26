import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2, LogOut, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fadeUp } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/security")({
  component: SecurityPage,
});

const MIN_PASSWORD = 8;

function SecurityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const lastSignIn = user?.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  const canSave = password.length >= MIN_PASSWORD && password === confirm && !saving;

  const updatePassword = async () => {
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      setPassword("");
      setConfirm("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update password");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      {/* Header */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="flex items-center gap-3"
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm text-muted-foreground">Manage your password and session</p>
          <h1 className="font-display text-4xl leading-tight md:text-5xl">Security &amp; login</h1>
        </div>
      </motion.div>

      {/* Account */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mt-8 overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" /> Email
          </span>
          <span className="truncate text-sm font-medium text-foreground">{user?.email}</span>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-sm text-muted-foreground">Last sign in</span>
          <span className="text-sm font-medium text-foreground">{lastSignIn}</span>
        </div>
      </motion.section>

      {/* Change password */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mt-6 rounded-2xl border border-border bg-card p-6"
      >
        <h2 className="font-display text-xl">Change password</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use at least {MIN_PASSWORD} characters. You'll stay signed in on this device.
        </p>

        <div className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="pr-10"
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
            />
            {confirm.length > 0 && confirm !== password && (
              <p className="text-xs text-destructive">Passwords don't match.</p>
            )}
          </div>

          <Button onClick={updatePassword} disabled={!canSave}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </div>
      </motion.section>

      {/* Session */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mt-6 rounded-2xl border border-border bg-card p-6"
      >
        <h2 className="font-display text-xl">Session</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign out of AceTutor on this device.</p>
        <Button variant="outline" onClick={handleSignOut} className="mt-4">
          <LogOut className="mr-1.5 h-4 w-4" /> Sign out
        </Button>
      </motion.section>
    </main>
  );
}
