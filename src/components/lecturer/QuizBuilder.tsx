import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { QuizQuestionDialog } from "@/components/lecturer/QuizQuestionDialog";
import {
  blankDraft,
  cleanDraft,
  MAX_QUESTIONS,
  type QuizDraft,
  type QuizQuestionRow,
} from "@/lib/quiz-shared";
import { generateModuleQuiz, type QuizGenResult } from "@/lib/lecturer-quiz.functions";
import {
  analyseModuleCapability,
  type LessonForCapability,
  QUIZ_GEN_ERROR_MESSAGES,
  quizGenErrorMessage,
  type QuizSourceInfo,
} from "@/lib/quiz-capability";
import {
  deadlineStatus,
  fromDatetimeLocalValue,
  localTimezoneLabel,
  toDatetimeLocalValue,
} from "@/lib/course-quiz";
import { DEFAULT_DIFFICULTY_MODE, type DifficultyMode } from "@/lib/quiz-difficulty";
import { DifficultyModeField } from "@/components/lecturer/DifficultyModeField";

/**
 * Shared quiz builder for both a module quiz (`kind: "topic"`) and one of a
 * course's lecturer-created General Course Quizzes (`kind: "course"`, keyed on a
 * specific `course_quizzes.id`). The course quiz id identifies which assessment
 * is being edited; every write and the AI call still derive/verify the course
 * server-side from current_lecturer_course().
 */
export type QuizBuilderScope =
  | { kind: "topic"; topicId: string }
  | { kind: "course"; courseQuizId: string };

export function QuizBuilder({ scope }: { scope: QuizBuilderScope }) {
  const { lecturerCourseId } = useRole();
  const enabled = !!lecturerCourseId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const runGenerate = useServerFn(generateModuleQuiz);
  const isCourse = scope.kind === "course";

  const quizKey =
    scope.kind === "topic"
      ? (["lecturer-quiz", "topic", scope.topicId] as const)
      : (["lecturer-quiz", "course-quiz", scope.courseQuizId] as const);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: quizKey });
    qc.invalidateQueries({ queryKey: ["lecturer-quiz-overview", lecturerCourseId] });
  };

  const [dialog, setDialog] = useState<
    | { kind: "new" }
    | { kind: "edit"; question: QuizQuestionRow }
    | { kind: "draft"; index: number }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<QuizQuestionRow | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCount, setAiCount] = useState("10");
  const [aiDifficulty, setAiDifficulty] = useState<DifficultyMode>(DEFAULT_DIFFICULTY_MODE);
  const [generating, setGenerating] = useState(false);
  const [review, setReview] = useState<{ items: QuizDraft[]; result: QuizGenResult } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDeleteQuiz, setConfirmDeleteQuiz] = useState(false);
  // Basic-info form (course quiz only).
  const [infoTitle, setInfoTitle] = useState("");
  const [infoDescription, setInfoDescription] = useState("");
  const [infoDeadline, setInfoDeadline] = useState("");

  const quizQuery = useQuery({
    queryKey: quizKey,
    enabled,
    queryFn: async () => {
      let containerId: string; // topic id OR course_quiz id
      let headerTitle: string;
      let headerSubtitle: string | null = null;
      let available = true;
      let quizTitle = "";
      let quizDescription = "";
      let quizDeadline: string | null = null;

      if (scope.kind === "topic") {
        const { data: topic, error } = await supabase
          .from("topics")
          .select("id, title, summary, course_id")
          .eq("id", scope.topicId)
          .maybeSingle();
        if (error) throw error;
        available = !!topic && topic.course_id === lecturerCourseId;
        containerId = scope.topicId;
        headerTitle = topic?.title ?? "Module";
        headerSubtitle = topic?.summary ?? null;
      } else {
        const { data: cq, error } = await supabase
          .from("course_quizzes")
          .select("id, title, description, deadline, course_id")
          .eq("id", scope.courseQuizId)
          .maybeSingle();
        if (error) throw error;
        available = !!cq && cq.course_id === lecturerCourseId;
        containerId = scope.courseQuizId;
        quizTitle = cq?.title ?? "General Course Quiz";
        quizDescription = cq?.description ?? "";
        quizDeadline = cq?.deadline ?? null;
        headerTitle = quizTitle;
        headerSubtitle = "General Course Quiz · covers the whole course";
      }

      const questionSelect =
        "id, prompt, choices, correct_index, explanation, difficulty, order_index";
      const { data: rows, error: qErr } =
        scope.kind === "topic"
          ? await supabase
              .from("questions")
              .select(questionSelect)
              .eq("topic_id", scope.topicId)
              .order("order_index")
              .order("id")
          : await supabase
              .from("questions")
              .select(questionSelect)
              .eq("course_quiz_id", scope.courseQuizId)
              .order("order_index")
              .order("id");
      if (qErr) throw qErr;

      let lessonRows: LessonForCapability[] = [];
      if (scope.kind === "topic") {
        const { data: ls, error: lErr } = await supabase
          .from("lessons")
          .select("title, modality, body_md, order_index")
          .eq("topic_id", scope.topicId)
          .order("order_index");
        if (lErr) throw lErr;
        lessonRows = (ls ?? []) as LessonForCapability[];
      } else {
        // Course-wide: every lesson in the lecturer's own course (from role).
        const { data: ls, error: lErr } = await supabase
          .from("lessons")
          .select("title, modality, body_md, order_index, topics!inner(course_id)")
          .eq("topics.course_id", lecturerCourseId!)
          .order("order_index");
        if (lErr) throw lErr;
        lessonRows = (ls ?? []).map((r) => ({
          title: r.title,
          modality: r.modality,
          body_md: r.body_md,
        }));
      }

      const questions: QuizQuestionRow[] = (rows ?? []).map((r) => ({
        id: r.id,
        prompt: r.prompt,
        choices: (r.choices as string[]) ?? [],
        correctIndex: r.correct_index,
        explanation: r.explanation ?? "",
        difficulty: r.difficulty,
        order_index: r.order_index,
      }));

      return {
        available,
        containerId,
        headerTitle,
        headerSubtitle,
        questions,
        lessons: lessonRows,
        quizTitle,
        quizDescription,
        quizDeadline,
      };
    },
  });

  const attemptsQuery = useQuery({
    queryKey:
      scope.kind === "course"
        ? (["lecturer-course-quiz-attempts", scope.courseQuizId] as const)
        : (["lecturer-quiz-performance", lecturerCourseId] as const),
    enabled,
    queryFn: async () => {
      if (scope.kind === "course") {
        const { data, error } = await supabase.rpc("course_quiz_has_attempts", {
          _quiz_id: scope.courseQuizId,
        });
        if (error) throw error;
        return { hasAttempts: !!data };
      }
      const { data, error } = await supabase.rpc("get_course_quiz_performance");
      if (error) throw error;
      return { rows: data ?? [] };
    },
  });

  const data = quizQuery.data;
  const questions = useMemo(() => data?.questions ?? [], [data]);
  const capability = useMemo(() => analyseModuleCapability(data?.lessons ?? []), [data?.lessons]);
  const canGenerate = capability.analysableCount > 0;
  const atLimit = questions.length >= MAX_QUESTIONS;
  const room = Math.max(0, MAX_QUESTIONS - questions.length);
  const hasAttempts = useMemo(() => {
    const a = attemptsQuery.data;
    if (!a) return false;
    if ("hasAttempts" in a) return a.hasAttempts;
    return scope.kind === "topic" && (a.rows ?? []).some((r) => r.topic_id === scope.topicId);
  }, [attemptsQuery.data, scope]);

  // Keep the basic-info form in step with the loaded course quiz.
  useEffect(() => {
    if (!isCourse || !data) return;
    setInfoTitle(data.quizTitle);
    setInfoDescription(data.quizDescription);
    setInfoDeadline(toDatetimeLocalValue(data.quizDeadline));
  }, [isCourse, data]);

  const infoDirty =
    isCourse &&
    !!data &&
    (infoTitle.trim() !== (data.quizTitle ?? "").trim() ||
      infoDescription.trim() !== (data.quizDescription ?? "").trim() ||
      fromDatetimeLocalValue(infoDeadline) !== (data.quizDeadline ?? null));

  /* ---- mutations ---- */

  const containerId = data?.containerId;

  const updateInfo = useMutation({
    mutationFn: async () => {
      if (scope.kind !== "course") return;
      if (!infoTitle.trim()) throw new Error("title");
      const { error } = await supabase.rpc("update_course_quiz", {
        _quiz_id: scope.courseQuizId,
        _title: infoTitle.trim(),
        _description: infoDescription.trim() || undefined,
        _deadline: fromDatetimeLocalValue(infoDeadline) ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Quiz details saved");
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "title") {
        toast.error("Give the quiz a title.");
        return;
      }
      console.error("[quiz-builder] update course quiz failed:", e);
      toast.error("Couldn't save the quiz details. Please try again.");
    },
  });

  const deleteQuiz = useMutation({
    mutationFn: async () => {
      if (scope.kind !== "course") return;
      const { error } = await supabase.rpc("delete_course_quiz", { _quiz_id: scope.courseQuizId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lecturer-quiz-overview", lecturerCourseId] });
      toast.success("General quiz deleted");
      navigate({ to: "/lecturer/quizzes" });
    },
    onError: (e) => {
      console.error("[quiz-builder] delete course quiz failed:", e);
      toast.error("Couldn't delete this quiz. Please try again.");
    },
  });

  const saveQuestion = useMutation({
    mutationFn: async (input: { id?: string; draft: QuizDraft }) => {
      const clean = cleanDraft(input.draft);
      if (!clean) throw new Error("invalid");
      const fields = {
        prompt: clean.prompt,
        choices: clean.choices,
        correct_index: clean.correctIndex,
        explanation: clean.explanation || null,
        difficulty: clean.difficulty,
      };
      if (input.id) {
        const { error } = await supabase.from("questions").update(fields).eq("id", input.id);
        if (error) throw error;
      } else {
        if (questions.length >= MAX_QUESTIONS) throw new Error("full");
        if (!containerId) throw new Error("no container");
        const nextIndex = questions.reduce((m, q) => Math.max(m, q.order_index), -1) + 1;
        const row = { ...fields, order_index: nextIndex };
        const { error } =
          scope.kind === "topic"
            ? await supabase.from("questions").insert({ ...row, topic_id: scope.topicId })
            : await supabase
                .from("questions")
                .insert({ ...row, course_quiz_id: scope.courseQuizId });
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      invalidate();
      toast.success(vars.id ? "Question updated" : "Question added");
      setDialog(null);
    },
    onError: (e) => {
      console.error("[quiz-builder] save question failed:", e);
      toast.error("Couldn't save this question. Please try again.");
    },
  });

  const deleteQuestion = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("questions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Question deleted");
      setDeleteTarget(null);
    },
    onError: () => toast.error("Couldn't delete this question. Please try again."),
  });

  const moveQuestion = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: "up" | "down" }) => {
      const ordered = [...questions].sort((a, b) => a.order_index - b.order_index);
      const i = ordered.findIndex((q) => q.id === id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ordered.length) return;
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      for (let k = 0; k < ordered.length; k++) {
        if (ordered[k].order_index === k) continue;
        const { error } = await supabase
          .from("questions")
          .update({ order_index: k })
          .eq("id", ordered[k].id);
        if (error) throw error;
      }
    },
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't reorder. Please try again."),
  });

  const addGenerated = useMutation({
    mutationFn: async (drafts: QuizDraft[]) => {
      if (!containerId) throw new Error("no container");
      const cleaned = drafts
        .map(cleanDraft)
        .filter((d): d is QuizDraft => d !== null)
        .slice(0, Math.max(0, MAX_QUESTIONS - questions.length));
      if (cleaned.length === 0) throw new Error("empty");
      const base = questions.reduce((m, q) => Math.max(m, q.order_index), -1) + 1;
      const rows = cleaned.map((d, i) => ({
        prompt: d.prompt,
        choices: d.choices,
        correct_index: d.correctIndex,
        explanation: d.explanation || null,
        difficulty: d.difficulty,
        order_index: base + i,
      }));
      const { error } =
        scope.kind === "topic"
          ? await supabase
              .from("questions")
              .insert(rows.map((r) => ({ ...r, topic_id: scope.topicId })))
          : await supabase
              .from("questions")
              .insert(rows.map((r) => ({ ...r, course_quiz_id: scope.courseQuizId })));
      if (error) throw error;
      return { added: cleaned.length, dropped: drafts.length - cleaned.length };
    },
    onSuccess: ({ added, dropped }) => {
      invalidate();
      toast.success(
        `${added} ${added === 1 ? "question" : "questions"} added to the quiz` +
          (dropped > 0 ? ` (${dropped} skipped — 50-question limit)` : ""),
      );
      setReview(null);
    },
    onError: (e) => {
      console.error("[quiz-builder] add generated questions failed:", e);
      toast.error("Couldn't add these questions. Please try again.");
    },
  });

  const replaceGenerated = useMutation({
    mutationFn: async (drafts: QuizDraft[]) => {
      const cleaned = drafts
        .map(cleanDraft)
        .filter((d): d is QuizDraft => d !== null)
        .slice(0, MAX_QUESTIONS);
      if (cleaned.length === 0) throw new Error("empty");
      const payload = cleaned.map((d, i) => ({
        prompt: d.prompt,
        choices: d.choices,
        correct_index: d.correctIndex,
        explanation: d.explanation || null,
        difficulty: d.difficulty,
        order_index: i,
      }));
      const { error } =
        scope.kind === "topic"
          ? await supabase.rpc("replace_topic_quiz", {
              _topic_id: scope.topicId,
              _questions: payload,
            })
          : await supabase.rpc("replace_course_quiz", {
              _quiz_id: scope.courseQuizId,
              _questions: payload,
            });
      if (error) throw error;
      return cleaned.length;
    },
    onSuccess: (n) => {
      invalidate();
      toast.success(`Quiz replaced with ${n} ${n === 1 ? "question" : "questions"}`);
      setConfirmReplace(false);
      setReview(null);
    },
    onError: (e) => {
      console.error("[quiz-builder] replace quiz failed:", e);
      toast.error("Couldn't replace the quiz. Please try again.");
    },
  });

  const generate = async () => {
    const n = Number(aiCount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_QUESTIONS) {
      toast.error(QUIZ_GEN_ERROR_MESSAGES.INVALID_QUESTION_COUNT);
      return;
    }
    if (!canGenerate) {
      toast.error(QUIZ_GEN_ERROR_MESSAGES.NO_ANALYSABLE_CONTENT);
      return;
    }
    setGenerating(true);
    try {
      const res =
        scope.kind === "topic"
          ? await runGenerate({
              data: { topicId: scope.topicId, questionCount: n, difficulty: aiDifficulty },
            })
          : await runGenerate({
              data: {
                courseWide: true,
                courseQuizId: scope.courseQuizId,
                questionCount: n,
                difficulty: aiDifficulty,
              },
            });
      setReview({ items: res.questions.map((q) => ({ ...q })), result: res });
      setAiOpen(false);
    } catch (e) {
      toast.error(quizGenErrorMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  /* ---- render ---- */

  if (quizQuery.isLoading) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-9 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      </main>
    );
  }

  if (quizQuery.isError || !data || !data.available) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl">
          {isCourse ? "General Course Quiz unavailable" : "Module not available"}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {isCourse
            ? "This general course quiz isn't part of your assigned course, or it could not be loaded."
            : "This module isn't part of your assigned course, or it could not be loaded."}
        </p>
        <Button asChild variant="outline" className="mt-6 rounded-full">
          <Link to="/lecturer/quizzes">Back to Quizzes</Link>
        </Button>
      </main>
    );
  }

  const editingDraft = dialog?.kind === "draft" ? (review?.items[dialog.index] ?? null) : null;
  const initialForm: QuizDraft =
    dialog?.kind === "edit"
      ? dialog.question
      : dialog?.kind === "draft"
        ? (editingDraft ?? blankDraft())
        : blankDraft();

  const unit = isCourse ? "general course quiz" : "module";
  const requiredLabel = isCourse ? "No questions yet" : "Quiz required";

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-3xl px-4 py-10"
    >
      <Link
        to="/lecturer/quizzes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Quizzes
      </Link>

      <h1 className="mt-3 font-display text-3xl">{data.headerTitle}</h1>
      {data.headerSubtitle && (
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{data.headerSubtitle}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {questions.length > 0 ? (
          <Badge variant="secondary" className="gap-1">
            {questions.length} / {MAX_QUESTIONS} {questions.length === 1 ? "question" : "questions"}{" "}
            · Quiz ready
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 text-destructive">
            <AlertTriangle className="h-3 w-3" /> {requiredLabel}
          </Badge>
        )}
        {isCourse && data.quizDeadline && (
          <Badge
            variant="outline"
            className={cn(
              "gap-1",
              deadlineStatus(data.quizDeadline) === "passed" &&
                "border-destructive/50 text-destructive",
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {deadlineStatus(data.quizDeadline) === "passed" ? "Deadline passed" : "Has a deadline"}
          </Badge>
        )}
      </div>

      {isCourse && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-medium">Basic information</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Shown to students on the course page. This assessment covers the whole course and is
            separate from the module quizzes.
          </p>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cq-title">Quiz title</Label>
              <Input
                id="cq-title"
                value={infoTitle}
                maxLength={200}
                placeholder="e.g. Mid-Semester Assessment"
                onChange={(e) => setInfoTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cq-description">Description</Label>
              <Textarea
                id="cq-description"
                value={infoDescription}
                maxLength={2000}
                rows={2}
                placeholder="e.g. Assessment covering Modules 1–4"
                onChange={(e) => setInfoDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cq-deadline">Deadline (optional)</Label>
              <Input
                id="cq-deadline"
                type="datetime-local"
                value={infoDeadline}
                onChange={(e) => setInfoDeadline(e.target.value)}
                className="w-full sm:w-72"
              />
              <p className="text-xs text-muted-foreground">
                Times are in your local timezone ({localTimezoneLabel()}). Leave empty for no
                deadline. After the deadline, students can no longer start this assessment.
                {infoDeadline && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={() => setInfoDeadline("")}
                    >
                      Clear
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="rounded-full"
              disabled={!infoDirty || updateInfo.isPending}
              onClick={() => updateInfo.mutate()}
            >
              {updateInfo.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save details
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full text-destructive hover:text-destructive"
              onClick={() => setConfirmDeleteQuiz(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete quiz
            </Button>
          </div>
        </div>
      )}

      {review ? (
        <ReviewPanel
          review={review}
          existingCount={questions.length}
          room={room}
          busy={addGenerated.isPending || replaceGenerated.isPending}
          onEditDraft={(index) => setDialog({ kind: "draft", index })}
          onDeleteDraft={(index) =>
            setReview((r) => (r ? { ...r, items: r.items.filter((_, i) => i !== index) } : r))
          }
          onDiscard={() => setReview(null)}
          onRegenerate={() => {
            setReview(null);
            setAiOpen(true);
          }}
          onAdd={() => addGenerated.mutate(review.items)}
          onReplace={questions.length > 0 ? () => setConfirmReplace(true) : undefined}
        />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              className="rounded-full"
              disabled={atLimit}
              onClick={() => setDialog({ kind: "new" })}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add question
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={atLimit}
              onClick={() => setAiOpen(true)}
            >
              <Sparkles className="mr-1.5 h-4 w-4" /> Generate with AI
            </Button>
            {atLimit && (
              <span className="text-xs text-muted-foreground">
                Maximum {MAX_QUESTIONS} questions per quiz.
              </span>
            )}
          </div>

          {questions.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
              <h2 className="font-display text-xl">
                {isCourse
                  ? "This general quiz has no questions yet"
                  : "No quiz has been created for this module"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {isCourse
                  ? "This assessment covers the whole course. Students take it in addition to the module quizzes. Add questions manually or generate a first draft with AI. Students only see it once it has at least one question."
                  : "Students must complete a quiz after studying this module before it counts as complete. Add questions manually or generate a first draft with AI."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button className="rounded-full" onClick={() => setDialog({ kind: "new" })}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create manually
                </Button>
                <Button variant="outline" className="rounded-full" onClick={() => setAiOpen(true)}>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Generate with AI
                </Button>
              </div>
            </div>
          ) : (
            <ol className="mt-6 space-y-3">
              {questions.map((q, i) => (
                <li key={q.id} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-xs font-medium text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{q.prompt}</p>
                      <ul className="mt-3 space-y-1.5">
                        {q.choices.map((c, ci) => (
                          <li
                            key={ci}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-sm",
                              ci === q.correctIndex
                                ? "border-success/60 bg-success/10 text-foreground"
                                : "border-border text-muted-foreground",
                            )}
                          >
                            <span className="mr-2 font-medium">
                              {String.fromCharCode(65 + ci)}.
                            </span>
                            {c}
                          </li>
                        ))}
                      </ul>
                      {q.explanation && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Why:</span> {q.explanation}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          Difficulty {q.difficulty}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label="Move up"
                          disabled={i === 0 || moveQuestion.isPending}
                          onClick={() => moveQuestion.mutate({ id: q.id, dir: "up" })}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label="Move down"
                          disabled={i === questions.length - 1 || moveQuestion.isPending}
                          onClick={() => moveQuestion.mutate({ id: q.id, dir: "down" })}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDialog({ kind: "edit", question: q })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(q)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <QuizQuestionDialog
        key={
          dialog?.kind === "edit"
            ? dialog.question.id
            : dialog?.kind === "draft"
              ? `draft-${dialog.index}`
              : (dialog?.kind ?? "closed")
        }
        open={!!dialog}
        title={dialog?.kind === "new" ? "Add question" : "Edit question"}
        initial={initialForm}
        saving={saveQuestion.isPending}
        onClose={() => setDialog(null)}
        onSubmit={(draft) => {
          if (dialog?.kind === "draft") {
            setReview((r) =>
              r ? { ...r, items: r.items.map((it, i) => (i === dialog.index ? draft : it)) } : r,
            );
            setDialog(null);
            return;
          }
          saveQuestion.mutate({
            id: dialog?.kind === "edit" ? dialog.question.id : undefined,
            draft,
          });
        }}
      />

      {/* AI generation */}
      <Dialog open={aiOpen} onOpenChange={(o) => !generating && setAiOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate quiz with AI</DialogTitle>
            <DialogDescription>
              {isCourse
                ? "AceTutor generates questions from the analysable learning material across every module in this course. You review and edit every question before anything is saved."
                : "AceTutor generates questions from the analysable learning material in this module. You review and edit every question before anything is saved."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium">
                {isCourse ? "Course learning materials" : "Learning materials"}
              </p>
              {capability.sources.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {isCourse ? "This course has no lessons yet." : "This module has no lessons yet."}
                </p>
              ) : (
                <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-xs">
                  {capability.sources.map((s, i) => (
                    <SourceLine key={i} source={s} />
                  ))}
                </ul>
              )}
            </div>

            {canGenerate ? (
              <>
                <p className="text-xs text-muted-foreground">
                  AI will generate questions from{" "}
                  <span className="font-medium text-foreground">
                    {capability.analysableCount} supported{" "}
                    {capability.analysableCount === 1 ? "material" : "materials"}
                  </span>
                  .{" "}
                  {capability.unsupported.length > 0
                    ? "Unsupported materials (video / audio / slides) will not be used."
                    : ""}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-count">Number of questions</Label>
                  <Input
                    id="ai-count"
                    type="number"
                    min={1}
                    max={MAX_QUESTIONS}
                    value={aiCount}
                    onChange={(e) => setAiCount(e.target.value)}
                    className="w-28"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum: {MAX_QUESTIONS}
                    {questions.length > 0
                      ? ` — this quiz has ${questions.length}. When you add generated questions only ${room} more will fit (or choose Replace).`
                      : ""}
                  </p>
                </div>
                <DifficultyModeField value={aiDifficulty} onChange={setAiDifficulty} />
              </>
            ) : (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  AI generation unavailable for this {unit}
                </p>
                <p className="mt-1">
                  {capability.sources.length === 0
                    ? `This ${isCourse ? "course" : "module"} has no lessons yet. Add a text lesson or a written summary, then try again — or create the ${unit} manually.`
                    : `The available learning materials are ones AceTutor's current AI system cannot analyse yet (video, audio or slides). Add a text lesson or a written summary, or create the ${unit} manually.`}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={generating || !canGenerate}>
              {generating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {generating ? "Generating…" : "Generate questions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete the whole general course quiz */}
      <AlertDialog
        open={confirmDeleteQuiz}
        onOpenChange={(o) => !deleteQuiz.isPending && !o && setConfirmDeleteQuiz(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this general course quiz?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &ldquo;{data.headerTitle}&rdquo; and its {questions.length}{" "}
              {questions.length === 1 ? "question" : "questions"}.
              {hasAttempts
                ? " Students have already attempted this assessment — their attempts and saved results for it are removed too."
                : ""}{" "}
              This action cannot be undone. Module quizzes and other general quizzes are not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteQuiz.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteQuiz.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteQuiz.mutate();
              }}
            >
              {deleteQuiz.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete quiz
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete question */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !deleteQuestion.isPending && !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this question?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
              {hasAttempts
                ? ` This ${unit} already has student attempts — deleting a question also removes it from those students' saved results.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteQuestion.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteQuestion.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteQuestion.mutate(deleteTarget.id);
              }}
            >
              {deleteQuestion.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace whole quiz with generated questions */}
      <AlertDialog
        open={confirmReplace}
        onOpenChange={(o) => !replaceGenerated.isPending && !o && setConfirmReplace(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing quiz?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the current {questions.length}{" "}
              {questions.length === 1 ? "question" : "questions"} from this {unit} and replaces{" "}
              {questions.length === 1 ? "it" : "them"} with the {review?.items.length ?? 0}{" "}
              AI-generated {(review?.items.length ?? 0) === 1 ? "question" : "questions"}.
              {hasAttempts
                ? " Students have already attempted this quiz — their saved results reference the removed questions and will be affected."
                : ""}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={replaceGenerated.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={replaceGenerated.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (review) replaceGenerated.mutate(review.items);
              }}
            >
              {replaceGenerated.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Replace quiz
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.main>
  );
}

/* ------------------------------------------------------------------ */

function SourceLine({ source }: { source: QuizSourceInfo }) {
  const ok = source.status === "analysed" || source.status === "summary";
  const label =
    source.status === "analysed"
      ? "Analysed"
      : source.status === "summary"
        ? "Summary used"
        : "Not analysed";
  return (
    <li className={ok ? "text-muted-foreground" : "text-muted-foreground/90"}>
      {ok ? "✓" : "⚠"} <span className="capitalize">{source.modality}</span> — {label}
      {source.note ? <span className="text-foreground/70"> ({source.note})</span> : null}:{" "}
      <span className="text-foreground">{source.title}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function ReviewPanel({
  review,
  existingCount,
  room,
  busy,
  onEditDraft,
  onDeleteDraft,
  onDiscard,
  onRegenerate,
  onAdd,
  onReplace,
}: {
  review: { items: QuizDraft[]; result: QuizGenResult };
  existingCount: number;
  room: number;
  busy: boolean;
  onEditDraft: (index: number) => void;
  onDeleteDraft: (index: number) => void;
  onDiscard: () => void;
  onRegenerate: () => void;
  onAdd: () => void;
  onReplace?: () => void;
}) {
  const { items, result } = review;
  const willAdd = Math.min(items.length, room);
  const overflow = items.length - willAdd;

  return (
    <div className="mt-6">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" /> Review {items.length} AI-generated{" "}
          {items.length === 1 ? "question" : "questions"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing is saved yet. Edit or delete any question below.
          {existingCount > 0
            ? ` Your ${existingCount} existing ${existingCount === 1 ? "question stays" : "questions stay"} unchanged unless you choose Replace.`
            : ""}
        </p>
        {result.generated < result.requested && (
          <p className="mt-2 text-xs text-muted-foreground">
            Generated {result.generated} of {result.requested} requested — only well-grounded
            questions were kept.
          </p>
        )}
        <ul className="mt-3 space-y-1 text-xs">
          {result.sources.map((s, i) => (
            <SourceLine key={i} source={s} />
          ))}
        </ul>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No questions left. Discard or regenerate.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {items.map((q, i) => (
            <li key={i} className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm font-medium">
                {i + 1}. {q.prompt}
              </p>
              <ul className="mt-3 space-y-1.5">
                {q.choices.map((c, ci) => (
                  <li
                    key={ci}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm",
                      ci === q.correctIndex
                        ? "border-success/60 bg-success/10 text-foreground"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    <span className="mr-2 font-medium">{String.fromCharCode(65 + ci)}.</span>
                    {c}
                  </li>
                ))}
              </ul>
              {q.explanation && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Why:</span> {q.explanation}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  Difficulty {q.difficulty}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => onEditDraft(i)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDeleteDraft(i)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {overflow > 0 && (
        <p className="mt-3 text-xs text-destructive">
          Only {room} more {room === 1 ? "question" : "questions"} fit in this quiz (50 max). Adding
          will keep the first {willAdd}; delete some above, or choose Replace.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          onClick={onAdd}
          disabled={busy || items.length === 0 || room === 0}
          className="rounded-full"
        >
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Add {willAdd} {willAdd === 1 ? "question" : "questions"}
        </Button>
        {onReplace && (
          <Button
            variant="outline"
            className="rounded-full"
            onClick={onReplace}
            disabled={busy || items.length === 0}
          >
            Replace existing quiz
          </Button>
        )}
        <Button variant="outline" className="rounded-full" onClick={onRegenerate} disabled={busy}>
          Regenerate
        </Button>
        <Button
          variant="ghost"
          className="rounded-full text-destructive hover:text-destructive"
          onClick={onDiscard}
          disabled={busy}
        >
          <Trash2 className="mr-1.5 h-4 w-4" /> Discard
        </Button>
      </div>
    </div>
  );
}
