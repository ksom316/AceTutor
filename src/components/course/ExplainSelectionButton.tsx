import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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

/** Touch devices show a native selection toolbar (Copy / Share / Select All)
 *  hugging the selection ABOVE or BELOW it — never beside it. So on touch we
 *  prefer a SIDE placement and only fall back to below / (last resort) above. */
const TOUCH_QUERY = "(max-width: 639px), (pointer: coarse)";

const EDGE = 12; // px — keep the button this far inside the viewport
const SEL_GAP = 16; // px — required minimum spacing from the selection
const BELOW_GAP = 24; // px — a little more room below, to clear a toolbar shown there
const ABOVE_CLEARANCE = 52; // px — last-resort above: clear the toolbar shown above
/** Estimates for the first placement; corrected once the button is measured. */
const BTN_W_EST = 196;
const BTN_H_EST = 44;

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

type SelBox = { top: number; bottom: number; left: number; right: number };

type Anchor = {
  /** button top-left corner in viewport coords */
  left: number;
  top: number;
  /** the selection's bounding box (viewport coords) — kept so the button can be
   *  re-placed against it once its real size is measured */
  sel: SelBox;
  text: string;
  lessonTitle: string | null;
};

/**
 * Pick the safest on-screen spot for the button given the selection box and the
 * button's size. Desktop keeps the existing "pill just above the selection".
 *
 * Touch priority (the native selection toolbar sits above/below, never beside):
 *   1. right of the selection   — if `btnW + 16px` fits
 *   2. left  of the selection   — if `btnW + 16px` fits
 *   3. below the selection      — if `btnH + 24px` fits
 *   4. above the selection      — last resort, pushed clear of the toolbar
 *
 * Everything is clamped inside the viewport (12px margin).
 */
function placeButton(
  sel: SelBox,
  btnW: number,
  btnH: number,
  isTouch: boolean,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(EDGE, vw - btnW - EDGE));
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), Math.max(EDGE, vh - btnH - EDGE));
  const cx = (sel.left + sel.right) / 2;
  const cy = (sel.top + sel.bottom) / 2;

  if (!isTouch) {
    return { left: clampX(cx - btnW / 2), top: clampY(Math.max(sel.top - 8, 48) - btnH) };
  }

  if (vw - EDGE - sel.right >= SEL_GAP + btnW) {
    return { left: sel.right + SEL_GAP, top: clampY(cy - btnH / 2) };
  }
  if (sel.left - EDGE >= SEL_GAP + btnW) {
    return { left: sel.left - SEL_GAP - btnW, top: clampY(cy - btnH / 2) };
  }
  if (vh - EDGE - sel.bottom >= BELOW_GAP + btnH) {
    return { left: clampX(cx - btnW / 2), top: sel.bottom + BELOW_GAP };
  }
  return { left: clampX(cx - btnW / 2), top: clampY(sel.top - ABOVE_CLEARANCE - btnH) };
}

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

      const selBox: SelBox = {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
      // First pass with the button-size estimate; a layout effect corrects it
      // with the measured size before the browser paints.
      const measured = btnRef.current?.getBoundingClientRect();
      const p = placeButton(
        selBox,
        measured?.width || BTN_W_EST,
        measured?.height || BTN_H_EST,
        isTouch,
      );

      setAnchor({
        left: p.left,
        top: p.top,
        sel: selBox,
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

  // Re-place with the button's REAL size, before paint, so it never jumps and
  // the "does it fit on this side" checks use accurate dimensions.
  useLayoutEffect(() => {
    const el = btnRef.current;
    if (!el || !anchor) return;
    const r = el.getBoundingClientRect();
    const p = placeButton(anchor.sel, r.width, r.height, isTouch);
    if (Math.abs(p.left - anchor.left) > 0.5 || Math.abs(p.top - anchor.top) > 0.5) {
      setAnchor((a) => (a ? { ...a, left: p.left, top: p.top } : a));
    }
  }, [anchor, isTouch]);

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
            top: anchor.sel.top,
            bottom: anchor.sel.bottom,
            left: anchor.sel.left,
            width: anchor.sel.right - anchor.sel.left,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          },
        });
        setAnchor(null);
        window.getSelection()?.removeAllRanges();
      }}
      style={{ position: "fixed", left: anchor.left, top: anchor.top }}
      className="z-50 inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/30 bg-background px-4 text-sm font-semibold text-primary shadow-lg transition-transform hover:scale-[1.03] active:scale-95"
    >
      <Sparkles className="h-4 w-4" aria-hidden />
      Explain with AceTutor
    </button>,
    document.body,
  );
}
