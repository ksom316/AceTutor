import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Lightbulb, Timer, Trophy, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFitSquare } from "@/hooks/use-fit-square";
import { cellKey } from "@/lib/crossword";
import { formatDuration } from "@/lib/game-stats";
import { entryCells, lineBetween, type PlacedEntry, type WordSearch } from "@/lib/wordsearch";
import { cn } from "@/lib/utils";

type Props = {
  puzzle: WordSearch;
  /** Course title, or "All my courses". */
  courseLabel: string;
  /** True when the puzzle mixes courses, so the word list shows its source. */
  showSources?: boolean;
  onSolved: (info: { seconds: number; hints: number }) => void;
  /** Rebuild another puzzle of the same game and difficulty. */
  onPlayAgain: () => void;
  /** Leave the board and return to the setup screen. */
  onNewPuzzle: () => void;
};

type Cell = { row: number; col: number };

export function WordSearchBoard({
  puzzle,
  courseLabel,
  showSources = false,
  onSolved,
  onPlayAgain,
  onNewPuzzle,
}: Props) {
  const [found, setFound] = useState<Set<string>>(new Set());
  const [foundCells, setFoundCells] = useState<Set<string>>(new Set());
  const [hintedWords, setHintedWords] = useState<Set<string>>(new Set());
  const [hints, setHints] = useState(0);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [solved, setSolved] = useState(false);

  const reportedRef = useRef(false);

  // Cells size to the available board area so the whole grid fits the screen on
  // start rather than pushing out a scrollbar. On lg+ the board area is square
  // (see gridBox below), so the fit is driven by the available width and the
  // grid grows to fill it; the fit logic shrinks it on smaller screens. The
  // upper bound just stops cells getting cartoonishly large on wide monitors.
  const gridBox = useRef<HTMLDivElement>(null);
  const cell = useFitSquare(gridBox, puzzle.size, puzzle.size, 2, { max: 120 });
  const cellPx = cell || 32;

  const total = puzzle.words.length;
  const remaining = total - found.size;

  // Timer runs until every word is found.
  useEffect(() => {
    if (solved) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [solved]);

  useEffect(() => {
    if (total > 0 && found.size === total) setSolved(true);
  }, [found, total]);

  useEffect(() => {
    if (!solved || reportedRef.current) return;
    reportedRef.current = true;
    onSolved({ seconds, hints });
  }, [solved, seconds, hints, onSolved]);

  // A drag can end anywhere on the page, so release is tracked globally.
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  /** The straight run currently being selected, if any. */
  const selection = useMemo(() => {
    if (!anchor) return null;
    return lineBetween(anchor, hover ?? anchor);
  }, [anchor, hover]);

  const selectedKeys = useMemo(
    () => new Set((selection ?? []).map((c) => cellKey(c.row, c.col))),
    [selection],
  );

  const markFound = useCallback((entry: PlacedEntry) => {
    setFound((prev) => new Set(prev).add(entry.answer));
    setFoundCells((prev) => {
      const next = new Set(prev);
      for (const { row, col } of entryCells(entry)) next.add(cellKey(row, col));
      return next;
    });
  }, []);

  /** Check a completed drag/click run against the words still to find. */
  const commit = useCallback(
    (cells: Cell[]) => {
      const forward = cells.map(({ row, col }) => puzzle.grid[row][col]).join("");
      const backward = [...forward].reverse().join("");

      const hit = puzzle.words.find(
        (w) => !found.has(w.answer) && (w.answer === forward || w.answer === backward),
      );

      if (hit) {
        markFound(hit);
      } else {
        // Brief shake so a wrong run gives feedback without blocking play.
        setRejected(true);
        setTimeout(() => setRejected(false), 350);
      }

      setAnchor(null);
      setHover(null);
    },
    [found, markFound, puzzle.grid, puzzle.words],
  );

  const handlePointerDown = (row: number, col: number) => {
    if (solved) return;
    // Second tap on a different cell completes a click-click selection —
    // handy on touch screens where dragging across a grid is fiddly.
    if (anchor && (anchor.row !== row || anchor.col !== col)) {
      const cells = lineBetween(anchor, { row, col });
      if (cells) {
        commit(cells);
        return;
      }
    }
    setAnchor({ row, col });
    setHover({ row, col });
    setDragging(true);
  };

  const handlePointerEnter = (row: number, col: number) => {
    if (!dragging || solved) return;
    setHover({ row, col });
  };

  const handlePointerUp = (row: number, col: number) => {
    if (!anchor || solved) return;
    // A tap without movement keeps the anchor armed for a second tap.
    if (anchor.row === row && anchor.col === col) return;
    const cells = lineBetween(anchor, { row, col });
    if (cells) commit(cells);
    else {
      setAnchor(null);
      setHover(null);
    }
  };

  const toggleHint = (answer: string) => {
    setHintedWords((prev) => {
      if (prev.has(answer)) {
        const next = new Set(prev);
        next.delete(answer);
        return next;
      }
      setHints((h) => h + 1);
      return new Set(prev).add(answer);
    });
  };

  const locate = (entry: PlacedEntry) => {
    if (found.has(entry.answer)) return;
    markFound(entry);
    setHints((h) => h + 1);
  };

  if (total === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          This puzzle came back empty. Try generating a new one.
        </p>
        <Button onClick={onNewPuzzle} className="mt-4 rounded-full">
          Back to setup
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:min-h-full">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Timer className="h-3.5 w-3.5" /> {formatDuration(seconds)}
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Check className="h-3.5 w-3.5" /> {found.size}/{total} found
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5" /> {hints} hint{hints === 1 ? "" : "s"}
        </span>
      </div>

      {solved && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative shrink-0 overflow-hidden rounded-3xl border border-border bg-card p-8 text-center"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-20 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full bg-success/20 blur-3xl"
          />
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.2 }}
            className="relative mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success/15 text-success"
          >
            <Trophy className="h-6 w-6" />
          </motion.div>
          <p className="relative mt-4 text-xs uppercase tracking-widest text-muted-foreground">
            All words found
          </p>
          <p className="relative mt-1 font-display text-5xl text-primary">
            {formatDuration(seconds)}
          </p>
          <p className="relative mt-2 text-sm text-muted-foreground">
            {courseLabel} · {total} words · {hints} hint{hints === 1 ? "" : "s"} used
          </p>
          <Button onClick={onPlayAgain} className="relative mt-6 rounded-full">
            Play another
          </Button>
        </motion.div>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:items-start lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Letter grid */}
        <div className="flex flex-col rounded-3xl border border-border bg-card p-3 shadow-sm sm:p-4">
          <div
            ref={gridBox}
            className="flex max-h-[75svh] w-full items-center justify-center overflow-auto lg:max-h-none lg:aspect-square lg:overflow-visible"
          >
            <motion.div
              animate={rejected ? { x: [0, -6, 6, -4, 0] } : { x: 0 }}
              transition={{ duration: 0.3 }}
              role="grid"
              aria-label={`Word search for ${courseLabel}`}
              // Paper-white board with dark letters, so it reads the same in
              // light and dark mode.
              className="grid w-max shrink-0 gap-[2px] rounded-lg border-2 border-neutral-800 bg-neutral-800 p-[2px] select-none"
              style={{ gridTemplateColumns: `repeat(${puzzle.size}, ${cellPx}px)` }}
            >
              {puzzle.grid.map((row, r) =>
                row.map((letter, c) => {
                  const key = cellKey(r, c);
                  const isFound = foundCells.has(key);
                  const isSelected = selectedKeys.has(key);
                  const isAnchor = anchor?.row === r && anchor?.col === c;

                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`Row ${r + 1}, column ${c + 1}: ${letter}`}
                      onPointerDown={() => handlePointerDown(r, c)}
                      onPointerEnter={() => handlePointerEnter(r, c)}
                      onPointerUp={() => handlePointerUp(r, c)}
                      style={{
                        width: cellPx,
                        height: cellPx,
                        fontSize: Math.max(11, Math.round(cellPx * 0.46)),
                      }}
                      className={cn(
                        "grid place-items-center rounded-[2px] text-center font-bold uppercase leading-none transition-colors",
                        isFound
                          ? "bg-emerald-200 text-emerald-900"
                          : isSelected
                            ? "bg-violet-300 text-neutral-900"
                            : "bg-white text-neutral-900 hover:bg-violet-100",
                        isAnchor && "ring-2 ring-inset ring-primary",
                      )}
                    >
                      {letter}
                    </button>
                  );
                }),
              )}
            </motion.div>
          </div>

          <p className="mt-3 shrink-0 text-center text-xs text-muted-foreground">
            Drag across a word — or tap its first and last letter. Words run in any direction.
          </p>
        </div>

        {/* Word list — beside the grid on desktop, stacked below it on narrow
            screens. Sticky + viewport-capped so it stays usable while a large
            board scrolls past it. */}
        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm lg:sticky lg:top-0 lg:max-h-[calc(100svh-8rem)] lg:overflow-y-auto">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-base">Words to find</h3>
            <span className="text-xs text-muted-foreground">{remaining} left</span>
          </div>
          <ul className="mt-2 space-y-1">
            {[...puzzle.words]
              .sort((a, b) => a.answer.localeCompare(b.answer))
              .map((word) => {
                const isFound = found.has(word.answer);
                const hintOpen = hintedWords.has(word.answer);

                return (
                  <li key={word.answer} className="rounded-xl px-2.5 py-2 hover:bg-secondary/60">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm font-semibold tracking-wide",
                          isFound ? "text-muted-foreground line-through" : "text-foreground",
                        )}
                      >
                        {word.answer}
                      </span>
                      {isFound ? (
                        <Check className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleHint(word.answer)}
                            aria-label={`${hintOpen ? "Hide" : "Show"} what ${word.answer} means`}
                            aria-pressed={hintOpen}
                            className={cn(
                              "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors",
                              hintOpen
                                ? "bg-primary/15 text-primary"
                                : "text-muted-foreground hover:bg-secondary hover:text-primary",
                            )}
                          >
                            <Lightbulb className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => locate(word)}
                            aria-label={`Reveal where ${word.answer} is`}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                    {showSources && word.source && (
                      <p className="truncate text-[11px] text-muted-foreground">{word.source}</p>
                    )}
                    {hintOpen && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-1.5 overflow-hidden rounded-lg bg-secondary/70 px-2.5 py-1.5 text-xs text-muted-foreground"
                      >
                        {word.clue}
                      </motion.p>
                    )}
                  </li>
                );
              })}
          </ul>
          {puzzle.unplaced.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {puzzle.unplaced.length} term{puzzle.unplaced.length === 1 ? "" : "s"} didn't fit this
              grid.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
