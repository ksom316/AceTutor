import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  ArrowUp,
  Compass,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { useAiConversation, type SendVars, type TutorMode } from "@/hooks/use-ai-conversation";
import { QuizMeDialog } from "@/components/course/QuizMeDialog";

type FocusModule = { id: string; title: string; summary: string | null } | null;

const QUICK_ACTIONS: { mode: Exclude<TutorMode, "ask" | "guide" | "test">; label: string }[] = [
  { mode: "explain", label: "📘 Explain Topic" },
  { mode: "summarize", label: "📄 Summarize Lecture" },
  { mode: "general", label: "🧭 General Overview" },
];

const MODE_TAG: Record<string, string> = {
  guide: "Guided",
  explain: "Explain",
  summarize: "Summary",
  test: "Test",
  general: "Overview",
};

/**
 * The course AI tutor — one persistent, course-grounded conversation. Quick
 * actions and Guide Me (Socratic mode) all post into the same thread; mode is
 * tracked per message, so switching never clears history. Reloading restores the
 * transcript from Supabase.
 */
export function CourseTutorChat({
  courseId,
  courseTitle,
  courseSummary,
  topics,
  activeModule,
  onClearModule,
  enrolled,
}: {
  courseId: string;
  courseTitle: string;
  courseSummary?: string;
  topics: { id: string; title: string }[];
  activeModule: FocusModule;
  onClearModule: () => void;
  enrolled: boolean;
}) {
  const { messages, isLoading, send, startNewConversation, clearCourseConversations } =
    useAiConversation(courseId);
  const [input, setInput] = useState("");
  const [guideMode, setGuideMode] = useState(false);
  const [quizMeOpen, setQuizMeOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  type Attempt = Omit<SendVars, "courseTitle" | "courseSummary" | "signal">;
  const lastAttemptRef = useRef<Attempt | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the transcript pinned to the latest turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, send.isPending]);

  const requireEnroll = () => {
    toast.error("Enroll to use the AI tutor", {
      description: "You need to be enrolled in this course to use AI features.",
    });
  };

  const post = (vars: Attempt) => {
    if (!enrolled) return requireEnroll();
    if (send.isPending) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastAttemptRef.current = vars;
    send.mutate({
      ...vars,
      courseTitle,
      courseSummary,
      moduleTitle: vars.moduleTitle ?? activeModule?.title,
      moduleSummary: vars.moduleSummary ?? activeModule?.summary ?? undefined,
      moduleTopicId: vars.moduleTopicId ?? activeModule?.id,
      topicId: activeModule?.id ?? null,
      signal: controller.signal,
    });
  };

  const submitTyped = () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    post({ mode: guideMode ? "guide" : "ask", question: q });
  };

  const runQuickAction = (mode: Exclude<TutorMode, "ask" | "guide">) => {
    setGuideMode(false);
    post({ mode });
  };

  const notRelated =
    send.data && "res" in send.data && send.data.res.related === false ? send.data.res : null;

  const showError =
    send.isError &&
    !/abort/i.test((send.error as Error)?.message ?? "") &&
    (send.error as Error)?.name !== "AbortError";

  // The turn currently in flight (or just answered but not yet refetched), shown
  // optimistically so the transcript never appears to "lose" the message.
  const lastAnswer =
    send.isSuccess && send.data && "res" in send.data && send.data.res.related !== false
      ? send.data.res.answer
      : null;
  const answerPersisted =
    !!lastAnswer && messages.some((m) => m.role === "assistant" && m.content === lastAnswer);
  const pendingTurn =
    (send.isPending || (send.isSuccess && !answerPersisted && !notRelated)) &&
    lastAttemptRef.current
      ? {
          text:
            lastAttemptRef.current.question?.trim() ||
            QUICK_ACTIONS.find((a) => a.mode === lastAttemptRef.current!.mode)?.label ||
            (lastAttemptRef.current.mode === "guide" ? "…" : "…"),
          mode: lastAttemptRef.current.mode,
          answer: send.isPending ? null : lastAnswer,
        }
      : null;

  const emptyThread = messages.length === 0 && !pendingTurn && !send.isPending;

  const placeholder = useMemo(
    () =>
      guideMode
        ? "Tell me what you're trying to work out — I'll guide you step by step…"
        : "Ask anything about this course (explain a topic, help me revise, work through a problem…)",
    [guideMode],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-primary" /> AI Course Tutor
          {activeModule && (
            <Badge variant="secondary" className="font-normal">
              Focused on: {activeModule.title}
              <button
                type="button"
                onClick={onClearModule}
                aria-label="Clear focused module"
                className="ml-2 text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </Badge>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                setGuideMode(false);
                startNewConversation();
              }}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> New chat
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={clearCourseConversations.isPending}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Clear conversation
            </button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Transcript */}
        <div
          ref={scrollRef}
          className="max-h-[55vh] min-h-[8rem] space-y-4 overflow-y-auto rounded-xl border border-border bg-background/40 p-4"
        >
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your conversation…
            </p>
          ) : emptyThread ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ask a question, use a quick action below, or turn on{" "}
              <span className="font-medium text-foreground">Guide Me</span> to be coached through a
              problem step by step.
            </p>
          ) : (
            messages.map((m) => (
              <MessageBubble key={m.id} role={m.role} content={m.content} mode={m.mode} />
            ))
          )}

          {pendingTurn && (
            <>
              <MessageBubble role="user" content={pendingTurn.text} mode={pendingTurn.mode} />
              {pendingTurn.answer ? (
                <MessageBubble
                  role="assistant"
                  content={pendingTurn.answer}
                  mode={pendingTurn.mode}
                />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {pendingTurn.mode === "guide" ? "Thinking about how to guide you…" : "Thinking…"}
                </div>
              )}
            </>
          )}
          {showError && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <span>Couldn&apos;t get a response. Your conversation is safe.</span>
              {lastAttemptRef.current && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => post(lastAttemptRef.current!)}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          {notRelated && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-sm text-muted-foreground">
                {notRelated.reason || `Try asking something specific to ${courseTitle}.`}
              </p>
            </div>
          )}
        </div>

        {/* Guided-mode banner */}
        {guideMode && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <Compass className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-foreground">
              Guided mode is on — I&apos;ll coach you one step at a time instead of giving the
              answer.
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-xs"
              onClick={() => setGuideMode(false)}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Exit guided mode
            </Button>
          </div>
        )}

        {/* Composer */}
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-3 shadow-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitTyped();
                }
              }}
              rows={1}
              placeholder={placeholder}
              className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || send.isPending}
              className="h-9 w-9 shrink-0 rounded-full"
              aria-label="Send"
            >
              {send.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>

        {/* Quick actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={guideMode ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            aria-pressed={guideMode}
            disabled={send.isPending}
            onClick={() => {
              if (!enrolled) return requireEnroll();
              setGuideMode((v) => !v);
              inputRef.current?.focus();
            }}
          >
            <Compass className="mr-1.5 h-3.5 w-3.5" />
            {guideMode ? "Guide Me · on" : "Guide Me"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={send.isPending}
            onClick={() => {
              if (!enrolled) return requireEnroll();
              setQuizMeOpen(true);
            }}
          >
            <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Quiz Me
          </Button>
          {QUICK_ACTIONS.map(({ mode, label }) => (
            <Button
              key={mode}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={send.isPending}
              onClick={() => runQuickAction(mode)}
            >
              {label}
            </Button>
          ))}
        </div>
      </CardContent>

      <QuizMeDialog
        open={quizMeOpen}
        onOpenChange={setQuizMeOpen}
        courseId={courseId}
        topics={topics}
        focusedTopicId={activeModule?.id}
      />

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this course&apos;s AI conversation history?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium">all</span> of your AI tutor
              conversations for <span className="font-medium">{courseTitle}</span> and their
              messages. It can&apos;t be undone from the chat. Your quizzes, Mastery Score,
              progress, learning preferences and other courses&apos; conversations are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmClear(false);
                abortRef.current?.abort();
                setGuideMode(false);
                clearCourseConversations.mutate(undefined, {
                  onSuccess: () => toast.success("Conversation history cleared"),
                  onError: (e) =>
                    toast.error((e as Error)?.message || "Couldn't clear the conversation"),
                });
              }}
            >
              Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function MessageBubble({
  role,
  content,
  mode,
}: {
  role: "user" | "assistant";
  content: string;
  mode: string;
}) {
  const isUser = role === "user";
  const tag = !isUser && MODE_TAG[mode];
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-card text-foreground",
        )}
      >
        {tag && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            {tag}
          </span>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose-lesson max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
