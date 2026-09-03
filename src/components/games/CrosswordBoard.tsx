import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCheck, Eraser, Lightbulb, Sparkles, Timer, Trophy, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFitSquare } from "@/hooks/use-fit-square";
import { cellKey, wordCells, type Direction, type PlacedWord, type Puzzle } from "@/lib/crossword";
import { formatDuration } from "@/lib/game-stats";
import { cn } from "@/lib/utils";

type Props = {
  puzzle: Puzzle;
  /** Course title, or "All my courses" — shown in the header and saved with the result. */
  courseLabel: string;
  /** True when the puzzle mixes courses, so clue rows show their source. */
  showSources?: boolean;
  onSolved: (info: { seconds: number; hints: number }) => void;
  /** Rebuild another puzzle of the same game and difficulty. */
  onPlayAgain: () => void;
  /** Leave the board and return to the setup screen. */
  onNewPuzzle: () => void;
};

const wordId = (w: PlacedWord) => `${w.number}-${w.dir}`;

export function CrosswordBoard({
  puzzle,
  courseLabel,
  showSources = false,
  onSolved,
  onPlayAgain,
  onNewPuzzle,
}: Props) {
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [hintedWords, setHintedWords] = useState<Set<string>>(new Set());
  const [hints, setHints] = useState(0);
  const [checking, setChecking] = useState(false);
  const [active, setActive] = useState<{ row: number; col: number; dir: Direction }>(() => {
    const first = puzzle.words.find((w) => w.dir === "across") ?? puzzle.words[0];
    return first
      ? { row: first.row, col: first.col, dir: first.dir }
      : { row: 0, col: 0, dir: "across" };
  });
  const [seconds, setSeconds] = useState(0);
  const [solved, setSolved] = useState(false);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  // Notified once per puzzle, from an effect — never during render.
  const reportedRef = useRef(false);

  // The grid sizes its cells to whatever space the board area has, so the whole
  // puzzle fits the screen on start instead of pushing out a scrollbar. The
  // upper bound is generous so the board grows to fill a large desktop instead
  // of sitting small in the middle; on laptops/phones the fit logic shrinks it.
  const gridBox = useRef<HTMLDivElement>(null);
  const cell = useFitSquare(gridBox, puzzle.cols, puzzle.rows, 2, { max: 88 });
  const cellPx = cell || 32;

  const across = useMemo(
    () => puzzle.words.filter((w) => w.dir === "across").sort((a, b) => a.number - b.number),
    [puzzle.words],
  );
  const down = useMemo(
    () => puzzle.words.filter((w) => w.dir === "down").sort((a, b) => a.number - b.number),
    [puzzle.words],
  );

  /** Words covering a cell, keyed "row,col". */
  const wordsByCell = useMemo(() => {
    const map = new Map<string, PlacedWord[]>();
    for (const w of puzzle.words) {
      for (const { row, col } of wordCells(w)) {
        const key = cellKey(row, col);
        const list = map.get(key);
        if (list) list.push(w);
        else map.set(key, [w]);
      }
    }
    return map;
  }, [puzzle.words]);

  /** Grid number to render in a cell, if a word starts there. */
  const numberByCell = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of puzzle.words) map.set(cellKey(w.row, w.col), w.number);
    return map;
  }, [puzzle.words]);

  const activeWord = useMemo(() => {
    const candidates = wordsByCell.get(cellKey(active.row, active.col)) ?? [];
    return candidates.find((w) => w.dir === active.dir) ?? candidates[0] ?? null;
  }, [wordsByCell, active]);

  const activeCells = useMemo(
    () => new Set((activeWord ? wordCells(activeWord) : []).map((c) => cellKey(c.row, c.col))),
    [activeWord],
  );

  const totalCells = useMemo(
    () => puzzle.grid.flat().filter((c) => c !== null).length,
    [puzzle.grid],
  );
  const filledCells = useMemo(() => Object.values(letters).filter(Boolean).length, [letters]);

  // Timer runs until the puzzle is solved.
  useEffect(() => {
    if (solved) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [solved]);

  // Solve detection: every open cell holds its solution letter.
  useEffect(() => {
    if (solved || totalCells === 0) return;
    for (let r = 0; r < puzzle.rows; r++) {
      for (let c = 0; c < puzzle.cols; c++) {
        const answer = puzzle.grid[r][c];
        if (answer === null) continue;
        if (letters[cellKey(r, c)] !== answer) return;
      }
    }
    setSolved(true);
  }, [letters, puzzle, solved, totalCells]);

  useEffect(() => {
    if (!solved || reportedRef.current) return;
    reportedRef.current = true;
    onSolved({ seconds, hints });
  }, [solved, seconds, hints, onSolved]);

  const focusCell = useCallback((row: number, col: number) => {
    inputs.current.get(cellKey(row, col))?.focus();
  }, []);

  const isOpen = useCallback(
    (row: number, col: number) =>
      row >= 0 &&
      row < puzzle.rows &&
      col >= 0 &&
      col < puzzle.cols &&
      puzzle.grid[row][col] !== null,
    [puzzle],
  );

  /** Step along the active direction, skipping blocked cells. */
  const step = useCallback(
    (row: number, col: number, dir: Direction, delta: number) => {
      const nextRow = dir === "down" ? row + delta : row;
      const nextCol = dir === "across" ? col + delta : col;
      if (!isOpen(nextRow, nextCol)) return null;
      return { row: nextRow, col: nextCol };
    },
    [isOpen],
  );

  const selectCell = (row: number, col: number) => {
    const here = wordsByCell.get(cellKey(row, col)) ?? [];
    const sameCell = active.row === row && active.col === col;
    // Re-clicking the current cell flips direction when it belongs to both an
    // across and a down word.
    const flipped: Direction = active.dir === "across" ? "down" : "across";
    const dir =
      sameCell && here.some((w) => w.dir === flipped)
        ? flipped
        : here.some((w) => w.dir === active.dir)
          ? active.dir
          : (here[0]?.dir ?? active.dir);
    setActive({ row, col, dir });
    focusCell(row, col);
  };

  const setLetter = (row: number, col: number, value: string) => {
    const key = cellKey(row, col);
    setChecking(false);
    setLetters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };

  const handleChange = (row: number, col: number, raw: string) => {
    const letter = raw
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(-1);
    if (!letter) return;
    setLetter(row, col, letter);
    const next = step(row, col, active.dir, 1);
    if (next) {
      setActive({ ...next, dir: active.dir });
      focusCell(next.row, next.col);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const move = (dir: Direction, delta: number) => {
      e.preventDefault();
      const next = step(row, col, dir, delta);
      setActive({ row: next?.row ?? row, col: next?.col ?? col, dir });
      if (next) focusCell(next.row, next.col);
    };

    switch (e.key) {
      case "ArrowRight":
        return move("across", 1);
      case "ArrowLeft":
        return move("across", -1);
      case "ArrowDown":
        return move("down", 1);
      case "ArrowUp":
        return move("down", -1);
      case " ": {
        e.preventDefault();
        setActive({ row, col, dir: active.dir === "across" ? "down" : "across" });
        return;
      }
      case "Backspace": {
        e.preventDefault();
        const key = cellKey(row, col);
        if (letters[key]) {
          setLetter(row, col, "");
          return;
        }
        // Empty cell — clear the previous one and move back into it.
        const prev = step(row, col, active.dir, -1);
        if (prev) {
          setLetter(prev.row, prev.col, "");
          setActive({ ...prev, dir: active.dir });
          focusCell(prev.row, prev.col);
        }
        return;
      }
      default:
        return;
    }
  };

  const selectWord = (word: PlacedWord) => {
    setActive({ row: word.row, col: word.col, dir: word.dir });
    focusCell(word.row, word.col);
  };

  const toggleHint = (word: PlacedWord) => {
    const id = wordId(word);
    setHintedWords((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      // Each word's hint costs one hint the first time it's opened.
      setHints((h) => h + 1);
      return new Set(prev).add(id);
    });
  };

  const revealLetter = () => {
    const answer = puzzle.grid[active.row]?.[active.col];
    if (!answer || letters[cellKey(active.row, active.col)] === answer) return;
    setLetter(active.row, active.col, answer);
    setRevealed((prev) => new Set(prev).add(cellKey(active.row, active.col)));
    setHints((h) => h + 1);
  };

  const revealWord = () => {
    if (!activeWord) return;
    const cells = wordCells(activeWord);
    setChecking(false);
    setLetters((prev) => {
      const next = { ...prev };
      for (const { row, col } of cells) {
        const answer = puzzle.grid[row][col];
        if (answer) next[cellKey(row, col)] = answer;
      }
      return next;
    });
    setRevealed((prev) => {
      const next = new Set(prev);
      for (const { row, col } of cells) next.add(cellKey(row, col));
      return next;
    });
    setHints((h) => h + 1);
  };

  const clearAll = () => {
    setLetters({});
    setRevealed(new Set());
    setChecking(false);
  };

  const accuracy =
    totalCells > 0 ? Math.round(((totalCells - revealed.size) / totalCells) * 100) : 0;

  if (puzzle.words.length === 0) {
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
    <div className="flex flex-col gap-4 lg:h-full">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Timer className="h-3.5 w-3.5" /> {formatDuration(seconds)}
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5" /> {hints} hint{hints === 1 ? "" : "s"}
        </span>
        <span className="hidden rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
          {filledCells}/{totalCells} cells
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => setChecking(true)}
            disabled={solved}
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" /> Check
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={revealLetter}
            disabled={solved}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Letter
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={revealWord}
            disabled={solved || !activeWord}
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Word
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={clearAll}
            disabled={solved}
          >
            <Eraser className="mr-1.5 h-3.5 w-3.5" /> Clear
          </Button>
        </div>
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
            Puzzle solved
          </p>
          <p className="relative mt-1 font-display text-5xl text-primary">
            {formatDuration(seconds)}
          </p>
          <p className="relative mt-2 text-sm text-muted-foreground">
            {courseLabel} · {hints} hint{hints === 1 ? "" : "s"} used · {accuracy}% solved unaided
          </p>
          <Button onClick={onPlayAgain} className="relative mt-6 rounded-full">
            Play another
          </Button>
        </motion.div>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Grid */}
        <div className="flex flex-col rounded-3xl border border-border bg-card p-3 shadow-sm sm:p-4 lg:h-full lg:min-h-0 lg:flex-none">
          <div
            ref={gridBox}
            className="flex max-h-[75svh] w-full items-center justify-center overflow-auto lg:max-h-none lg:min-h-0 lg:flex-1"
          >
            {/* The board frames itself against the card: blocked squares are
                filled with the foreground colour and open squares keep a solid
                outline, so the grid reads clearly in light and dark mode. */}
            <div
              role="grid"
              aria-label={`Crossword puzzle for ${courseLabel}`}
              className="grid w-max shrink-0 gap-[2px] rounded-lg border-2 border-neutral-800 bg-neutral-800 p-[2px]"
              style={{ gridTemplateColumns: `repeat(${puzzle.cols}, ${cellPx}px)` }}
            >
              {puzzle.grid.map((row, r) =>
                row.map((answer, c) => {
                  const key = cellKey(r, c);
                  if (answer === null) {
                    return (
                      <div
                        key={key}
                        aria-hidden
                        className="rounded-[2px] bg-neutral-800"
                        style={{ width: cellPx, height: cellPx }}
                      />
                    );
                  }

                  const value = letters[key] ?? "";
                  const isActiveCell = active.row === r && active.col === c;
                  const inActiveWord = activeCells.has(key);
                  const wrong = checking && value !== "" && value !== answer;
                  const number = numberByCell.get(key);

                  return (
                    <div key={key} className="relative" style={{ width: cellPx, height: cellPx }}>
                      {number !== undefined && (
                        <span className="pointer-events-none absolute left-[2px] top-0 z-10 text-[9px] font-bold leading-tight text-neutral-500">
                          {number}
                        </span>
                      )}
                      <input
                        ref={(el) => {
                          if (el) inputs.current.set(key, el);
                          else inputs.current.delete(key);
                        }}
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        value={value}
                        readOnly={solved}
                        aria-label={`Row ${r + 1}, column ${c + 1}`}
                        onChange={(e) => handleChange(r, c, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, r, c)}
                        // Selecting the existing letter makes typing overwrite
                        // it instead of appending.
                        onFocus={(e) => {
                          e.target.select();
                          setActive((prev) => ({ ...prev, row: r, col: c }));
                        }}
                        // pointerdown (not click) fires before focus, so the
                        // direction toggle still sees the previously active cell.
                        onPointerDown={() => selectCell(r, c)}
                        style={{ fontSize: Math.max(11, Math.round(cellPx * 0.46)) }}
                        className={cn(
                          "h-full w-full rounded-[2px] text-center font-bold uppercase caret-transparent outline-none transition-colors",
                          // The board keeps a paper-white surface in both themes
                          // so letters and blocked squares always read clearly.
                          wrong
                            ? "bg-red-100 text-red-700"
                            : revealed.has(key)
                              ? "bg-emerald-100 text-emerald-800"
                              : inActiveWord
                                ? "bg-violet-100 text-neutral-900"
                                : "bg-white text-neutral-900",
                          isActiveCell && "ring-2 ring-inset ring-primary",
                        )}
                      />
                    </div>
                  );
                }),
              )}
            </div>
          </div>

          {activeWord && !solved && (
            <p className="mt-3 shrink-0 rounded-xl bg-secondary/60 px-4 py-2.5 text-sm">
              <span className="font-semibold text-primary">
                {activeWord.number} {activeWord.dir === "across" ? "Across" : "Down"}
              </span>{" "}
              <span className="text-muted-foreground">
                ({activeWord.answer.length}) — {activeWord.clue}
              </span>
            </p>
          )}
        </div>

        {/* Clues — beside the grid on desktop, stacked below it on narrow screens. */}
        <div className="space-y-4 lg:h-full lg:shrink lg:overflow-y-auto lg:pr-1">
          <ClueList
            title="Across"
            words={across}
            activeId={activeWord ? wordId(activeWord) : null}
            hintedWords={hintedWords}
            letters={letters}
            showSources={showSources}
            onSelect={selectWord}
            onToggleHint={toggleHint}
          />
          <ClueList
            title="Down"
            words={down}
            activeId={activeWord ? wordId(activeWord) : null}
            hintedWords={hintedWords}
            letters={letters}
            showSources={showSources}
            onSelect={selectWord}
            onToggleHint={toggleHint}
          />
        </div>
      </div>
    </div>
  );
}

function ClueList({
  title,
  words,
  activeId,
  hintedWords,
  letters,
  showSources,
  onSelect,
  onToggleHint,
}: {
  title: string;
  words: PlacedWord[];
  activeId: string | null;
  hintedWords: Set<string>;
  letters: Record<string, string>;
  showSources: boolean;
  onSelect: (word: PlacedWord) => void;
  onToggleHint: (word: PlacedWord) => void;
}) {
  if (words.length === 0) return null;

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
      <h3 className="font-display text-base">{title}</h3>
      <ul className="mt-2 space-y-1">
        {words.map((word) => {
          const id = `${word.number}-${word.dir}`;
          const isActive = id === activeId;
          const hintOpen = hintedWords.has(id);
          const complete = wordCells(word).every(
            ({ row, col }, i) => letters[cellKey(row, col)] === word.answer[i],
          );

          return (
            <li key={id}>
              <div
                className={cn(
                  "rounded-xl px-2.5 py-2 transition-colors",
                  isActive ? "bg-primary/10" : "hover:bg-secondary/60",
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(word)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <span
                      className={cn(
                        "mt-px w-5 shrink-0 text-xs font-bold",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {word.number}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-sm leading-snug",
                          complete ? "text-muted-foreground line-through" : "text-foreground",
                        )}
                      >
                        {word.clue}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({word.answer.length})
                        </span>
                      </span>
                      {showSources && word.source && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {word.source}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleHint(word)}
                    aria-label={`${hintOpen ? "Hide" : "Show"} hint for ${word.number} ${word.dir}`}
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
                </div>
                {hintOpen && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="ml-7 mt-1.5 overflow-hidden rounded-lg bg-secondary/70 px-2.5 py-1.5 text-xs text-muted-foreground"
                  >
                    {word.hint}
                  </motion.p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
