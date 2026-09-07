import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Lightbulb, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { askCourse } from "@/lib/course-chat.functions";

/**
 * The compact "AceTutor Explanation" panel shown next to a lesson after the
 * student highlights a passage and clicks "Explain with AceTutor".
 *
 * It is NOT the full chatbot — no conversation, nothing persisted. Every
 * request goes through the SAME `askCourse` server function (same OpenRouter
 * path, same course-context + Learning-Preferences machinery, key stays
 * server-side). Only the selected text + lesson context are sent.
 */

export type ExplainContext = {
  courseId?: string;
  courseTitle: string;
  moduleTitle?: string;
  moduleTopicId?: string;
  moduleSummary?: string;
};

type ExplainMode = "explain_selection" | "explain_simpler" | "another_example" | "quiz_selection";

type Block = { id: number; mode: ExplainMode; content: string };

const BLOCK_LABEL: Partial<Record<ExplainMode, string>> = {
  explain_simpler: "Simpler explanation",
  another_example: "Another example",
  quiz_selection: "Practice question",
};

const GENERIC_ERROR = "Couldn't generate an explanation right now. Try again.";

export function ContextualExplanation({
  selectedText,
  lessonTitle,
  context,
  onClose,
}: {
  selectedText: string;
  lessonTitle: string | null;
  context: ExplainContext;
  onClose: () => void;
}) {
  const ask = useServerFn(askCourse);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const nextId = useRef(0);

  const request = useMutation({
    mutationFn: async (v: { mode: ExplainMode; replace: boolean; prior?: string }) => {
      const res = await ask({
        data: {
          mode: v.mode,
          courseId: context.courseId,
          courseTitle: context.courseTitle,
          moduleTitle: context.moduleTitle,
          moduleTopicId: context.moduleTopicId,
          moduleSummary: context.moduleSummary,
          lessonTitle: lessonTitle ?? undefined,
          selectedText,
          priorExplanation: v.prior?.slice(0, 4000),
        },
      });
      const content =
        res && typeof res === "object" && "answer" in res && typeof res.answer === "string"
          ? res.answer.trim()
          : "";
      if (!content) throw new Error("empty");
      return { mode: v.mode, replace: v.replace, content };
    },
    onSuccess: ({ mode, replace, content }) => {
      const block: Block = { id: ++nextId.current, mode, content };
      setBlocks((prev) => (replace ? [block] : [...prev, block]));
    },
  });

  // Fire the first explanation once, when the panel opens for this selection.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    request.mutate({ mode: "explain_selection", replace: true });
  }, [request]);

  // The "main" explanation the follow-ups build on (latest full explanation).
  const mainExplanation = useMemo(
    () =>
      [...blocks]
        .reverse()
        .find((b) => b.mode === "explain_selection" || b.mode === "explain_simpler")?.content,
    [blocks],
  );

  const retryLast = () => {
    const v = request.variables;
    if (v) request.mutate(v);
    else request.mutate({ mode: "explain_selection", replace: true });
  };

  const busy = request.isPending;
  const hasContent = blocks.length > 0;

  return (
    <section
      aria-label="AceTutor explanation"
      className="mt-6 rounded-2xl border border-primary/25 bg-primary/5 p-5 md:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-lg">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          AceTutor Explanation
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close explanation"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground">
        You highlighted:{" "}
        <span className="font-medium text-foreground">
          &ldquo;{selectedText.length > 180 ? `${selectedText.slice(0, 180)}…` : selectedText}
          &rdquo;
        </span>
      </p>

      <div className="mt-4 space-y-4">
        {blocks.map((b) => (
          <div key={b.id}>
            {BLOCK_LABEL[b.mode] && (
              <p className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                {b.mode === "quiz_selection" ? (
                  <Lightbulb className="h-3 w-3" aria-hidden />
                ) : (
                  <Sparkles className="h-3 w-3" aria-hidden />
                )}
                {BLOCK_LABEL[b.mode]}
              </p>
            )}
            <div className="prose-lesson max-w-none break-words text-sm text-foreground">
              <ReactMarkdown>{b.content}</ReactMarkdown>
            </div>
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {hasContent ? "Thinking…" : "AceTutor is looking at this…"}
          </p>
        )}

        {request.isError && !busy && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <span>{GENERIC_ERROR}</span>
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={retryLast}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        )}
      </div>

      {hasContent && !busy && !request.isError && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              request.mutate({ mode: "explain_simpler", replace: true, prior: mainExplanation })
            }
          >
            Explain differently
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              request.mutate({ mode: "another_example", replace: false, prior: mainExplanation })
            }
          >
            Give another example
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => request.mutate({ mode: "quiz_selection", replace: false })}
          >
            Quiz me on this
          </Button>
        </div>
      )}
    </section>
  );
}
