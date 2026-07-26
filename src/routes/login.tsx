import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { toast } from "sonner";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { GoogleAuthButton } from "@/components/site/GoogleAuthButton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import logoAsset from "@/assets/ace-logo.jpg";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "At least 6 characters").max(72),
});

type LoginSearch = {
  redirect?: string;
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user } = useAuth();
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Send the user back to wherever they were headed (e.g. a quiz page),
  // falling back to the dashboard.
  const target = redirect?.startsWith("/") ? redirect : "/dashboard";

  useEffect(() => {
    if (user) navigate({ to: target });
  }, [user, navigate, target]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) toast.error(error.message);
    else navigate({ to: target });
  };

  const forgotPassword = async () => {
    const parsed = z.string().trim().email().safeParse(email);
    if (!parsed.success) {
      toast.error("Enter your email above first, then tap Forgot Password");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: window.location.origin + "/login",
    });
    if (error) toast.error(error.message);
    else toast.success("Password reset link sent — check your inbox");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Ambient gradient glow */}
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
          <h1 className="mt-6 font-display text-3xl font-bold">
            Welcome to <span className="text-primary">AceTutor</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to your organization or teacher workspace
          </p>
        </motion.div>

        <motion.div
          variants={staggerItem}
          className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
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
                  className="pl-9 rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={72}
                  className="pl-9 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={forgotPassword}
                className="text-sm font-medium hover:underline"
              >
                Forgot Password
              </button>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl h-11 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-semibold shadow-md"
            >
              {loading ? (
                "Signing in…"
              ) : (
                <span className="inline-flex items-center gap-2">
                  Sign in <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <GoogleAuthButton label="Sign in with Google" redirect={target} />
        </motion.div>

        <motion.p variants={staggerItem} className="mt-6 text-center text-sm text-muted-foreground">
          New to AceTutor?{" "}
          <Link to="/signup" className="font-semibold text-primary hover:underline">
            Create a free student account
          </Link>
        </motion.p>
      </motion.div>
    </main>
  );
}
