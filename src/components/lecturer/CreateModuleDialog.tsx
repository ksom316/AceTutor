import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { LessonFormDialog } from "@/components/lecturer/LessonFormDialog";
import { isLessonValueComplete, type LessonFormValue } from "@/lib/lesson-shared";
import {
  removeMaterialFile,
  type UploadKind,
  uploadMaterialFile,
} from "@/lib/course-material-storage";
import { QuizQuestionDialog } from "@/components/lecturer/QuizQuestionDialog";
import {
  blankDraft,
  cleanDraft,
  draftToRow,
  MAX_QUESTIONS,
  TITLE_MAX,
  type QuizDraft,
} from "@/lib/quiz-shared";
import { generateModuleQuiz, type QuizGenResult } from "@/lib/lecturer-quiz.functions";
import { quizGenErrorMessage } from "@/lib/quiz-capability";
import { DEFAULT_DIFFICULTY_MODE, type DifficultyMode } from "@/lib/quiz-difficulty";
import { DifficultyModeField } from "@/components/lecturer/DifficultyModeField";
import {
  DEFAULT_MODULE_QUIZ_DURATION,
  durationLabel,
  MODULE_QUIZ_DURATIONS,
} from "@/lib/quiz-timer";

/**
 * Three-step "Create module" flow: module details → course content → quiz.
 * Nothing is written until "Create module" — a single atomic
 * create_module_with_quiz() RPC that itself rejects zero lessons / zero
 * questions. The lecturer cannot reach the quiz step with no content, nor
 * create the module with no question.
 */
export function CreateModuleDialog({
  open,
  onOpenChange,
  lecturerCourseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lecturerCourseId: string | null;
}) {
  const qc = useQueryClient();
  const runGenerate = useServerFn(generateModuleQuiz);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [touched, setTouched] = useState(false);

  const [lessons, setLessons] = useState<LessonFormValue[]>([]);
  const [lDialog, setLDialog] = useState<{ kind: "new" } | { kind: "edit"; index: number } | null>(
    null,
  );

  const [questions, setQuestions] = useState<QuizDraft[]>([]);
  const [qDialog, setQDialog] = useState<{ kind: "new" } | { kind: "edit"; index: number } | null>(
    null,
  );
  const [aiCount, setAiCount] = useState("10");
  const [aiDifficulty, setAiDifficulty] = useState<DifficultyMode>(DEFAULT_DIFFICULTY_MODE);
  const [durationMinutes, setDurationMinutes] = useState(String(DEFAULT_MODULE_QUIZ_DURATION));
  const [generating, setGenerating] = useState(false);
  const [review, setReview] = useState<{ items: QuizDraft[]; result: QuizGenResult } | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setStep(1);
    setTitle("");
    setSummary("");
    setTouched(false);
    setLessons([]);
    setLDialog(null);
    setQuestions([]);
    setQDialog(null);
    setAiCount("10");
    setAiDifficulty(DEFAULT_DIFFICULTY_MODE);
    setDurationMinutes(String(DEFAULT_MODULE_QUIZ_DURATION));
    setReview(null);
    setSubmitting(false);
  };

  const close = () => {
    if (submitting || generating) return;
    onOpenChange(false);
    reset();
  };

  const titleClean = title.trim();
  const titleError =
    titleClean.length === 0
      ? "Enter a module title."
      : titleClean.length > TITLE_MAX
        ? `Keep the title under ${TITLE_MAX} characters.`
        : null;

  const validLessons = lessons.filter(isLessonValueComplete);
  const validQuestions = questions.filter((q) => cleanDraft(q) !== null);
  const canProceedToQuiz = validLessons.length >= 1;
  const canCreate =
    !titleError && validLessons.length >= 1 && validQuestions.length >= 1 && !submitting;
  const room = Math.max(0, MAX_QUESTIONS - questions.length);

  const moveLesson = (i: number, dir: -1 | 1) =>
    setLessons((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const moveQuestion = (i: number, dir: -1 | 1) =>
    setQuestions((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /** Text the AI can be grounded in — text bodies + captions of the draft content. */
  const draftContent = () =>
    lessons
      .map((l) => {
        const body = l.body.trim();
        if (!body) return "";
        return l.modality === "text"
          ? `## ${l.title.trim()}\n\n${body}`
          : `## ${l.title.trim()} (${l.modality})\n\n${body}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 30000);

  const generate = async () => {
    const n = Number(aiCount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_QUESTIONS) {
      toast.error(`Enter a whole number between 1 and ${MAX_QUESTIONS}.`);
      return;
    }
    if (questions.length + n > MAX_QUESTIONS) {
      toast.error(`This quiz can hold ${MAX_QUESTIONS} questions. Room for ${room} more.`);
      return;
    }
    setGenerating(true);
    try {
      const content = draftContent();
      const res = await runGenerate({
        data: {
          draftModule: {
            title: titleClean,
            summary: summary.trim() || undefined,
            content: content || undefined,
          },
          questionCount: n,
          difficulty: aiDifficulty,
        },
      });
      setReview({ items: res.questions.map((q) => ({ ...q })), result: res });
    } catch (e) {
      toast.error(quizGenErrorMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    if (titleError) {
      setStep(1);
      return;
    }
    if (validLessons.length < 1) {
      toast.error("Add at least one course content before creating the module.");
      setStep(2);
      return;
    }
    const cleanQ = questions.map(cleanDraft).filter((d): d is QuizDraft => d !== null);
    if (cleanQ.length < 1) {
      toast.error("Add at least one quiz question before creating the module.");
      return;
    }

    setSubmitting(true);
    const folderId = crypto.randomUUID();
    const uploadedPaths: string[] = [];
    try {
      const lessonRows: {
        modality: string;
        title: string;
        body_md: string | null;
        media_url: string | null;
        order_index: number;
      }[] = [];

      for (let i = 0; i < validLessons.length; i++) {
        const l = validLessons[i];
        const body = l.body.trim();
        let mediaUrl: string | null = null;
        if (l.modality !== "text") {
          if (l.file) {
            const up = await uploadMaterialFile({
              kind: l.modality as UploadKind,
              file: l.file,
              courseId: lecturerCourseId!,
              topicId: folderId,
            });
            mediaUrl = up.publicUrl;
            uploadedPaths.push(up.path);
          } else if (l.source === "url") {
            mediaUrl = l.url.trim();
          }
        }
        lessonRows.push({
          modality: l.modality,
          title: l.title.trim(),
          body_md: l.modality === "text" ? body : body || null,
          media_url: l.modality === "text" ? null : mediaUrl,
          order_index: i,
        });
      }

      const { error } = await supabase.rpc("create_module_with_quiz", {
        _title: titleClean,
        _summary: summary.trim(),
        _lessons: lessonRows,
        _questions: cleanQ.slice(0, MAX_QUESTIONS).map((d, i) => draftToRow(d, i)),
        _duration_minutes: Number(durationMinutes) || DEFAULT_MODULE_QUIZ_DURATION,
      });
      if (error) throw error;

      qc.invalidateQueries({ queryKey: ["lecturer-materials", lecturerCourseId] });
      qc.invalidateQueries({ queryKey: ["lecturer-quiz-overview", lecturerCourseId] });
      qc.invalidateQueries({ queryKey: ["lecturer-content-counts", lecturerCourseId] });
      toast.success("Module created with its content and quiz");
      onOpenChange(false);
      reset();
    } catch (e) {
      console.error("[create-module] create_module_with_quiz failed:", e);
      // The topic was not created — remove any files we already uploaded.
      for (const p of uploadedPaths) await removeMaterialFile(p).catch(() => undefined);
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        /at least one|needs a title|needs content|needs a file or link|at most 50|title is required|title is too long/i.test(
          msg,
        )
          ? msg
          : "Couldn't create this module. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const editingLesson = lDialog?.kind === "edit" ? (lessons[lDialog.index] ?? null) : null;

  const editingQuestion =
    qDialog?.kind === "edit" ? (questions[qDialog.index] ?? blankDraft()) : blankDraft();

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === 1
                ? "Create module — details"
                : step === 2
                  ? `Create module — course content`
                  : "Create module — quiz"}
            </DialogTitle>
            <DialogDescription>
              {step === 1
                ? "Give the module a title. Next you'll add course content, then its quiz."
                : step === 2
                  ? "Add at least one lesson (text, video, audio or slides) before continuing to the quiz."
                  : "Add at least one quiz question. Students must pass this to complete the module."}
            </DialogDescription>
          </DialogHeader>

          {step === 1 && (
            <>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cm-title">Module title</Label>
                  <Input
                    id="cm-title"
                    value={title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder="e.g. Arrays & Lists"
                  />
                  {touched && titleError && (
                    <p className="text-xs text-destructive">{titleError}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cm-summary">Description (optional)</Label>
                  <Textarea
                    id="cm-summary"
                    value={summary}
                    rows={3}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="A short summary shown under the module title."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setTouched(true);
                    if (!titleError) setStep(2);
                  }}
                  disabled={!!titleError}
                >
                  Continue to content <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-xs text-muted-foreground">
                Content: {validLessons.length} ready
                {lessons.length !== validLessons.length
                  ? ` · ${lessons.length - validLessons.length} incomplete`
                  : ""}
              </p>

              <div className="space-y-2">
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => setLDialog({ kind: "new" })}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add course content
                </Button>

                {lessons.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-4 text-center text-sm text-destructive">
                    Add at least one course content before continuing to the quiz.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {lessons.map((l, i) => {
                      const incomplete = !isLessonValueComplete(l);
                      return (
                        <li key={i} className="rounded-xl border border-border bg-card p-3 text-sm">
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 text-xs text-muted-foreground">{i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium">
                                {l.title.trim() || "(untitled)"}{" "}
                                <span className="text-xs font-normal capitalize text-muted-foreground">
                                  · {l.modality}
                                </span>
                              </p>
                              {incomplete && (
                                <p className="mt-1 text-xs text-destructive">
                                  Incomplete — edit before continuing.
                                </p>
                              )}
                              <div className="mt-1.5 flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  aria-label="Move up"
                                  disabled={i === 0}
                                  onClick={() => moveLesson(i, -1)}
                                >
                                  <ChevronUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  aria-label="Move down"
                                  disabled={i === lessons.length - 1}
                                  onClick={() => moveLesson(i, 1)}
                                >
                                  <ChevronDown className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setLDialog({ kind: "edit", index: i })}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() =>
                                    setLessons((prev) => prev.filter((_, x) => x !== i))
                                  }
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                                </Button>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => {
                    if (canProceedToQuiz) setStep(3);
                    else
                      toast.error("Add at least one course content before continuing to the quiz.");
                  }}
                  disabled={!canProceedToQuiz}
                >
                  Continue to quiz <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Questions: {questions.length} / {MAX_QUESTIONS}
                </p>
                <div className="space-y-1">
                  <Label htmlFor="cm-quiz-duration" className="text-xs">
                    Time limit
                  </Label>
                  <Select value={durationMinutes} onValueChange={setDurationMinutes}>
                    <SelectTrigger id="cm-quiz-duration" className="h-9 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODULE_QUIZ_DURATIONS.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {durationLabel(m)}
                          {m === DEFAULT_MODULE_QUIZ_DURATION ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Students have this long once they start the quiz. The timer runs on the server and
                keeps counting even if they leave — you can change it later.
              </p>

              {review ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Sparkles className="h-4 w-4 text-primary" /> {review.items.length} AI draft{" "}
                      {review.items.length === 1 ? "question" : "questions"}
                    </p>
                    {review.result.generated < review.result.requested && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Generated {review.result.generated} of {review.result.requested} requested.
                      </p>
                    )}
                    <ul className="mt-2 space-y-1 text-xs">
                      {review.result.sources.map((s, i) => {
                        const ok = s.status === "analysed" || s.status === "summary";
                        return (
                          <li key={i} className="text-muted-foreground">
                            {ok ? "✓" : "⚠"} <span className="capitalize">{s.modality}</span> —{" "}
                            {s.status === "analysed"
                              ? "Analysed"
                              : s.status === "summary"
                                ? "Summary used"
                                : "Not analysed"}
                            {s.note ? ` (${s.note})` : ""}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <ol className="space-y-2">
                    {review.items.map((q, i) => (
                      <li key={i} className="rounded-xl border border-border bg-card p-3 text-sm">
                        <p className="font-medium">
                          {i + 1}. {q.prompt}
                        </p>
                        <ul className="mt-2 space-y-1">
                          {q.choices.map((c, ci) => (
                            <li
                              key={ci}
                              className={cn(
                                "rounded border px-2 py-1 text-xs",
                                ci === q.correctIndex
                                  ? "border-success/60 bg-success/10"
                                  : "border-border text-muted-foreground",
                              )}
                            >
                              {String.fromCharCode(65 + ci)}. {c}
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="mt-2 text-xs text-destructive hover:underline"
                          onClick={() =>
                            setReview((r) =>
                              r ? { ...r, items: r.items.filter((_, x) => x !== i) } : r,
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="rounded-full"
                      disabled={review.items.length === 0}
                      onClick={() => {
                        const add = review.items
                          .map(cleanDraft)
                          .filter((d): d is QuizDraft => d !== null)
                          .slice(0, room);
                        setQuestions((prev) => [...prev, ...add]);
                        setReview(null);
                      }}
                    >
                      Add {Math.min(review.items.length, room)} to quiz
                    </Button>
                    {questions.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        disabled={review.items.length === 0}
                        onClick={() => {
                          const next = review.items
                            .map(cleanDraft)
                            .filter((d): d is QuizDraft => d !== null)
                            .slice(0, MAX_QUESTIONS);
                          setQuestions(next);
                          setReview(null);
                        }}
                      >
                        Replace draft
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-destructive hover:text-destructive"
                      onClick={() => setReview(null)}
                    >
                      Discard
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      className="rounded-full"
                      disabled={questions.length >= MAX_QUESTIONS}
                      onClick={() => setQDialog({ kind: "new" })}
                    >
                      <Plus className="mr-1.5 h-4 w-4" /> Add question
                    </Button>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={MAX_QUESTIONS}
                        value={aiCount}
                        onChange={(e) => setAiCount(e.target.value)}
                        className="h-9 w-20"
                        aria-label="Number of AI questions"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        disabled={generating || questions.length >= MAX_QUESTIONS}
                        onClick={generate}
                      >
                        {generating ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1.5 h-4 w-4" />
                        )}
                        {generating ? "Generating…" : "Generate with AI"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    AI drafts questions from the module title, description and any text you added in
                    the course content. Every draft is reviewed before it&apos;s added. AI is
                    optional — you can add questions manually.
                  </p>
                  <DifficultyModeField
                    value={aiDifficulty}
                    onChange={setAiDifficulty}
                    disabled={generating}
                  />
                  <p className="text-xs text-muted-foreground">
                    Difficulty applies to the questions AI generates. You can still change any
                    question&apos;s difficulty afterwards.
                  </p>

                  {questions.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-4 text-center text-sm text-destructive">
                      Add at least one quiz question before creating the module.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {questions.map((q, i) => {
                        const invalid = cleanDraft(q) === null;
                        return (
                          <li
                            key={i}
                            className="rounded-xl border border-border bg-card p-3 text-sm"
                          >
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 text-xs text-muted-foreground">{i + 1}</span>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium">{q.prompt || "(no question text)"}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {q.choices.filter(Boolean).length} options · correct:{" "}
                                  {String.fromCharCode(65 + q.correctIndex)} · difficulty{" "}
                                  {q.difficulty}
                                </p>
                                {invalid && (
                                  <p className="mt-1 text-xs text-destructive">
                                    Incomplete — edit before creating.
                                  </p>
                                )}
                                <div className="mt-1.5 flex items-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    aria-label="Move up"
                                    disabled={i === 0}
                                    onClick={() => moveQuestion(i, -1)}
                                  >
                                    <ChevronUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    aria-label="Move down"
                                    disabled={i === questions.length - 1}
                                    onClick={() => moveQuestion(i, 1)}
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setQDialog({ kind: "edit", index: i })}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() =>
                                      setQuestions((prev) => prev.filter((_, x) => x !== i))
                                    }
                                  >
                                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                </Button>
                <Button onClick={submit} disabled={!canCreate}>
                  {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Create module
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <LessonFormDialog
        key={lDialog?.kind === "edit" ? `l-edit-${lDialog.index}` : (lDialog?.kind ?? "closed")}
        open={!!lDialog}
        target={{
          lesson: editingLesson
            ? {
                id: "draft",
                title: editingLesson.title,
                modality: editingLesson.modality,
                body_md: editingLesson.body,
                media_url: editingLesson.source === "url" ? editingLesson.url : null,
              }
            : null,
          pendingFile: editingLesson?.file ?? null,
        }}
        saving={false}
        onClose={() => setLDialog(null)}
        onSubmit={(value) => {
          if (lDialog?.kind === "edit") {
            const idx = lDialog.index;
            setLessons((prev) => prev.map((l, x) => (x === idx ? value : l)));
          } else {
            setLessons((prev) => [...prev, value]);
          }
          setLDialog(null);
        }}
      />

      <QuizQuestionDialog
        key={qDialog?.kind === "edit" ? `q-edit-${qDialog.index}` : (qDialog?.kind ?? "closed")}
        open={!!qDialog}
        title={qDialog?.kind === "edit" ? "Edit question" : "Add question"}
        initial={editingQuestion}
        saving={false}
        onClose={() => setQDialog(null)}
        onSubmit={(draft) => {
          if (qDialog?.kind === "edit") {
            const idx = qDialog.index;
            setQuestions((prev) => prev.map((q, x) => (x === idx ? draft : q)));
          } else if (questions.length < MAX_QUESTIONS) {
            setQuestions((prev) => [...prev, draft]);
          }
          setQDialog(null);
        }}
      />
    </>
  );
}
