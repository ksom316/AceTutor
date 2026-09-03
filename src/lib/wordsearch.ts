/**
 * Word-search generation. Pure TypeScript, no DOM — takes the same
 * answer/clue/hint entries the crossword uses (see src/lib/crossword.ts) and
 * hides the answers in a letter grid.
 */
import { shuffle, type CrosswordClue } from "@/lib/crossword";

/** Step per direction, as [rowDelta, colDelta]. */
const ORTHOGONAL: [number, number][] = [
  [0, 1], // →
  [1, 0], // ↓
];
const DIAGONAL: [number, number][] = [
  [1, 1], // ↘
  [1, -1], // ↙
];

export type PlacedEntry = CrosswordClue & {
  row: number;
  col: number;
  dRow: number;
  dCol: number;
};

export type WordSearch = {
  size: number;
  /** `grid[row][col]` — every cell holds a letter. */
  grid: string[][];
  words: PlacedEntry[];
  /** Answers that wouldn't fit after repeated attempts. */
  unplaced: string[];
};

export type WordSearchOptions = {
  /** Grid edge length. Grown automatically if the longest word won't fit. */
  size?: number;
  /** Allow ↘ / ↙ placements. */
  diagonals?: boolean;
  /** Allow words to run backwards along any direction. */
  reverse?: boolean;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PLACEMENT_ATTEMPTS = 220;

/** Cells a placed entry occupies, in reading order along its direction. */
export function entryCells(entry: PlacedEntry): { row: number; col: number }[] {
  return Array.from({ length: entry.answer.length }, (_, i) => ({
    row: entry.row + entry.dRow * i,
    col: entry.col + entry.dCol * i,
  }));
}

export function buildWordSearch(clues: CrosswordClue[], opts?: WordSearchOptions): WordSearch {
  const wanted = opts?.size ?? 12;
  const longest = clues.reduce((m, c) => Math.max(m, c.answer.length), 0);
  // The grid must at least hold the longest word, plus a little slack so
  // there's somewhere to hide it.
  const size = Math.max(wanted, longest + 1);

  const grid: (string | null)[][] = Array.from({ length: size }, () =>
    Array<string | null>(size).fill(null),
  );

  const directions: [number, number][] = [...ORTHOGONAL];
  if (opts?.diagonals) directions.push(...DIAGONAL);
  if (opts?.reverse) {
    for (const [dr, dc] of [...directions]) directions.push([-dr, -dc]);
  }

  const words: PlacedEntry[] = [];
  const unplaced: string[] = [];

  const fits = (answer: string, row: number, col: number, dRow: number, dCol: number) => {
    for (let i = 0; i < answer.length; i++) {
      const r = row + dRow * i;
      const c = col + dCol * i;
      if (r < 0 || r >= size || c < 0 || c >= size) return false;
      const existing = grid[r][c];
      // Crossing another word is fine as long as the shared cell agrees.
      if (existing !== null && existing !== answer[i]) return false;
    }
    return true;
  };

  // Longest first — the hardest words to place get the emptiest grid.
  for (const clue of [...clues].sort((a, b) => b.answer.length - a.answer.length)) {
    let placed = false;

    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && !placed; attempt++) {
      const [dRow, dCol] = directions[Math.floor(Math.random() * directions.length)];
      const row = Math.floor(Math.random() * size);
      const col = Math.floor(Math.random() * size);
      if (!fits(clue.answer, row, col, dRow, dCol)) continue;

      for (let i = 0; i < clue.answer.length; i++) {
        grid[row + dRow * i][col + dCol * i] = clue.answer[i];
      }
      words.push({ ...clue, row, col, dRow, dCol });
      placed = true;
    }

    if (!placed) unplaced.push(clue.answer);
  }

  // Fill the gaps. Drawing from the letters already in play (with a dash of
  // the full alphabet) keeps decoy letters from standing out.
  const pool = words.flatMap((w) => w.answer.split("")).join("") + ALPHABET;
  const filled = grid.map((row) =>
    row.map((cell) => cell ?? pool[Math.floor(Math.random() * pool.length)]),
  );

  return { size, grid: filled, words: shuffle(words), unplaced };
}

/**
 * The straight line between two cells, or `null` when they aren't aligned
 * horizontally, vertically, or on a 45° diagonal.
 */
export function lineBetween(
  from: { row: number; col: number },
  to: { row: number; col: number },
): { row: number; col: number }[] | null {
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;
  if (dRow === 0 && dCol === 0) return [from];
  const straight = dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol);
  if (!straight) return null;

  const steps = Math.max(Math.abs(dRow), Math.abs(dCol));
  const stepRow = Math.sign(dRow);
  const stepCol = Math.sign(dCol);
  return Array.from({ length: steps + 1 }, (_, i) => ({
    row: from.row + stepRow * i,
    col: from.col + stepCol * i,
  }));
}
