import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Headphones,
  Loader2,
  Plus,
  Presentation,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { fadeUp } from "@/lib/motion";
import { CreateModuleDialog } from "@/components/lecturer/CreateModuleDialog";
import { LessonFormDialog } from "@/components/lecturer/LessonFormDialog";
import { type LessonModality, type LessonSource } from "@/lib/lesson-shared";
import {
  isUploadedMaterialUrl,
  removeMaterialFile,
  type UploadKind,
  uploadMaterialFile,
} from "@/lib/course-material-storage";

export const Route = createFileRoute("/lecturer/materials")({
  component: LecturerMaterials,
});

type Modality = LessonModality;
type Source = LessonSource;
type Lesson = {
  id: string;
  title: string;
  modality: Modality;
  body_md: string | null;
  media_url: string | null;
  order_index: number;
};
type TopicWithLessons = {
  id: string;
  title: string;
  summary: string | null;
  slug: string;
  order_index: number;
  lessons: Lesson[];
};
type Dir = "up" | "down";

const TITLE_MAX = 200;

const MODALITY_META: Record<Modality, { label: string; icon: typeof FileText }> = {
  text: { label: "Text", icon: FileText },
  video: { label: "Video", icon: Video },
  audio: { label: "Audio", icon: Headphones },
  slides: { label: "Slides", icon: Presentation },
};

function friendlyUploadError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (/row-level security|not authorized|unauthorized|403/i.test(msg)) {
    return "You don't have permission to upload material to this course.";
  }
  if (/smaller than|Choose a .+ file|exceeded the maximum|mime type/i.test(msg)) {
    return msg;
  }
  return "Couldn't save this lesson. Please try again.";
}

const byIdx = (a: { order_index: number }, b: { order_index: number }) =>
  a.order_index - b.order_index;

function reorder<T extends { id: string }>(list: T[], id: string, dir: Dir): T[] | null {
  const i = list.findIndex((x) => x.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/* ------------------------------------------------------------------ */

function LecturerMaterials() {
  const { lecturerCourseId } = useRole();
  const enabled = !!lecturerCourseId;
  const qc = useQueryClient();
  const materialsKey = ["lecturer-materials", lecturerCourseId] as const;
  const invalidate = () => qc.invalidateQueries({ queryKey: materialsKey });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [topicDialog, setTopicDialog] = useState<{
    mode: "rename";
    topic: TopicWithLessons;
  } | null>(null);
  const [lessonDialog, setLessonDialog] = useState<{
    topicId: string;
    lesson: Lesson | null;
  } | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "topic"; topic: TopicWithLessons } | { kind: "lesson"; lesson: Lesson } | null
  >(null);

  const courseQuery = useQuery({
    queryKey: ["lecturer-course", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("title, summary")
        .eq("id", lecturerCourseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const materialsQuery = useQuery({
    queryKey: materialsKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics")
        .select(
          "id, title, summary, slug, order_index, lessons(id, title, modality, body_md, media_url, order_index)",
        )
        .eq("course_id", lecturerCourseId!)
        .order("order_index");
      if (error) throw error;
      return (data ?? []) as unknown as TopicWithLessons[];
    },
  });

  const topics = useMemo(() => [...(materialsQuery.data ?? [])].sort(byIdx), [materialsQuery.data]);
  const totalLessons = topics.reduce((n, t) => n + t.lessons.length, 0);

  /* ---- mutations ---- */

  const renameTopic = useMutation({
    mutationFn: async ({ id, title, summary }: { id: string; title: string; summary: string }) => {
      const { error } = await supabase
        .from("topics")
        .update({ title: title.trim(), summary: summary.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Module updated");
    },
    onError: () => toast.error("Couldn't save this module. Please try again."),
  });

  const deleteTopic = useMutation({
    mutationFn: async (topic: TopicWithLessons) => {
      const files = topic.lessons.map((l) => l.media_url).filter(isUploadedMaterialUrl) as string[];
      const { error } = await supabase.from("topics").delete().eq("id", topic.id);
      if (error) throw error;
      let orphaned = 0;
      for (const url of files) {
        const ok = await removeMaterialFile(url).catch(() => false);
        if (!ok) orphaned += 1;
      }
      return { orphaned };
    },
    onSuccess: (res) => {
      invalidate();
      if (res.orphaned > 0) {
        toast.warning(
          `Module deleted. ${res.orphaned} uploaded file${res.orphaned === 1 ? "" : "s"} could not be removed.`,
        );
      } else {
        toast.success("Module deleted");
      }
    },
    onError: () => toast.error("Couldn't delete this module. Please try again."),
  });

  const saveLesson = useMutation({
    mutationFn: async (input: {
      topicId: string;
      lessonId: string | null;
      existingUrl: string | null;
      title: string;
      modality: Modality;
      source: Source;
      body: string;
      url: string;
      file: File | null;
    }) => {
      const title = input.title.trim();
      const body = input.body.trim();

      let mediaUrl: string | null;
      let uploadedPath: string | null = null;
      let replacedOldUrl: string | null = null;

      if (input.modality === "text") {
        mediaUrl = null;
      } else if (input.file) {
        const up = await uploadMaterialFile({
          kind: input.modality as UploadKind,
          file: input.file,
          courseId: lecturerCourseId!,
          topicId: input.topicId,
        });
        mediaUrl = up.publicUrl;
        uploadedPath = up.path;
        if (isUploadedMaterialUrl(input.existingUrl)) replacedOldUrl = input.existingUrl;
      } else if (input.source === "url" && input.modality !== "slides") {
        mediaUrl = input.url.trim();
        if (isUploadedMaterialUrl(input.existingUrl)) replacedOldUrl = input.existingUrl;
      } else {
        // Editing, keeping the file that is already attached.
        mediaUrl = input.existingUrl;
      }

      const fields = {
        title,
        modality: input.modality,
        body_md: input.modality === "text" ? body : body || null,
        media_url: input.modality === "text" ? null : mediaUrl,
      };

      try {
        if (input.lessonId) {
          const { error } = await supabase.from("lessons").update(fields).eq("id", input.lessonId);
          if (error) throw error;
        } else {
          const topic = topics.find((t) => t.id === input.topicId);
          const nextIndex =
            (topic?.lessons.reduce((m, l) => Math.max(m, l.order_index), -1) ?? -1) + 1;
          const { error } = await supabase
            .from("lessons")
            .insert({ ...fields, topic_id: input.topicId, order_index: nextIndex });
          if (error) throw error;
        }
      } catch (e) {
        // DB write failed after a successful upload — remove the orphan file.
        if (uploadedPath) await removeMaterialFile(uploadedPath).catch(() => undefined);
        throw e;
      }

      // The lesson now points at the new file, so the old one is safe to drop.
      if (replacedOldUrl) await removeMaterialFile(replacedOldUrl).catch(() => undefined);
    },
    onSuccess: (_data, vars) => {
      invalidate();
      toast.success(vars.lessonId ? "Lesson updated" : "Lesson added");
    },
    onError: (e) => toast.error(friendlyUploadError(e)),
  });

  const deleteLesson = useMutation({
    mutationFn: async (lesson: Lesson) => {
      const { error } = await supabase.from("lessons").delete().eq("id", lesson.id);
      if (error) throw error;
      if (isUploadedMaterialUrl(lesson.media_url)) {
        const ok = await removeMaterialFile(lesson.media_url).catch(() => false);
        return { fileOrphaned: !ok };
      }
      return { fileOrphaned: false };
    },
    onSuccess: (res) => {
      invalidate();
      if (res.fileOrphaned) {
        toast.warning("Lesson deleted, but the uploaded file could not be removed.");
      } else {
        toast.success("Lesson deleted");
      }
    },
    onError: () => toast.error("Couldn't delete this lesson. Please try again."),
  });

  const move = useMutation({
    mutationFn: async (
      m:
        | { kind: "topic"; id: string; dir: Dir }
        | { kind: "lesson"; topicId: string; id: string; dir: Dir },
    ) => {
      if (m.kind === "topic") {
        const next = reorder([...topics].sort(byIdx), m.id, m.dir);
        if (!next) return;
        for (let i = 0; i < next.length; i++) {
          if (next[i].order_index === i) continue;
          const { error } = await supabase
            .from("topics")
            .update({ order_index: i })
            .eq("id", next[i].id);
          if (error) throw error;
        }
      } else {
        const topic = topics.find((t) => t.id === m.topicId);
        if (!topic) return;
        const next = reorder([...topic.lessons].sort(byIdx), m.id, m.dir);
        if (!next) return;
        for (let i = 0; i < next.length; i++) {
          if (next[i].order_index === i) continue;
          const { error } = await supabase
            .from("lessons")
            .update({ order_index: i })
            .eq("id", next[i].id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't reorder. Please try again."),
  });

  const reorderBusy = move.isPending;
  const deleteBusy = deleteTopic.isPending || deleteLesson.isPending;

  /* ---- render ---- */

  const courseName = courseQuery.data?.title;
  const confirmLessonHasFile =
    confirm?.kind === "lesson" && isUploadedMaterialUrl(confirm.lesson.media_url);

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-4xl px-4 py-10"
    >
      <h1 className="font-display text-4xl">Course Materials</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Manage the modules and learning materials for{" "}
        <span className="font-medium text-foreground">{courseName ?? "your assigned course"}</span>.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {materialsQuery.isLoading || materialsQuery.isError
            ? " "
            : `${topics.length} ${topics.length === 1 ? "module" : "modules"} · ${totalLessons} ${
                totalLessons === 1 ? "lesson" : "lessons"
              }`}
        </p>
        <Button className="rounded-full" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Create module
        </Button>
      </div>

      <div className="mt-6 space-y-3">
        {materialsQuery.isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))
        ) : materialsQuery.isError ? (
          <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
            <h2 className="font-display text-xl">Couldn&apos;t load course materials</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Please try again in a moment.
            </p>
            <Button
              variant="outline"
              className="mt-5 rounded-full"
              onClick={() => materialsQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
            <h2 className="font-display text-2xl">No modules yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Create your first module to start adding learning materials.
            </p>
            <Button className="mt-5 rounded-full" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Create module
            </Button>
          </div>
        ) : (
          topics.map((topic, i) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              first={i === 0}
              last={i === topics.length - 1}
              open={expanded.has(topic.id)}
              busy={reorderBusy}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(topic.id)) next.delete(topic.id);
                  else next.add(topic.id);
                  return next;
                })
              }
              onMove={(dir) => move.mutate({ kind: "topic", id: topic.id, dir })}
              onRename={() => setTopicDialog({ mode: "rename", topic })}
              onDelete={() => setConfirm({ kind: "topic", topic })}
              onAddLesson={() => setLessonDialog({ topicId: topic.id, lesson: null })}
              onEditLesson={(lesson) => setLessonDialog({ topicId: topic.id, lesson })}
              onDeleteLesson={(lesson) => setConfirm({ kind: "lesson", lesson })}
              onMoveLesson={(lessonId, dir) =>
                move.mutate({ kind: "lesson", topicId: topic.id, id: lessonId, dir })
              }
            />
          ))
        )}
      </div>

      <CreateModuleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        lecturerCourseId={lecturerCourseId}
      />

      <TopicDialog
        state={topicDialog}
        saving={renameTopic.isPending}
        onClose={() => setTopicDialog(null)}
        onSubmit={(title, summary) => {
          if (topicDialog?.mode === "rename") {
            renameTopic.mutate(
              { id: topicDialog.topic.id, title, summary },
              { onSuccess: () => setTopicDialog(null) },
            );
          }
        }}
      />

      <LessonFormDialog
        key={lessonDialog ? (lessonDialog.lesson?.id ?? `new-${lessonDialog.topicId}`) : "closed"}
        open={!!lessonDialog}
        target={{ lesson: lessonDialog?.lesson ?? null }}
        saving={saveLesson.isPending}
        onClose={() => setLessonDialog(null)}
        onSubmit={(payload) =>
          saveLesson.mutate(
            {
              ...payload,
              topicId: lessonDialog!.topicId,
              lessonId: lessonDialog!.lesson?.id ?? null,
              existingUrl: lessonDialog!.lesson?.media_url ?? null,
            },
            { onSuccess: () => setLessonDialog(null) },
          )
        }
      />

      <AlertDialog
        open={!!confirm}
        onOpenChange={(next) => {
          if (!next && !deleteBusy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "topic" ? "Delete this module?" : "Delete this learning material?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "topic" ? (
                <>
                  This permanently removes{" "}
                  <span className="font-medium text-foreground">{confirm.topic.title}</span>, its{" "}
                  {confirm.topic.lessons.length}{" "}
                  {confirm.topic.lessons.length === 1 ? "lesson" : "lessons"} (including any
                  uploaded files), any quiz questions for it, and every student quiz attempt and
                  progress record for this module. This can&apos;t be undone.
                </>
              ) : confirm?.kind === "lesson" ? (
                <>
                  Are you sure you want to delete{" "}
                  <span className="font-medium text-foreground">{confirm.lesson.title}</span>?
                  {confirmLessonHasFile
                    ? " This will remove the material from the course and delete the uploaded file."
                    : " This also removes any student progress recorded for it."}{" "}
                  This action cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault();
                if (!confirm) return;
                if (confirm.kind === "topic") {
                  deleteTopic.mutate(confirm.topic, { onSuccess: () => setConfirm(null) });
                } else {
                  deleteLesson.mutate(confirm.lesson, { onSuccess: () => setConfirm(null) });
                }
              }}
            >
              {deleteBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.main>
  );
}

/* ------------------------------------------------------------------ */

function TopicCard({
  topic,
  first,
  last,
  open,
  busy,
  onToggle,
  onMove,
  onRename,
  onDelete,
  onAddLesson,
  onEditLesson,
  onDeleteLesson,
  onMoveLesson,
}: {
  topic: TopicWithLessons;
  first: boolean;
  last: boolean;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onMove: (dir: Dir) => void;
  onRename: () => void;
  onDelete: () => void;
  onAddLesson: () => void;
  onEditLesson: (lesson: Lesson) => void;
  onDeleteLesson: (lesson: Lesson) => void;
  onMoveLesson: (lessonId: string, dir: Dir) => void;
}) {
  const lessons = [...topic.lessons].sort(byIdx);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{topic.title}</span>
            <span className="block text-xs text-muted-foreground">
              {topic.lessons.length} {topic.lessons.length === 1 ? "lesson" : "lessons"}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Move module up"
            disabled={first || busy}
            onClick={() => onMove("up")}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Move module down"
            disabled={last || busy}
            onClick={() => onMove("down")}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onRename}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-2 border-t border-border p-4">
          {lessons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No learning materials yet.</p>
          ) : (
            lessons.map((lesson, i) => {
              const Icon = MODALITY_META[lesson.modality].icon;
              return (
                <div
                  key={lesson.id}
                  className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <Badge variant="secondary" className="shrink-0 gap-1">
                    <Icon className="h-3 w-3" />
                    {MODALITY_META[lesson.modality].label}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{lesson.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Move lesson up"
                    disabled={i === 0 || busy}
                    onClick={() => onMoveLesson(lesson.id, "up")}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Move lesson down"
                    disabled={i === lessons.length - 1 || busy}
                    onClick={() => onMoveLesson(lesson.id, "down")}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onEditLesson(lesson)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDeleteLesson(lesson)}
                  >
                    Delete
                  </Button>
                </div>
              );
            })
          )}
          <Button variant="outline" size="sm" className="rounded-full" onClick={onAddLesson}>
            <Plus className="mr-1.5 h-4 w-4" /> Add lesson
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TopicDialog({
  state,
  saving,
  onClose,
  onSubmit,
}: {
  state: { mode: "create" } | { mode: "rename"; topic: TopicWithLessons } | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (title: string, summary: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [touched, setTouched] = useState(false);

  // Reset fields whenever the dialog target changes.
  const key = state ? (state.mode === "rename" ? state.topic.id : "create") : "closed";
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    setTitle(state?.mode === "rename" ? state.topic.title : "");
    setSummary(state?.mode === "rename" ? (state.topic.summary ?? "") : "");
    setTouched(false);
  }

  const invalid = title.trim().length === 0 || title.length > TITLE_MAX;

  return (
    <Dialog open={!!state} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.mode === "rename" ? "Edit module" : "Create module"}</DialogTitle>
          <DialogDescription>
            {state?.mode === "rename"
              ? "Update this module's title and description."
              : "Add a new module to your course. Students see it on the course page."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="topic-title">Title</Label>
            <Input
              id="topic-title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="e.g. Arrays & Lists"
            />
            {touched && invalid && (
              <p className="text-xs text-destructive">
                Enter a title (up to {TITLE_MAX} characters).
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="topic-summary">Description (optional)</Label>
            <Textarea
              id="topic-summary"
              value={summary}
              rows={3}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="A short summary shown under the module title."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || invalid}
            onClick={() => {
              setTouched(true);
              if (!invalid) onSubmit(title, summary);
            }}
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {state?.mode === "rename" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
