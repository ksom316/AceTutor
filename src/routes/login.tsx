import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { z } from "zod";
import { toast } from "sonner";
import { Mail, Lock, ArrowRight, User, GraduationCap, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { verifyLecturerLogin } from "@/lib/lecturer-claim";
import { resolvePostAuthDestination } from "@/lib/post-auth-redirect";
import { GoogleAuthButton } from "@/components/site/GoogleAuthButton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import logoAsset from "@/assets/ace-logo.jpg";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "At least 6 characters").max(72),
});

type AccountType = "student" | "lecturer";

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
  const { loading: roleLoading } = useRole();
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [accountType, setAccountType] = useState<AccountType>("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lecturerId, setLecturerId] = useState("");
  const [loading, setLoading] = useState(false);
  // Set when a sign-in attempt fails specifically because the email has not been
  // confirmed yet — drives the inline "resend confirmation" notice below.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // Once a submit has taken over routing, the "already signed in" effect below
  // must stand down so it can't fight onSubmit's own navigation / sign-out.
  const submittedRef = useRef(false);
  // Guards the async "already signed in" effect so it navigates at most once.
  const routedRef = useRef(false);

  // Already signed in (e.g. hit /login directly) → hand off to the shared
  // post-auth router (role- and preference-aware, one decision for every flow).
  useEffect(() => {
    if (submittedRef.current || routedRef.current || !user || roleLoading) return;
    routedRef.current = true;
    void resolvePostAuthDestination(user.id, redirect).then((dest) => {
      if (!submittedRef.current) navigate({ to: dest.to, replace: true });
    });
  }, [user, roleLoading, redirect, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (accountType === "lecturer" && !lecturerId.trim()) {
      toast.error("Enter your Lecturer ID");
      return;
    }

    submittedRef.current = true;
    setLoading(true);

    const { data: signIn, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !signIn.user) {
      submittedRef.current = false;
      setLoading(false);
      // Supabase reports an unconfirmed email as its own error — surface that
      // clearly instead of a misleading "invalid credentials" message.
      const notConfirmed =
        error?.code === "email_not_confirmed" ||
        /email not confirmed|confirm your email/i.test(error?.message ?? "");
      if (notConfirmed) {
        setUnconfirmedEmail(parsed.data.email);
        toast.error(
          "Please confirm your email before signing in. Check your inbox for the activation link.",
        );
      } else {
        toast.error(error?.message ?? "Could not sign in.");
      }
      return;
    }
    setUnconfirmedEmail(null);
    const userId = signIn.user.id;

    if (accountType === "lecturer") {
      // The typed Lecturer ID proves nothing by itself — this checks that the
      // authenticated account actually owns that slot (RLS) and holds the
      // teacher role. Never redirects a non-owner into /lecturer.
      const verified = await verifyLecturerLogin(userId, lecturerId);
      if (!verified) {
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("Lecturer ID does not match this account.");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["user-role"] });
      setLoading(false);
      navigate({ to: "/lecturer" });
      return;
    }

    // Student sign-in. A genuine student is never a lecturer, so this is a
    // no-op for them; a lecturer account using the Student option is turned
    // away rather than routed into the lecturer interface.
    const { data: lecturerCourse } = await supabase.rpc("current_lecturer_course");
    if (lecturerCourse) {
      await supabase.auth.signOut();
      setLoading(false);
      toast.error(
        "This is a lecturer account — sign in with the Lecturer option and your Lecturer ID.",
      );
      return;
    }
    await qc.invalidateQueries({ queryKey: ["user-role"] });
    const dest = await resolvePostAuthDestination(userId, redirect);
    setLoading(false);
    navigate({ to: dest.to });
  };

  const resendConfirmation = async () => {
    if (!unconfirmedEmail || resending) return;
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: unconfirmedEmail,
      options: { emailRedirectTo: window.location.origin + "/auth/callback" },
    });
    setResending(false);
    if (error) toast.error(error.message);
    else toast.success("Confirmation email sent — check your inbox.");
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
            {accountType === "lecturer"
              ? "Sign in with your email, password and Lecturer ID"
              : "Sign in to your student workspace"}
          </p>
        </motion.div>

        <motion.div
          variants={staggerItem}
          className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              I am signing in as
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              {(["student", "lecturer"] as AccountType[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAccountType(option)}
                  aria-pressed={accountType === option}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    accountType === option
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option === "student" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <GraduationCap className="h-4 w-4" />
                  )}
                  {option === "student" ? "Student" : "Lecturer"}
                </button>
              ))}
            </div>
          </div>

          {unconfirmedEmail && (
            <div className="mb-5 rounded-xl border border-border bg-muted/40 p-4">
              <p className="flex items-start gap-2 text-sm">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  Please confirm your email before signing in. We sent an activation link to{" "}
                  <span className="font-medium text-foreground">{unconfirmedEmail}</span>.
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={resendConfirmation}
                disabled={resending}
                className="mt-3 h-10 w-full rounded-lg"
              >
                {resending ? "Sending…" : "Resend confirmation email"}
              </Button>
            </div>
          )}

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
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (unconfirmedEmail) setUnconfirmedEmail(null);
                  }}
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

            {accountType === "lecturer" && (
              <div className="space-y-1.5">
                <label
                  htmlFor="lecturerId"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Lecturer ID
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="lecturerId"
                    placeholder="LECT-001"
                    value={lecturerId}
                    onChange={(e) => setLecturerId(e.target.value)}
                    required
                    maxLength={20}
                    autoComplete="off"
                    className="pl-9 rounded-xl uppercase"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-sm font-medium hover:underline">
                Forgot password?
              </Link>
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

          {accountType === "student" && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or{" "}
                <span className="h-px flex-1 bg-border" />
              </div>
              <GoogleAuthButton label="Sign in with Google" redirect={redirect} />
            </>
          )}
        </motion.div>

        <motion.p variants={staggerItem} className="mt-6 text-center text-sm text-muted-foreground">
          New to AceTutor?{" "}
          <Link to="/signup" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </motion.p>
      </motion.div>
    </main>
  );
}
