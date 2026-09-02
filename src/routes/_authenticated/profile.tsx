import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, LogOut, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { deleteAccount } from "@/lib/account.functions";

const EXPLANATION_STYLE_LABEL: Record<string, string> = {
  concise: "Concise",
  detailed: "Detailed",
  step_by_step: "Step-by-step",
  example_first: "Example-first",
};
const LESSON_FORMAT_LABEL: Record<string, string> = {
  written: "Written",
  visual: "Visual",
  audio: "Audio",
};
const WRONG_ANSWER_HELP_LABEL: Record<string, string> = {
  simple: "Simple correction",
  detailed: "Detailed explanation",
  example: "Show an example",
  similar_practice: "Similar practice",
};

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const { isLecturer, lecturerCourseId } = useRole();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const removeAccount = useServerFn(deleteAccount);

  const { data: profile } = useQuery({
    queryKey: ["profile-full", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, created_at")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: learningPrefs } = useQuery({
    queryKey: ["learning-preferences", user?.id],
    enabled: !!user && !isLecturer,
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_preferences")
        .select("explanation_style, lesson_format, wrong_answer_help")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: enrolled } = useQuery({
    queryKey: ["enrolled-courses", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("created_at, courses(id, slug, title, summary)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      type EnrolledCourse = { id: string; slug: string; title: string; summary: string | null };
      return ((data ?? []) as unknown as { courses: EnrolledCourse | null }[])
        .map((row) => row.courses)
        .filter((c): c is EnrolledCourse => !!c);
    },
  });

  // The one course a lecturer is assigned to teach (from lecturer_slots via
  // useRole — never client-supplied). Students never run this query.
  const { data: taughtCourse } = useQuery({
    // Distinct key: the lecturer pages' ["lecturer-course", id] entry selects a
    // different column set.
    queryKey: ["profile-taught-course", lecturerCourseId],
    enabled: isLecturer && !!lecturerCourseId,
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("title, slug")
        .eq("id", lecturerCourseId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: avatarUrl } = useQuery({
    queryKey: ["avatar-signed", profile?.avatar_url],
    enabled: !!profile?.avatar_url,
    queryFn: async () => {
      // Google OAuth avatars are full https URLs — use directly; only
      // storage paths need signing.
      if (profile!.avatar_url!.startsWith("http")) return profile!.avatar_url!;
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile!.avatar_url!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  const initials = (profile?.full_name ?? user?.email ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const saveName = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Name updated");
      setEditingName(false);
      qc.invalidateQueries({ queryKey: ["profile-full", user?.id] });
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadAvatar = async (file: File) => {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (dbErr) throw dbErr;
      toast.success("Profile picture updated");
      qc.invalidateQueries({ queryKey: ["profile-full", user.id] });
      qc.invalidateQueries({ queryKey: ["nav-profile", user.id] });
      qc.invalidateQueries({ queryKey: ["home-profile", user.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAccountMutation = useMutation({
    mutationFn: () => removeAccount({ data: undefined as never }),
    onSuccess: async () => {
      toast.success("Account deleted");
      await supabase.auth.signOut();
      navigate({ to: "/" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-5xl">Your profile</h1>

      {/* Avatar + name */}
      <section className="mt-10 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="relative">
            <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-secondary text-2xl font-semibold text-secondary-foreground">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile picture"
              className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full border border-border bg-background shadow-sm transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex-1">
            {editingName ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Your full name"
                  maxLength={100}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveName.mutate(nameDraft.trim())}
                    disabled={!nameDraft.trim() || saveName.isPending}
                  >
                    {saveName.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-display text-2xl">{profile?.full_name ?? "Unnamed"}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNameDraft(profile?.full_name ?? "");
                    setEditingName(true);
                  }}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Stats */}
      {isLecturer ? (
        <section className="mt-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Course you teach
            </p>
            <p className="mt-1 font-display text-2xl">{taughtCourse?.title ?? "Not assigned"}</p>
            {taughtCourse?.slug && (
              <Link
                to="/courses/$slug"
                params={{ slug: taughtCourse.slug }}
                className="mt-2 inline-block text-xs underline-offset-4 hover:underline"
              >
                View course →
              </Link>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* Stats */}
          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Courses enrolled
              </p>
              <p className="mt-1 font-display text-4xl">{enrolled?.length ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Learning preferences
              </p>
              {learningPrefs &&
              (learningPrefs.explanation_style ||
                learningPrefs.lesson_format ||
                learningPrefs.wrong_answer_help) ? (
                <dl className="mt-2 space-y-1 text-sm">
                  <PrefRow
                    label="Explanation"
                    value={
                      learningPrefs.explanation_style
                        ? EXPLANATION_STYLE_LABEL[learningPrefs.explanation_style]
                        : null
                    }
                  />
                  <PrefRow
                    label="Lesson format"
                    value={
                      learningPrefs.lesson_format
                        ? LESSON_FORMAT_LABEL[learningPrefs.lesson_format]
                        : null
                    }
                  />
                  <PrefRow
                    label="When I get something wrong"
                    value={
                      learningPrefs.wrong_answer_help
                        ? WRONG_ANSWER_HELP_LABEL[learningPrefs.wrong_answer_help]
                        : null
                    }
                  />
                </dl>
              ) : (
                <p className="mt-1 font-display text-2xl">Not set yet</p>
              )}
              <Link
                to="/onboarding/preferences"
                className="mt-2 inline-block text-xs underline-offset-4 hover:underline"
              >
                {learningPrefs &&
                (learningPrefs.explanation_style ||
                  learningPrefs.lesson_format ||
                  learningPrefs.wrong_answer_help)
                  ? "Edit preferences →"
                  : "Set your preferences →"}
              </Link>
            </div>
          </section>

          {/* Enrolled courses list */}
          <section className="mt-6 rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-xl">Your courses</h2>
            {enrolled && enrolled.length > 0 ? (
              <ul className="mt-4 divide-y divide-border">
                {enrolled.map((c) => (
                  <li key={c.slug}>
                    <Link
                      to="/courses/$slug"
                      params={{ slug: c.slug }}
                      className="flex items-center justify-between py-3 hover:text-primary"
                    >
                      <span>{c.title}</span>
                      <span className="text-xs text-muted-foreground">Open →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                You haven't started any courses yet.{" "}
                <Link to="/courses" className="text-primary underline-offset-4 hover:underline">
                  Browse courses
                </Link>
              </p>
            )}
          </section>
        </>
      )}

      {/* Danger zone */}
      <section className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="font-display text-xl text-destructive">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isLecturer
            ? "Deleting your account is permanent. Your AceTutor sign-in, profile and lecturer workspace access are removed, and your Lecturer ID is released so it can be re-assigned. The course you teach and its materials, quizzes and enrolled students' data are part of the platform and are not deleted."
            : "Deleting your account is permanent. Your profile, progress, and quiz attempts will be removed."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  {isLecturer
                    ? "This cannot be undone. Your sign-in, profile and lecturer workspace access are permanently deleted and your Lecturer ID is released. Your course and its content stay on the platform."
                    : "This cannot be undone. Your profile, progress, and quiz history will be permanently deleted."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    removeAccountMutation.mutate();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {removeAccountMutation.isPending && (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  )}
                  Yes, delete it
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </main>
  );
}

/** One "label — value" line in the Learning preferences card. */
function PrefRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value ?? "Not set"}</dd>
    </div>
  );
}
