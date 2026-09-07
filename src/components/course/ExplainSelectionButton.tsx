import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

/**
 * "Explain with AceTutor" — a small floating action that appears next to a
 * meaningful text/code selection made INSIDE `containerRef`. Purely additive:
 * it never changes the native selection, it only reads it. Clicking it hands
 * the selected text (and the containing lesson's title, read from the nearest
 * `[data-lesson-title]`) to `onExplain`.
 *
 * No AI, no network, no storage here — it is just selection UX.
 */

const MIN_CHARS = 3;
const MAX_CHARS = 800;

/** A selection worth explaining: not just whitespace/punctuation, not the
 *  whole page. */
function isMeaningfulSelection(text: string): boolean {
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

export type LessonSelection = { text: string; lessonTitle: string | null };

type Anchor = { x: number; y: number } & LessonSelection;

export function ExplainSelectionButton({
  containerRef,
  enabled,
  onExplain,
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onExplain: (selection: LessonSelection) => void;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!enabled) {
      setAnchor(null);
      return;
    }

    const clear = () => setAnchor(null);

    const evaluate = () => {
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return clear();

      const text = sel.toString().trim();
      if (!isMeaningfulSelection(text)) return clear();

      const range = sel.getRangeAt(0);
      const container = containerRef.current;
      if (!container || !container.contains(range.commonAncestorContainer)) return clear();

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return clear();

      const startEl =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      const lessonTitle =
        startEl?.closest("[data-lesson-title]")?.getAttribute("data-lesson-title") ?? null;

      setAnchor({
        x: Math.min(Math.max(rect.left + rect.width / 2, 88), window.innerWidth - 88),
        y: Math.max(rect.top - 8, 48),
        text: text.slice(0, MAX_CHARS),
        lessonTitle,
      });
    };

    // Show/refresh after a selection gesture; hide the instant it collapses.
    const onPointerUp = () => window.setTimeout(evaluate, 0);
    const onKeyUp = (e: KeyboardEvent) => {
      // keyboard selection: Shift+Arrows, or Ctrl/Cmd+A select-all
      if (e.shiftKey || e.key.startsWith("Arrow") || ((e.ctrlKey || e.metaKey) && e.key === "a")) {
        window.setTimeout(evaluate, 0);
      }
    };
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) clear();
    };
    let raf = 0;
    const onScrollOrResize = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(evaluate);
    };
    const onPointerDownOutside = (e: PointerEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) clear();
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDownOutside);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDownOutside);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [enabled, containerRef]);

  if (!anchor) return null;

  return createPortal(
    <button
      ref={btnRef}
      type="button"
      // Keep the native selection alive while the click is processed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onExplain({ text: anchor.text, lessonTitle: anchor.lessonTitle });
        setAnchor(null);
        window.getSelection()?.removeAllRanges();
      }}
      style={{ position: "fixed", left: anchor.x, top: anchor.y }}
      className="z-50 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border border-primary/30 bg-background px-3 py-1.5 text-xs font-semibold text-primary shadow-lg transition-transform hover:scale-[1.03] active:scale-95"
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      Explain with AceTutor
    </button>,
    document.body,
  );
}
