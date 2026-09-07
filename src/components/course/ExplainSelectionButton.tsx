import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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

/** Touch devices show a native selection toolbar (Copy / Share / Select All)
 *  right above the selection. On those, keep the AceTutor action well clear of
 *  it — below the selection when there's room, otherwise pushed far above. */
const TOUCH_QUERY = "(max-width: 639px), (pointer: coarse)";
const BUTTON_MIN_H = 44; // px — touch target
const VIEWPORT_EDGE = 12; // px — keep the button inside the viewport
const GAP_BELOW = 14; // px — selection → button, placing below
const GAP_ABOVE_DESKTOP = 8; // px — selection → button, placing above (mouse)
const TOOLBAR_CLEARANCE = 56; // px — extra offset above the selection on touch

/** A selection worth explaining: not just whitespace/punctuation, not the
 *  whole page. */
function isMeaningfulSelection(text: string): boolean {
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

/** Where the highlighted passage sits, captured when "Explain" is clicked, so
 *  the explanation popup can anchor itself to it (and follow it on scroll). */
export type SelectionAnchor = {
  /** viewport-relative selection rect at click time */
  top: number;
  bottom: number;
  left: number;
  width: number;
  /** page scroll at click time — the popup offsets by the delta while scrolling */
  scrollX: number;
  scrollY: number;
};

export type LessonSelection = {
  text: string;
  lessonTitle: string | null;
  anchor: SelectionAnchor;
};

type Anchor = {
  x: number;
  y: number;
  /** true → the button sits BELOW `y`; false → above it (`-translate-y-full`). */
  below: boolean;
  selTop: number;
  selBottom: number;
  selLeft: number;
  selWidth: number;
  text: string;
  lessonTitle: string | null;
};

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

  const [isTouch, setIsTouch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(TOUCH_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(TOUCH_QUERY);
    const sync = () => setIsTouch(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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

      // Vertical placement. On touch, avoid the strip right above the selection
      // where the native Copy / Share toolbar sits: go below when there's room,
      // otherwise push well clear above it.
      const roomBelow = window.innerHeight - rect.bottom - GAP_BELOW - BUTTON_MIN_H - VIEWPORT_EDGE;
      let below: boolean;
      let y: number;
      if (isTouch) {
        if (roomBelow >= 0) {
          below = true;
          y = rect.bottom + GAP_BELOW;
        } else {
          below = false;
          y = Math.max(rect.top - TOOLBAR_CLEARANCE, VIEWPORT_EDGE);
        }
      } else {
        below = false;
        y = Math.max(rect.top - GAP_ABOVE_DESKTOP, 48);
      }

      setAnchor({
        x: Math.min(Math.max(rect.left + rect.width / 2, 100), window.innerWidth - 100),
        y,
        below,
        selTop: rect.top,
        selBottom: rect.bottom,
        selLeft: rect.left,
        selWidth: rect.width,
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
  }, [enabled, containerRef, isTouch]);

  if (!anchor) return null;

  return createPortal(
    <button
      ref={btnRef}
      type="button"
      // Keep the native selection alive while the click is processed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onExplain({
          text: anchor.text,
          lessonTitle: anchor.lessonTitle,
          anchor: {
            top: anchor.selTop,
            bottom: anchor.selBottom,
            left: anchor.selLeft,
            width: anchor.selWidth,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          },
        });
        setAnchor(null);
        window.getSelection()?.removeAllRanges();
      }}
      style={{ position: "fixed", left: anchor.x, top: anchor.y }}
      className={cn(
        "z-50 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-primary/30 bg-background px-4 text-sm font-semibold text-primary shadow-lg transition-transform hover:scale-[1.03] active:scale-95",
        anchor.below ? "" : "-translate-y-full",
      )}
    >
      <Sparkles className="h-4 w-4" aria-hidden />
      Explain with AceTutor
    </button>,
    document.body,
  );
}
