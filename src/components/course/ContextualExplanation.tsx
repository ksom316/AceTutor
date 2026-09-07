import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIContentRenderer } from "@/components/course/AIContentRenderer";
import { cn } from "@/lib/utils";
import { askCourse } from "@/lib/course-chat.functions";
import type { SelectionAnchor } from "@/components/course/ExplainSelectionButton";

/**
 * The compact "AceTutor Explanation" popup shown as a FLOATING card next to the
 * passage the student highlighted — a contextual assistant, not the full
 * chatbot. It portals to <body> and positions itself against the selection
 * anchor from `ExplainSelectionButton`, flipping above/below and clamping to
 * stay on-screen; on small screens it becomes a bottom sheet.
 *
 * Nothing about the AI request changed: every call still goes through the same
 * `askCourse` server function (same modes, same course-context + Learning-
 * Preferences machinery, key server-side). Only selected text + lesson context
 * are sent. This file only changed how the result is *rendered*.
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

const CARD_MAX_W = 560;
const CARD_EST_H = 420; // pre-measure estimate for first placement
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 10;
const MOBILE_QUERY = "(max-width: 639px)";

type Placement = { top: number; left: number; width: number };

/** Fixed-position placement for the card, from the selection anchor. Prefers
 *  below the selection, flips above when it doesn't fit, and always clamps into
 *  the viewport. `cardHeight` is the measured card height (or an estimate). */
function computePlacement(anchor: SelectionAnchor, cardHeight: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_MAX_W, vw - 2 * VIEWPORT_MARGIN);
  const h = Math.min(cardHeight || CARD_EST_H, vh - 2 * VIEWPORT_MARGIN);

  // The selection may have scrolled since "Explain" was clicked — offset by the delta.
  const dy = window.scrollY - anchor.scrollY;
  const dx = window.scrollX - anchor.scrollX;
  const selTop = anchor.top - dy;
  const selBottom = anchor.bottom - dy;
  const selCenterX = anchor.left - dx + anchor.width / 2;

  let left = selCenterX - width / 2;
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), vw - width - VIEWPORT_MARGIN);

  const fitsBelow = selBottom + ANCHOR_GAP + h <= vh - VIEWPORT_MARGIN;
  const fitsAbove = selTop - ANCHOR_GAP - h >= VIEWPORT_MARGIN;
  let top = fitsBelow || !fitsAbove ? selBottom + ANCHOR_GAP : selTop - ANCHOR_GAP - h;
  top = Math.min(
    Math.max(top, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN),
  );

  return { top, left, width };
}

export function ContextualExplanation({
  selectedText,
  lessonTitle,
  anchor,
  context,
  onClose,
}: {
  selectedText: string;
  lessonTitle: string | null;
  anchor: SelectionAnchor;
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

  // Fire the first explanation once, when the popup opens for this selection.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    request.mutate({ mode: "explain_selection", replace: true });
  }, [request]);

  const mainExplanation = useMemo(
    () =>
      [...blocks]
        .reverse()
        .find((b) => b.mode === "explain_selection" || b.mode === "explain_simpler")?.content,
    [blocks],
  );

  const retryLast = () => {
    const v = request.variables;
    request.mutate(v ?? { mode: "explain_selection", replace: true });
  };

  const busy = request.isPending;
  const hasContent = blocks.length > 0;

  /* ---------------- floating placement ---------------- */

  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  const [placement, setPlacement] = useState<Placement>(() => computePlacement(anchor, CARD_EST_H));

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Reposition on mount, whenever the content (and therefore height) changes,
  // and on scroll / resize. Mobile is a bottom sheet, so no placement math there.
  useLayoutEffect(() => {
    if (isMobile) return;
    const update = () =>
      setPlacement(
        computePlacement(anchor, cardRef.current?.getBoundingClientRect().height ?? CARD_EST_H),
      );
    update();

    let raf = 0;
    const onScrollResize = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [anchor, isMobile, blocks.length, busy, request.isError]);

  // Escape + click-outside close. The opening click is already finished by the
  // time this mounts, so it never self-closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  // Keep the newest content in view.
  const prevLen = useRef(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = blocks.length > prevLen.current ? el.scrollHeight : 0;
    prevLen.current = blocks.length;
  }, [blocks.length]);

  return createPortal(
    <>
      {/* Dimmer for the mobile bottom sheet only. */}
      <div
        className="fixed inset-0 z-40 bg-foreground/10 sm:hidden"
        aria-hidden
        onClick={onClose}
      />

      <section
        ref={cardRef}
        role="dialog"
        aria-label="AceTutor explanation"
        tabIndex={-1}
        style={
          isMobile
            ? undefined
            : {
                position: "fixed",
                top: placement.top,
                left: placement.left,
                width: placement.width,
                maxHeight: `min(620px, calc(100vh - ${2 * VIEWPORT_MARGIN}px))`,
              }
        }
        className={cn(
          "z-50 flex flex-col overflow-hidden rounded-2xl border border-primary/25 bg-background shadow-2xl outline-none",
          isMobile && "fixed inset-x-3 bottom-3 max-h-[85vh] rounded-3xl",
        )}
      >
        {/* Sticky header — keeps the highlighted passage visible. */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-base">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              AceTutor Explanation
            </p>
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
              &ldquo;{selectedText}&rdquo;
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close explanation"
            className="-mr-1.5 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable body. */}
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {blocks.map((b) => (
            <div key={b.id}>
              {BLOCK_LABEL[b.mode] && (
                <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {b.mode === "quiz_selection" ? (
                    <Lightbulb className="h-3 w-3" aria-hidden />
                  ) : (
                    <Sparkles className="h-3 w-3" aria-hidden />
                  )}
                  {BLOCK_LABEL[b.mode]}
                </p>
              )}
              <div className="prose-lesson max-w-none break-words text-[15px] leading-relaxed text-foreground">
                <AIContentRenderer content={b.content} />
              </div>
            </div>
          ))}

          {busy && (
            <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {hasContent ? "Thinking…" : "AceTutor is looking at this…"}
            </p>
          )}

          {request.isError && !busy && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
              <span>{GENERIC_ERROR}</span>
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={retryLast}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          )}
        </div>

        {/* Sticky footer — follow-up actions. */}
        {hasContent && !busy && !request.isError && (
          <footer className="flex shrink-0 flex-wrap gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 px-3.5"
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
              className="h-9 px-3.5"
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
              className="h-9 px-3.5"
              onClick={() => request.mutate({ mode: "quiz_selection", replace: false })}
            >
              Quiz me on this
            </Button>
          </footer>
        )}
      </section>
    </>,
    document.body,
  );
}
