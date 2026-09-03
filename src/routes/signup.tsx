import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { z } from "zod";
import { toast } from "sonner";
import { Mail, Lock, User, ArrowRight, GraduationCap, KeyRound, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { claimLecturerSlot, stashPendingLecturerId } from "@/lib/lecturer-claim";
import { resolvePostAuthDestination } from "@/lib/post-auth-redirect";
import { GoogleAuthButton } from "@/components/site/GoogleAuthButton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import logoAsset from "@/assets/ace-logo.jpg";

const baseSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "At least 6 characters").max(72),
});
const lecturerSchema = baseSchema.extend({
  lecturerId: z.string().trim().min(1, "Enter your Lecturer ID").max(20),
});

type AccountType = "student" | "lecturer";
type IdStatus = "idle" | "checking" | "available" | "claimed" | "invalid";

type SignupSearch = {
  redirect?: string;
  role?: AccountType;
};

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): SignupSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    role: search.role === "lecturer" ? "lecturer" : undefined,
  }),
  component: SignupPage,
});

function SignupPage() {
  const { user } = useAuth();
  const { loading: roleLoading } = useRole();
  const { redirect, role } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [accountType, setAccountType] = useState<AccountType>(role ?? "student");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lecturerId, setLecturerId] = useState("");
  const [idStatus, setIdStatus] = useState<IdStatus>("idle");
  const [loading, setLoading] = useState(false);
  // When email confirmation is enabled, signUp returns no session — we then show
  // a "check your email" panel instead of navigating anywhere.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // Once a submit has taken over routing, the "already signed in" effect must
  // stand down so it can't fight onSubmit's own navigation.
  const submittedRef = useRef(false);
  const routedRef = useRef(false);

  // Already signed in (or an immediate-session signup just completed) → hand off
  // to the shared post-auth router (role- and preference-aware).
  useEffect(() => {
    if (submittedRef.current || routedRef.current || !user || roleLoading || pendingEmail) return;
    routedRef.current = true;
    void resolvePostAuthDestination(user.id, redirect).then((dest) => {
      if (!submittedRef.current) navigate({ to: dest.to, replace: true });
    });
  }, [user, roleLoading, redirect, navigate, pendingEmail]);

  // Debounced availability feedback for the Lecturer ID. UX only — the real
  // check is claim_lecturer_slot() on submit.
  useEffect(() => {
    if (accountType !== "lecturer") {
      setIdStatus("idle");
      return;
    }
    const value = lecturerId.trim();
    if (!value) {
      setIdStatus("idle");
      return;
    }
    setIdStatus("checking");
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("lecturer_id_available", {
        _lecturer_id: value,
      });
      if (error) {
        setIdStatus("idle");
        return;
      }
      setIdStatus(
        data === "available" ? "available" : data === "claimed" ? "claimed" : "invalid",
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [lecturerId, accountType]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (accountType === "lecturer") {
      const parsed = lecturerSchema.safeParse({ fullName, email, password, lecturerId });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0].message);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: window.location.origin + "/lecturer",
          data: { full_name: parsed.data.fullName },
        },
      });
      if (error) {
        setLoading(false);
        const dup = /already|registered|exists/i.test(error.message);
        toast.error(
          dup
            ? "An account with this email already exists. Sign in with the Lecturer option to finish setup."
            : error.message,
        );
        if (dup) {
          stashPendingLecturerId(parsed.data.lecturerId);
          navigate({ to: "/login" });
        }
        return;
      }

      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setLoading(false);
        stashPendingLecturerId(parsed.data.lecturerId);
        toast.error(
          "An account with this email already exists. Sign in with the Lecturer option to finish setup.",
        );
        navigate({ to: "/login" });
        return;
      }

      if (data.session) {
        const result = await claimLecturerSlot(parsed.data.lecturerId);
        setLoading(false);
        if (result.status !== "claimed") {
          toast.error(
            result.status === "failed"
              ? result.message
              : "Could not verify your Lecturer ID.",
          );
          return; // account exists as a student; no lecturer privileges granted
        }
        submittedRef.current = true;
        await qc.invalidateQueries({ queryKey: ["user-role"] });
        toast.success("Lecturer account created — welcome!");
        navigate({ to: "/lecturer", replace: true });
        return;
      }

      // Email confirmation required: keep the ID for the post-confirmation claim.
      stashPendingLecturerId(parsed.data.lecturerId);
      setLoading(false);
      toast.success(
        "Account created — confirm your email, then sign in to finish lecturer setup.",
      );
      navigate({ to: "/login" });
      return;
    }

    // ---- Student signup ----
    const parsed = baseSchema.safeParse({ fullName, email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        // Land the confirmation link on the shared callback so the same
        // role/preference-aware router runs after the email is verified.
        emailRedirectTo: window.location.origin + "/auth/callback",
        data: { full_name: parsed.data.fullName },
      },
    });
    if (error) {
      setLoading(false);
      // One person = one AceTutor account. If the email is already registered
      // (possibly via Google), don't create parallel application data — point
      // them at sign-in instead.
      const dup = /already|registered|exists/i.test(error.message);
      toast.error(
        dup
          ? "An account with this email already exists. Please sign in — if you first used Google, choose “Continue with Google”."
          : error.message,
      );
      if (dup) navigate({ to: "/login", search: redirect ? { redirect } : {} });
      return;
    }

    // Supabase returns a user with an empty `identities` array (and no error, no
    // session) when the email already exists — an anti-enumeration signal. Treat
    // it the same way: never silently create a duplicate profile.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setLoading(false);
      toast.error(
        "An account with this email already exists. Please sign in — if you first used Google, choose “Continue with Google”.",
      );
      navigate({ to: "/login", search: redirect ? { redirect } : {} });
      return;
    }

    if (data.session) {
      // Email confirmation disabled — the session is live now. Route via the
      // shared helper (a brand-new student → learning-preferences onboarding).
      submittedRef.current = true;
      await qc.invalidateQueries({ queryKey: ["user-role"] });
      const dest = await resolvePostAuthDestination(data.session.user.id, redirect);
      setLoading(false);
      toast.success("Account created — let's get started!");
      navigate({ to: dest.to, replace: true });
      return;
    }

    // Email confirmation enabled — no session yet. Show the "check your email"
    // panel; the confirmation link resumes the flow at /auth/callback.
    setLoading(false);
    setPendingEmail(parsed.data.email);
  };

  const resendConfirmation = async () => {
    if (!pendingEmail || resending) return;
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: window.location.origin + "/auth/callback" },
    });
    setResending(false);
    if (error) toast.error(error.message);
    else toast.success("Confirmation email sent again — check your inbox.");
  };

  const idHint: Record<IdStatus, { text: string; className: string } | null> = {
    idle: null,
    checking: { text: "Checking…", className: "text-muted-foreground" },
    available: { text: "Valid Lecturer ID", className: "text-success" },
    claimed: { text: "This Lecturer ID has already been claimed", className: "text-destructive" },
    invalid: { text: "Invalid Lecturer ID", className: "text-destructive" },
  };
  const hint = idHint[idStatus];

  // Email confirmation is enabled: signup succeeded but there is no session yet.
  // Show an explicit "check your email" screen so it never looks like a failure.
  if (pendingEmail) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
        <div className="absolute inset-x-0 top-0 -z-10 h-[480px] [background:radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <MailCheck className="h-6 w-6" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your AceTutor account was created. We sent a confirmation link to{" "}
              <span className="font-medium text-foreground">{pendingEmail}</span>. Click it to
              activate your account, then sign in.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Can&apos;t find it? Check your spam folder, or resend the link below.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={resendConfirmation}
                disabled={resending}
                className="w-full rounded-xl h-11"
              >
                {resending ? "Sending…" : "Resend confirmation email"}
              </Button>
              <Button asChild variant="ghost" className="w-full rounded-xl h-11">
                <Link to="/login">Back to sign in</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </main>
    );
  }

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
            Join <span className="text-primary">AceTutor</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {accountType === "lecturer"
              ? "Create your lecturer account with your assigned Lecturer ID"
              : "Create your free student account in under a minute"}
          </p>
        </motion.div>

        <motion.div
          variants={staggerItem}
          className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              I am signing up as
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

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label
                htmlFor="fullName"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Full name
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="fullName"
                  placeholder="Jane Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  maxLength={100}
                  className="pl-9 rounded-xl"
                />
              </div>
            </div>
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
                {hint && <p className={`text-xs ${hint.className}`}>{hint.text}</p>}
                <p className="text-[11px] text-muted-foreground">
                  Your course is determined by your Lecturer ID and can&apos;t be changed.
                </p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl h-11 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-semibold shadow-md"
            >
              {loading ? (
                "Creating account…"
              ) : (
                <span className="inline-flex items-center gap-2">
                  {accountType === "lecturer" ? "Create lecturer account" : "Create account"}
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          {accountType === "student" && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
              <GoogleAuthButton label="Sign up with Google" redirect={redirect} />
            </>
          )}
        </motion.div>

        <motion.p variants={staggerItem} className="mt-6 text-center text-sm text-muted-foreground">
          Already a member?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </motion.p>
      </motion.div>
    </main>
  );
}
