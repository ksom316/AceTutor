/**
 * Per-user game stats, stored locally (no schema change required) — the same
 * approach the notification preferences use in
 * src/routes/_authenticated/notifications.tsx.
 */

export type GameKind = "crossword" | "wordsearch";

export const GAME_LABELS: Record<GameKind, string> = {
  crossword: "Crossword",
  wordsearch: "Word search",
};

export type GameResult = {
  /** Which game was played. Absent on results saved before word search existed. */
  game?: GameKind;
  /** Course title, or "All my courses" for a mixed puzzle. */
  course: string;
  seconds: number;
  hints: number;
  /** ISO timestamp of the solve. */
  at: string;
};

/** Best times are tracked per game *and* course, and the key doubles as its label. */
export const bestKey = (game: GameKind, course: string) => `${course} · ${GAME_LABELS[game]}`;

export type GameStats = {
  solved: number;
  hintsUsed: number;
  /** Consecutive calendar days with at least one solve. */
  streak: number;
  /** ISO date (YYYY-MM-DD) of the most recent solve. */
  lastPlayed: string | null;
  /** Best time in seconds, keyed by `bestKey(game, course)`. */
  best: Record<string, number>;
  /** Most recent solves, newest first. */
  history: GameResult[];
};

export const DEFAULT_STATS: GameStats = {
  solved: 0,
  hintsUsed: 0,
  streak: 0,
  lastPlayed: null,
  best: {},
  history: [],
};

const HISTORY_LIMIT = 10;

const storageKey = (userId: string) => `acetutor:game-stats:${userId}`;

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export function loadStats(userId: string): GameStats {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_STATS;
    const parsed = JSON.parse(raw) as Partial<GameStats>;
    return {
      ...DEFAULT_STATS,
      ...parsed,
      best: parsed.best ?? {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return DEFAULT_STATS;
  }
}

/** Record a solved puzzle and return the updated stats. */
export function recordSolve(
  userId: string,
  result: { game: GameKind; course: string; seconds: number; hints: number },
): GameStats {
  const prev = loadStats(userId);
  const now = new Date();
  const today = dayOf(now);

  // A solve on the same day keeps the streak; the next calendar day extends
  // it; any longer gap starts over.
  let streak = prev.streak;
  if (prev.lastPlayed === today) {
    streak = Math.max(prev.streak, 1);
  } else {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    streak = prev.lastPlayed === dayOf(yesterday) ? prev.streak + 1 : 1;
  }

  const key = bestKey(result.game, result.course);
  const previousBest = prev.best[key];
  const entry: GameResult = { ...result, at: now.toISOString() };

  const next: GameStats = {
    solved: prev.solved + 1,
    hintsUsed: prev.hintsUsed + result.hints,
    streak,
    lastPlayed: today,
    best: {
      ...prev.best,
      [key]: previousBest === undefined ? result.seconds : Math.min(previousBest, result.seconds),
    },
    history: [entry, ...prev.history].slice(0, HISTORY_LIMIT),
  };

  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore storage failures — stats are a nicety, not the game */
  }
  return next;
}

/** `93` -> `1:33`. */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
