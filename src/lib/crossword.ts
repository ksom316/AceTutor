/**
 * Crossword vocabulary + layout. Pure TypeScript, no dependencies, no DOM —
 * shared by the AI server function (which sanitizes what the model returns)
 * and the /games page (which packs the words into a grid).
 */

/** One crossword entry: the answer, its crossword clue, and an extra nudge. */
export type CrosswordClue = {
  answer: string;
  clue: string;
  /** A shorter, more direct hint revealed on demand from the clue list. */
  hint: string;
  /** Course this term came from — shown when a puzzle mixes several courses. */
  source?: string;
};

export type Direction = "across" | "down";

export type PlacedWord = CrosswordClue & {
  /** Grid number shown in the word's first cell (shared across/down). */
  number: number;
  row: number;
  col: number;
  dir: Direction;
};

export type Puzzle = {
  rows: number;
  cols: number;
  /** `grid[row][col]` is the solution letter, or `null` for a blocked cell. */
  grid: (string | null)[][];
  words: PlacedWord[];
  /** Answers that could not be intersected into the grid. */
  unplaced: string[];
};

/** Key for the board's `letters` map — grids are small, so a string key is fine. */
export const cellKey = (row: number, col: number) => `${row},${col}`;

const MIN_LEN = 3;
const MAX_LEN = 12;

/**
 * Normalize raw answer/clue pairs (from the AI or from course topics) into
 * crossword-safe entries: A–Z uppercase answers of a usable length, non-empty
 * clue and hint, no duplicates.
 */
export function sanitizeClues(raw: unknown, limit = 20): CrosswordClue[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CrosswordClue[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.answer !== "string" || typeof r.clue !== "string") continue;

    const answer = r.answer.toUpperCase().replace(/[^A-Z]/g, "");
    if (answer.length < MIN_LEN || answer.length > MAX_LEN) continue;
    if (seen.has(answer)) continue;

    const clue = r.clue.trim();
    if (!clue) continue;
    // A missing hint shouldn't drop an otherwise good word — fall back to a
    // generic length nudge so every clue still has something to reveal.
    const hint =
      typeof r.hint === "string" && r.hint.trim()
        ? r.hint.trim()
        : `${answer.length} letters, starts with "${answer[0]}".`;

    seen.add(answer);
    out.push({
      answer,
      clue,
      hint,
      source: typeof r.source === "string" && r.source.trim() ? r.source.trim() : undefined,
    });
    if (out.length >= limit) break;
  }

  return out;
}

/** Fisher-Yates. Returns a new array; the input is left alone. */
export function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type Candidate = {
  row: number;
  col: number;
  dir: Direction;
  intersections: number;
};

/**
 * Pack words into a grid by intersecting them on shared letters.
 *
 * The longest word is laid across the middle of a scratch grid, then each
 * remaining word is tried against every matching letter of every placed word.
 * A placement is legal only when it overlaps existing letters exactly, leaves
 * a gap at both ends, and never runs alongside another word — the usual rules
 * that stop two words from fusing into an unintended third one. The best
 * legal placement (most intersections, then most compact) wins; words with no
 * legal placement are reported in `unplaced`.
 *
 * Deterministic for a given input order — shuffle upstream for variety.
 */
export function buildCrossword(clues: CrosswordClue[], opts?: { maxSize?: number }): Puzzle {
  const maxSize = opts?.maxSize ?? 15;
  // The scratch grid is padded so words can grow outward from the centre in
  // any direction before we crop back to the bounding box.
  const scratchSize = maxSize * 2 + 1;
  const grid: (string | null)[][] = Array.from({ length: scratchSize }, () =>
    Array<string | null>(scratchSize).fill(null),
  );

  const usable = clues.filter((c) => c.answer.length <= maxSize);
  const ordered = [...usable].sort((a, b) => b.answer.length - a.answer.length);
  const placed: PlacedWord[] = [];
  const unplaced: string[] = [];

  const letterAt = (row: number, col: number) => {
    if (row < 0 || row >= scratchSize || col < 0 || col >= scratchSize) return null;
    return grid[row][col];
  };

  const canPlace = (answer: string, row: number, col: number, dir: Direction): number | null => {
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    const endRow = row + dr * (answer.length - 1);
    const endCol = col + dc * (answer.length - 1);
    if (row < 0 || col < 0 || endRow >= scratchSize || endCol >= scratchSize) return null;

    // The cells just before and just after the word must be empty, otherwise
    // this word would extend one that is already there.
    if (letterAt(row - dr, col - dc) !== null) return null;
    if (letterAt(endRow + dr, endCol + dc) !== null) return null;

    let intersections = 0;
    for (let i = 0; i < answer.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const existing = letterAt(r, c);

      if (existing !== null) {
        if (existing !== answer[i]) return null;
        intersections += 1;
        continue;
      }

      // An empty cell must not sit beside another word running parallel to
      // this one — that would create an unintended two-letter pairing.
      if (dir === "across") {
        if (letterAt(r - 1, c) !== null || letterAt(r + 1, c) !== null) return null;
      } else {
        if (letterAt(r, c - 1) !== null || letterAt(r, c + 1) !== null) return null;
      }
    }

    // A word that touches nothing would float free of the puzzle.
    return intersections > 0 ? intersections : null;
  };

  const write = (word: CrosswordClue, row: number, col: number, dir: Direction) => {
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    for (let i = 0; i < word.answer.length; i++) {
      grid[row + dr * i][col + dc * i] = word.answer[i];
    }
    placed.push({ ...word, row, col, dir, number: 0 });
  };

  if (ordered.length === 0) {
    return { rows: 0, cols: 0, grid: [], words: [], unplaced: [] };
  }

  // Seed: longest word across the centre.
  const centre = maxSize;
  const first = ordered[0];
  write(first, centre, centre - Math.floor(first.answer.length / 2), "across");

  for (const word of ordered.slice(1)) {
    let best: Candidate | null = null;

    for (const anchor of placed) {
      const dir: Direction = anchor.dir === "across" ? "down" : "across";
      const dr = anchor.dir === "down" ? 1 : 0;
      const dc = anchor.dir === "across" ? 1 : 0;

      for (let ai = 0; ai < anchor.answer.length; ai++) {
        const anchorRow = anchor.row + dr * ai;
        const anchorCol = anchor.col + dc * ai;

        for (let wi = 0; wi < word.answer.length; wi++) {
          if (word.answer[wi] !== anchor.answer[ai]) continue;
          const row = dir === "down" ? anchorRow - wi : anchorRow;
          const col = dir === "across" ? anchorCol - wi : anchorCol;

          const intersections = canPlace(word.answer, row, col, dir);
          if (intersections === null) continue;

          const candidate: Candidate = { row, col, dir, intersections };
          if (!best || betterThan(candidate, best, centre, word.answer.length)) {
            best = candidate;
          }
        }
      }
    }

    if (best) write(word, best.row, best.col, best.dir);
    else unplaced.push(word.answer);
  }

  return crop(grid, placed, unplaced, scratchSize);
}

/** More intersections wins; ties break toward the more central placement. */
function betterThan(a: Candidate, b: Candidate, centre: number, length: number): boolean {
  if (a.intersections !== b.intersections) return a.intersections > b.intersections;
  return distanceFromCentre(a, centre, length) < distanceFromCentre(b, centre, length);
}

function distanceFromCentre(c: Candidate, centre: number, length: number): number {
  const midRow = c.dir === "down" ? c.row + length / 2 : c.row;
  const midCol = c.dir === "across" ? c.col + length / 2 : c.col;
  return Math.abs(midRow - centre) + Math.abs(midCol - centre);
}

/** Crop the scratch grid to its bounding box and number the word starts. */
function crop(
  grid: (string | null)[][],
  placed: PlacedWord[],
  unplaced: string[],
  scratchSize: number,
): Puzzle {
  let minRow = scratchSize;
  let maxRow = -1;
  let minCol = scratchSize;
  let maxCol = -1;

  for (let r = 0; r < scratchSize; r++) {
    for (let c = 0; c < scratchSize; c++) {
      if (grid[r][c] === null) continue;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
    }
  }

  if (maxRow < 0) return { rows: 0, cols: 0, grid: [], words: [], unplaced };

  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;
  const cropped = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => grid[minRow + r][minCol + c]),
  );

  const shifted = placed.map((w) => ({ ...w, row: w.row - minRow, col: w.col - minCol }));

  // Number in reading order: a cell that starts an across word and a down word
  // shares one number, matching newspaper convention.
  const byStart = new Map<string, PlacedWord[]>();
  for (const w of shifted) {
    const key = cellKey(w.row, w.col);
    const list = byStart.get(key);
    if (list) list.push(w);
    else byStart.set(key, [w]);
  }

  let next = 1;
  const words: PlacedWord[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const starting = byStart.get(cellKey(r, c));
      if (!starting) continue;
      const number = next++;
      for (const w of starting) words.push({ ...w, number });
    }
  }

  return { rows, cols, grid: cropped, words, unplaced };
}

/** Every cell a word covers, in order. */
export function wordCells(word: PlacedWord): { row: number; col: number }[] {
  const dr = word.dir === "down" ? 1 : 0;
  const dc = word.dir === "across" ? 1 : 0;
  return Array.from({ length: word.answer.length }, (_, i) => ({
    row: word.row + dr * i,
    col: word.col + dc * i,
  }));
}
