import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Info,
  LifeBuoy,
  Loader2,
  Mail,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

const SUPPORT_EMAIL = "terrykwakudoe@gmail.com";

/** Pre-filled mailto so issue reports arrive with useful context. */
const reportIssueHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  "AceTutor — App issue report",
)}&body=${encodeURIComponent(
  "Describe the issue you ran into:\n\n\nWhat you were doing when it happened:\n\n\n(Optional) Device / browser:\n",
)}`;

function SettingsPage() {
  const { isLecturer } = useRole();
  const notificationsTo = isLecturer ? "/lecturer/notifications" : "/notifications";
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
          <SettingsIcon className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm text-muted-foreground">Manage your app experience</p>
          <h1 className="font-display text-4xl leading-tight md:text-5xl">Settings</h1>
        </div>
      </motion.div>

      {/* Preferences & account */}
      <motion.section variants={staggerContainer} initial="hidden" animate="show" className="mt-10">
        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Preferences
        </h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <SettingRow
            as="link"
            to={notificationsTo}
            icon={Bell}
            title="Notifications"
            description="Choose what AceTutor can notify you about"
          />
          {!isLecturer && (
            <SettingRow
              as="link"
              to="/onboarding/preferences"
              icon={SlidersHorizontal}
              title="Learning preferences"
              description="How you prefer explanations and lesson formats"
            />
          )}
          <SettingRow
            as="link"
            to="/security"
            icon={ShieldCheck}
            title="Security & login"
            description="Change your password and manage your session"
          />
        </div>
      </motion.section>

      {/* Get help */}
      <motion.section variants={staggerContainer} initial="hidden" animate="show" className="mt-8">
        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Get help
        </h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <SettingRow
            as="a"
            href={reportIssueHref}
            icon={LifeBuoy}
            title="Report an app issue"
            description={`Email the team at ${SUPPORT_EMAIL}`}
          />
          <SettingRow
            as="link"
            to="/about"
            icon={Info}
            title="About app"
            description="Version, credits and what AceTutor does"
          />
        </div>
      </motion.section>

      {/* Reset */}
      <motion.section variants={fadeUp} initial="hidden" animate="show" className="mt-8">
        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {isLecturer ? "Account data" : "Reset"}
        </h2>
        <div
          className={`rounded-2xl border p-5 ${
            isLecturer ? "border-border bg-card" : "border-destructive/30 bg-destructive/5"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                isLecturer ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
              }`}
            >
              <RotateCcw className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Reset account data</p>
              {isLecturer ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Reset account data only clears personal learning activity tied to a sign-in — quiz
                  attempts, recorded study time, course enrollments and your learning preferences.
                  Lecturer accounts don&apos;t use those, and a reset never touches your assigned
                  course, its materials, quizzes or enrolled students. There is nothing to reset on
                  a lecturer account.
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Clears your course enrollments, lesson progress, quiz history and learning
                  preferences. Your name, profile details and password are kept.
                </p>
              )}
            </div>
          </div>
          {!isLecturer && (
            <div className="mt-4">
              <ResetAccountButton />
            </div>
          )}
        </div>
      </motion.section>

      {/* Footer contact hint */}
      <motion.p
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mt-8 flex items-center gap-2 px-1 text-xs text-muted-foreground"
      >
        <Mail className="h-3.5 w-3.5" />
        Need something else?{" "}
        <Link to="/contact" className="text-primary underline-offset-4 hover:underline">
          Contact us
        </Link>
      </motion.p>
    </main>
  );
}

type SettingRowProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
} & ({ as: "link"; to: string; href?: never } | { as: "a"; href: string; to?: never });

/** A single tappable settings row — renders as an internal Link or external anchor. */
function SettingRow({ icon: Icon, title, description, ...rest }: SettingRowProps) {
  const inner = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-105">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </>
  );

  const className =
    "group flex items-center gap-3 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-secondary/50";

  return (
    <motion.div variants={staggerItem}>
      {rest.as === "link" ? (
        <Link to={rest.to} className={className}>
          {inner}
        </Link>
      ) : (
        <a href={rest.href} className={className}>
          {inner}
        </a>
      )}
    </motion.div>
  );
}

/**
 * Resets the user's learning data after an explicit confirmation. Deletes
 * enrollments, lesson progress, recorded study time, quiz history (attempts +
 * answers) and the student's learning preferences, but never touches the
 * profile's name/details or the auth password.
 */
function ResetAccountButton() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    if (!user) return;
    setResetting(true);
    try {
      const uid = user.id;

      // attempt_answers has no user_id — remove them via the user's attempts first.
      const { data: attempts, error: attemptsErr } = await supabase
        .from("quiz_attempts")
        .select("id")
        .eq("user_id", uid);
      if (attemptsErr) throw attemptsErr;
      const attemptIds = (attempts ?? []).map((a) => a.id);
      if (attemptIds.length) {
        const { error } = await supabase
          .from("attempt_answers")
          .delete()
          .in("attempt_id", attemptIds);
        if (error) throw error;
      }

      // Delete the user's activity records.
      const attemptsDel = await supabase.from("quiz_attempts").delete().eq("user_id", uid);
      if (attemptsDel.error) throw attemptsDel.error;
      const progressDel = await supabase.from("progress").delete().eq("user_id", uid);
      if (progressDel.error) throw progressDel.error;
      const sessionsDel = await supabase.from("study_sessions").delete().eq("user_id", uid);
      if (sessionsDel.error) throw sessionsDel.error;
      const enrollDel = await supabase.from("enrollments").delete().eq("user_id", uid);
      if (enrollDel.error) throw enrollDel.error;
      const prefsDel = await supabase.from("learning_preferences").delete().eq("user_id", uid);
      if (prefsDel.error) throw prefsDel.error;
      const varkDel = await supabase.from("vark_profiles").delete().eq("user_id", uid);
      if (varkDel.error) throw varkDel.error;
      // Phase A6 — learning_interactions rows referencing a deleted quiz
      // attempt already cascade; this covers the rest (lesson opens, modality
      // selections, practice quiz events) that don't reference quiz_attempts.
      const interactionsDel = await supabase
        .from("learning_interactions")
        .delete()
        .eq("user_id", uid);
      if (interactionsDel.error) throw interactionsDel.error;

      await queryClient.invalidateQueries();
      toast.success("Your account data has been reset");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reset your account data");
    } finally {
      setResetting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !resetting && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <RotateCcw className="mr-1.5 h-4 w-4" /> Reset account data
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset your account data?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently clears your course enrollments, lesson progress, recorded study time,
            quiz history and learning preferences. Your name, profile details and password will not
            be changed. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleReset();
            }}
            disabled={resetting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {resetting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Yes, reset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
