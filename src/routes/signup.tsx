import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { z } from "zod";
import { toast } from "sonner";
import { Mail, Lock, User, ArrowRight, GraduationCap, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { claimLecturerSlot, stashPendingLecturerId } from "@/lib/lecturer-claim";
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
  const { isLecturer, loading: roleLoading } = useRole();
  const { redirect, role } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const target = redirect?.startsWith("/") ? redirect : "/onboarding/vark";
  const [accountType, setAccountType] = useState<AccountType>(role ?? "student");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lecturerId, setLecturerId] = useState("");
  const [idStatus, setIdStatus] = useState<IdStatus>("idle");
  const [loading, setLoading] = useState(false);

  // Already signed in → send them where they belong (DB role decides).
  useEffect(() => {
    if (!user || roleLoading) return;
    navigate({ to: isLecturer ? "/lecturer" : target });
  }, [user, roleLoading, isLecturer, navigate, target]);

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
        toast.error(error.message);
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
        await qc.invalidateQueries({ queryKey: ["user-role"] });
        toast.success("Lecturer account created — welcome!");
        navigate({ to: "/lecturer" });
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

    // ---- Student signup (unchanged) ----
    const parsed = baseSchema.safeParse({ fullName, email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: window.location.origin + target,
        data: { full_name: parsed.data.fullName },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Account created — let's get started!");
    navigate({ to: target });
  };

  const idHint: Record<IdStatus, { text: string; className: string } | null> = {
    idle: null,
    checking: { text: "Checking…", className: "text-muted-foreground" },
    available: { text: "Valid Lecturer ID", className: "text-success" },
    claimed: { text: "This Lecturer ID has already been claimed", className: "text-destructive" },
    invalid: { text: "Invalid Lecturer ID", className: "text-destructive" },
  };
  const hint = idHint[idStatus];

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
              <GoogleAuthButton label="Sign up with Google" redirect={target} />
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
