import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowRight, Lock, Mail, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import logoAsset from "@/assets/ace-logo.jpg";

type TeacherAuthSearch = { redirect?: string; mode?: Mode };
type Mode = "signin" | "signup";

export const Route = createFileRoute("/teachers/auth")({
  validateSearch: (search: Record<string, unknown>): TeacherAuthSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    mode: search.mode === "signup" ? "signup" : "signin",
  }),
  component: TeacherAuthPage,
});

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "At least 6 characters").max(72),
});

const signUpSchema = signInSchema.extend({ fullName: z.string().trim().min(1, "Enter your name").max(100) });

function TeacherAuthPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { redirect, mode: initialMode } = Route.useSearch();
  const target = redirect?.startsWith("/") ? redirect : "/teachers";
  const [mode, setMode] = useState<Mode>(initialMode ?? "signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: target });
  }, [user, navigate, target]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = mode === "signup"
      ? signUpSchema.safeParse({ fullName, email, password })
      : signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    const result = mode === "signup"
      ? await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: window.location.origin + target, data: { full_name: parsed.data.fullName, account_type: "teacher" } },
        })
      : await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);

    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      toast.success("Teacher account created. Check your email to confirm it, then sign in.");
      setMode("signin");
      return;
    }
    navigate({ to: target });
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="absolute inset-x-0 top-0 -z-10 h-[480px] [background:radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]" />
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-3">
            <img src={logoAsset} alt="AceTutor" width={44} height={44} className="rounded-xl object-contain shadow-sm" />
            <span className="text-2xl font-bold tracking-tight">AceTutor</span>
          </div>
          <h1 className="mt-6 font-display text-3xl font-bold">
            Teacher <span className="text-primary">workspace</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Publish notes and quizzes for your enrolled students.</p>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-muted p-1">
            {(["signin", "signup"] as Mode[]).map((option) => (
              <button key={option} type="button" onClick={() => setMode(option)} className={`rounded-lg py-2 text-sm font-semibold transition-colors ${mode === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {option === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="space-y-5">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <label htmlFor="teacher-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Full name</label>
                <div className="relative"><User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="teacher-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Dr. Jane Doe" className="rounded-xl pl-9" required /></div>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="teacher-email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
              <div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="teacher-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@school.edu" className="rounded-xl pl-9" required /></div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="teacher-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</label>
              <div className="relative"><Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="teacher-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" className="rounded-xl pl-9" required /></div>
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl font-semibold">
              {loading ? "Please wait…" : <span className="inline-flex items-center gap-2">{mode === "signin" ? "Sign in to teach" : "Create teacher account"}<ArrowRight className="h-4 w-4" /></span>}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Student account? <Link to="/login" className="font-semibold text-primary hover:underline">Use student sign in</Link>
        </p>
      </div>
    </main>
  );
}