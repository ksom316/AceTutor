import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useVarkProfile } from "@/hooks/use-vark-profile";
import { varkOnboardingStatus } from "@/lib/vark";

const EASE = [0.22, 1, 0.36, 1] as const;

export const Route = createFileRoute("/_authenticated/onboarding/vark")({
  component: VarkOnboardingStep,
});

/**
 * Optional onboarding step, shown once right after Learning Preferences (see
 * post-auth-redirect.ts + onboarding.preferences.tsx). NOT a gate: "Skip for
 * now" is always available and, once taken, is remembered forever
 * (vark_profiles.onboarding_skipped_at) so the student is never prompted again.
 *
 * VARK stays a SUPPORTING signal only — the priority order for personalization
 * is behaviour → explicit Learning Preferences → VARK (see initial-modality.ts /
 * vark-content-recommendation.ts). This screen says as much and never frames the
 * result as a fixed identity.
 *
 * Self-guards: if the student has already completed or skipped VARK (e.g. they
 * navigated here directly, or came back), it bounces to the dashboard.
 */
function VarkOnboardingStep() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile, isLoading } = useVarkProfile();
  const [skipping, setSkipping] = useState(false);
  const bounced = useRef(false);

  const status = varkOnboardingStatus(profile);

  useEffect(() => {
    if (isLoading || bounced.current) return;
    if (status !== "pending") {
      bounced.current = true;
      navigate({ to: "/", replace: true });
    }
  }, [isLoading, status, navigate]);

  const startCheck = () => {
    navigate({ to: "/vark-assessment", search: { from: "onboarding" } });
  };

  const skipForNow = async () => {
    if (!user || skipping) return;
    setSkipping(true);
    // Persist the skip and CONFIRM it landed before navigating — a failed write
    // must not look like a successful skip (identical guard to the preferences
    // page's "Skip for now"). Only the skip timestamp is written; scores and the
    // assessment fields are left untouched.
    const { data, error } = await supabase
      .from("vark_profiles")
      .upsert(
        {
          user_id: user.id,
          onboarding_skipped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("user_id")
      .maybeSingle();
    setSkipping(false);
    if (error || !data) {
      toast.error("Couldn't save that just now — check your connection and try again.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["vark-profile"] });
    navigate({ to: "/" });
  };

  if (isLoading || status !== "pending") {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-12 text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          One more optional step
        </p>
        <h1 className="mt-3 font-display text-3xl md:text-4xl">
          Personalize your AceTutor experience
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Complete a short Learning Style Check to help AceTutor recommend better learning formats
          and explanations.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
        className="mt-8 rounded-2xl border border-border bg-card p-6"
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" /> Learning Style Check (VARK)
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          14 quick questions, about two minutes. It&apos;s completely optional and it&apos;s not a
          fixed label — your saved Learning Preferences stay the main guide, and this only adds a
          gentle hint for formats when there isn&apos;t much else to go on yet. You can take or
          retake it anytime from your profile.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={startCheck} disabled={skipping}>
            Complete Learning Style Check <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={skipForNow}
            disabled={skipping}
          >
            {skipping ? "Saving…" : "Skip for now"}
          </Button>
        </div>
      </motion.div>

      <p className="mt-4 text-xs text-muted-foreground">
        Skipping won&apos;t affect your courses, progress, or scores — and we won&apos;t ask again.
      </p>
    </main>
  );
}
