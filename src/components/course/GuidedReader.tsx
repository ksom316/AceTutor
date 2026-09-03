import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReaderSection = {
  key: string;
  /** Heading shown above this section's body. Optional. */
  heading?: string;
  body: ReactNode;
};

type GuidedReaderProps = {
  sections: ReaderSection[];
  /** When this changes the reader jumps back to the first page (e.g. a new
   *  study path id, or a different lesson). */
  resetKey: string;
  /** Accessible name for the reader region. */
  ariaLabel: string;
  /** Word before the step number — "Step" (default) or "Part". */
  stepWord?: string;
  /** Rendered on the last page in place of "Next →". Omit for a plain page end. */
  finalCta?: ReactNode;
  className?: string;
};

/**
 * A small guided, book-like reader: shows one section at a time with
 * Back / Next, a "Step N of M" label and a dot progress indicator. Page state is
 * local React state only — no routing, no history entries, no persistence.
 * Purely presentational; the caller decides what a "section" contains.
 */
export function GuidedReader({
  sections,
  resetKey,
  ariaLabel,
  stepWord = "Step",
  finalCta,
  className,
}: GuidedReaderProps) {
  const total = sections.length;
  const [index, setIndex] = useState(0);
  const regionRef = useRef<HTMLElement>(null);
  const mountedRef = useRef(false);

  // Reset to the first page whenever the underlying content changes.
  useEffect(() => {
    setIndex(0);
  }, [resetKey]);

  const current = Math.min(index, Math.max(0, total - 1));

  // On a page change, bring the reader back to the top of the viewport — but
  // only if it has actually scrolled out of view above (so short sections don't
  // jump). Not on the first render.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const el = regionRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: "start" });
    }
  }, [current]);

  const stepBy = (delta: number) =>
    setIndex((i) => Math.max(0, Math.min(total - 1, Math.min(i, total - 1) + delta)));
  const goPrev = () => stepBy(-1);
  const goNext = () => stepBy(1);

  // Left / Right arrow keys — only while focus is inside this reader (so it works
  // right after clicking Back/Next, and multiple readers on a page never fight),
  // and never while typing or with a modifier held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = regionRef.current;
      if (!el || !el.contains(document.activeElement)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      setIndex((i) => Math.max(0, Math.min(total - 1, Math.min(i, total - 1) + delta)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  if (total === 0) return null;

  const section = sections[current];
  const isFirst = current === 0;
  const isLast = current === total - 1;

  return (
    <section
      ref={regionRef}
      aria-label={ariaLabel}
      aria-roledescription="guided reader"
      className={cn("scroll-mt-20 rounded-2xl border border-border bg-card p-6 md:p-8", className)}
    >
      {/* Progress — an explicit "X of Y" plus a slim bar. */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-foreground" aria-live="polite">
            {stepWord} {current + 1}{" "}
            <span className="font-normal text-muted-foreground">of {total}</span>
          </p>
          {!isLast && (
            <p className="text-xs text-muted-foreground">
              {total - current - 1} {stepWord.toLowerCase()}
              {total - current - 1 === 1 ? "" : "s"} left
            </p>
          )}
        </div>
        <div
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={current + 1}
          aria-label={`${stepWord} ${current + 1} of ${total}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${((current + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="mt-5">
        {section.heading && (
          <h2 className="font-display text-2xl leading-tight text-foreground">{section.heading}</h2>
        )}
        <div className={cn(section.heading && "mt-4")}>{section.body}</div>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <Button variant="ghost" onClick={goPrev} disabled={isFirst}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        {isLast ? (
          (finalCta ?? <span aria-hidden="true" />)
        ) : (
          <Button onClick={goNext}>
            Next <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        )}
      </div>
    </section>
  );
}
