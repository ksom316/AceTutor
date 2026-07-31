import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Flame,
  Gamepad2,
  Grid3x3,
  Lightbulb,
  Loader2,
  Puzzle,
  Sparkles,
  Timer,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { CrosswordBoard } from "@/components/games/CrosswordBoard";
import { WordSearchBoard } from "@/components/games/WordSearchBoard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { askCourse } from "@/lib/course-chat.functions";
import {
  buildCrossword,
  sanitizeClues,
  shuffle,
  type CrosswordClue,
  type Puzzle as CrosswordPuzzle,
} from "@/lib/crossword";
import { buildWordSearch, type WordSearch } from "@/lib/wordsearch";
import {
  formatDuration,
  loadStats,
  recordSolve,
  DEFAULT_STATS,
  GAME_LABELS,
  type GameKind,
} from "@/lib/game-stats";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/games")({
  component: GamesPage,
});

type Course = { id: string; slug: string; title: string; summary: string | null };
type TopicRow = { id: string; title: string; summary: string | null; course_id: string };

type Difficulty = "easy" | "medium" | "hard";

const DIFFICULTIES: {
  key: Difficulty;
  label: string;
  words: number;
  /** Crossword grid cap. */
  maxSize: number;
  /** Word-search grid edge. */
  searchSize: number;
  /** Word search: harder settings hide words diagonally and backwards. */
  diagonals: boolean;
  reverse: boolean;
}[] = [
  {
    key: "easy",
    label: "Easy",
    words: 8,
    maxSize: 11,
    searchSize: 10,
    diagonals: false,
    reverse: false,
  },
  {
    key: "medium",
    label: "Medium",
    words: 12,
    maxSize: 13,
    searchSize: 12,
    diagonals: true,
    reverse: false,
  },
  {
    key: "hard",
    label: "Hard",
    words: 16,
    maxSize: 15,
    searchSize: 14,
    diagonals: true,
    reverse: true,
  },
];

const GAMES: { key: GameKind; label: string; blurb: string; icon: typeof Puzzle }[] = [
  {
    key: "crossword",
    label: GAME_LABELS.crossword,
    blurb: "Solve clues to fill an interlocking grid of course terms.",
    icon: Puzzle,
  },
  {
    key: "wordsearch",
    label: GAME_LABELS.wordsearch,
    blurb: "Hunt course keywords hidden in a letter grid.",
    icon: Grid3x3,
  },
];

const ALL_COURSES = "__all__";
const ALL_COURSES_LABEL = "All my courses";

/**
 * Fallback vocabulary when the AI tutor is unavailable: single-word terms
 * pulled from the course's own module titles, clued by their summaries.
 */
function cluesFromTopics(
  topics: TopicRow[],
  courseTitleById: Map<string, string>,
): CrosswordClue[] {
  const raw = topics.flatMap((topic, index) => {
    const course = courseTitleById.get(topic.course_id) ?? "this course";
    // Module titles are usually phrases — each long-enough word in them is a
    // usable answer, clued by the module it comes from.
    return topic.title
      .split(/[^A-Za-z]+/)
      .filter((w) => w.length >= 4 && w.length <= 12)
      .map((word) => ({
        answer: word,
        clue: topic.summary?.trim()
          ? `${topic.summary.trim().slice(0, 120)} — key term from "${topic.title}"`
          : `Key term from the module "${topic.title}"`,
        hint: `Module ${index + 1} of ${course}. ${word.length} letters, starts with "${word[0].toUpperCase()}".`,
        source: course,
      }));
  });
  return sanitizeClues(raw, 20);
}

function GamesPage() {
  const { user } = useAuth();
  const ask = useServerFn(askCourse);

  const [game, setGame] = useState<GameKind>("crossword");
  const [courseId, setCourseId] = useState<string>(ALL_COURSES);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [puzzle, setPuzzle] = useState<CrosswordPuzzle | null>(null);
  const [wordSearch, setWordSearch] = useState<WordSearch | null>(null);
  /** The game the on-screen puzzle belongs to (state can change behind it). */
  const [activeGame, setActiveGame] = useState<GameKind>("crossword");
  const [puzzleLabel, setPuzzleLabel] = useState(ALL_COURSES_LABEL);
  const [mixed, setMixed] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState(DEFAULT_STATS);

  useEffect(() => {
    if (user) setStats(loadStats(user.id));
  }, [user]);

  // Shared key with the dashboard / my-courses so this is usually cached.
  const { data: enrollments } = useQuery({
    queryKey: ["dash-enrollments", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollments")
        .select("course_id, created_at, courses(id, slug, title, summary)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const enrolledCourses = useMemo(
    () =>
      ((enrollments ?? []) as unknown as { courses: Course | null }[])
        .map((e) => e.courses)
        .filter(Boolean) as Course[],
    [enrollments],
  );

  // Lecturers (and students yet to enroll) have no enrollments — fall back to
  // the full catalog so the game still works for them.
  const { data: allCourses } = useQuery({
    queryKey: ["all-courses"],
    enabled: !!enrollments && enrolledCourses.length === 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, slug, title, summary, order_index")
        .order("order_index");
      return (data ?? []) as unknown as Course[];
    },
  });

  const courses = useMemo(
    () => (enrolledCourses.length > 0 ? enrolledCourses : (allCourses ?? [])),
    [enrolledCourses, allCourses],
  );

  const generate = useCallback(async () => {
    if (courses.length === 0) return;
    const config = DIFFICULTIES.find((d) => d.key === difficulty)!;
    const isMix = courseId === ALL_COURSES;
    // A mix asks each course for its own words (so every clue can name where
    // it came from); the course cap keeps one puzzle to a handful of AI calls.
    const selected = isMix
      ? shuffle(courses).slice(0, 4)
      : courses.filter((c) => c.id === courseId);
    if (selected.length === 0) return;

    const label = isMix ? ALL_COURSES_LABEL : selected[0].title;
    setGenerating(true);
    setError(null);
    setPuzzle(null);
    setWordSearch(null);

    try {
      const courseTitleById = new Map(selected.map((c) => [c.id, c.title]));
      const { data: topicRows } = await supabase
        .from("topics")
        .select("id, title, summary, course_id")
        .in(
          "course_id",
          selected.map((c) => c.id),
        )
        .order("order_index");
      const topics = (topicRows ?? []) as unknown as TopicRow[];

      const perCourse = Math.max(4, Math.ceil(config.words / selected.length));
      let usedFallback = false;

      const batches = await Promise.all(
        selected.map(async (course): Promise<CrosswordClue[]> => {
          const courseTopics = topics.filter((t) => t.course_id === course.id);
          try {
            const res = await ask({
              data: {
                courseTitle: course.title,
                courseSummary: course.summary ?? undefined,
                mode: "crossword_json",
                wordCount: perCourse,
                topicTitles: courseTopics.slice(0, 30).map((t) => t.title),
              },
            });
            if ("crossword" in res && Array.isArray(res.crossword) && res.crossword.length > 0) {
              return res.crossword.map((c) => ({ ...c, source: course.title }));
            }
          } catch {
            // AI unavailable / rate-limited for this course — fall through.
          }
          usedFallback = true;
          return cluesFromTopics(courseTopics, courseTitleById);
        }),
      );

      // sanitizeClues also dedupes, which matters once several courses share a term.
      const clues = sanitizeClues(batches.flat(), 20);

      if (usedFallback && clues.length >= 4) {
        toast.info("AI tutor unavailable — built a puzzle from your course modules.");
      }

      if (clues.length < 4) {
        setError(
          "There isn't enough course material to build a puzzle yet. Try another course, or come back once more modules are published.",
        );
        return;
      }

      const picked = shuffle(clues).slice(0, config.words);

      if (game === "wordsearch") {
        const search = buildWordSearch(picked, {
          size: config.searchSize,
          diagonals: config.diagonals,
          reverse: config.reverse,
        });
        if (search.words.length < 3) {
          setError("Those words wouldn't fit the grid. Try generating another puzzle.");
          return;
        }
        setWordSearch(search);
      } else {
        const built = buildCrossword(picked, { maxSize: config.maxSize });
        if (built.words.length < 3) {
          setError("Those words wouldn't interlock into a grid. Try generating another puzzle.");
          return;
        }
        setPuzzle(built);
      }

      setActiveGame(game);
      setPuzzleLabel(label);
      setMixed(isMix && selected.length > 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build a puzzle.");
    } finally {
      setGenerating(false);
    }
  }, [ask, courseId, courses, difficulty, game]);

  const handleSolved = useCallback(
    ({ seconds, hints }: { seconds: number; hints: number }) => {
      if (!user) return;
      setStats(recordSolve(user.id, { game: activeGame, course: puzzleLabel, seconds, hints }));
      toast.success(`Solved in ${formatDuration(seconds)}!`);
    },
    [user, puzzleLabel, activeGame],
  );

  const clearPuzzle = useCallback(() => {
    setPuzzle(null);
    setWordSearch(null);
    setError(null);
  }, []);

  const bestTime = useMemo(() => {
    const times = Object.values(stats.best);
    return times.length > 0 ? Math.min(...times) : null;
  }, [stats.best]);

  const activeDifficulty = DIFFICULTIES.find((d) => d.key === difficulty)!;
  // The hero reflects the puzzle on screen, or the pending choice in setup.
  const heroGame = puzzle || wordSearch ? activeGame : game;
  const activeGameMeta = GAMES.find((g) => g.key === heroGame)!;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        {/* ----------------------------- MAIN ----------------------------- */}
        <div className="min-w-0 space-y-6">
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <h1 className="font-display text-3xl md:text-4xl">Games</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Revise your course vocabulary the fun way.
            </p>
          </motion.div>

          {/* Hero */}
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-6 text-primary-foreground shadow-lg md:p-7">
              <div
                aria-hidden
                className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-2xl"
              />
              <div
                aria-hidden
                className="absolute -bottom-16 -right-4 h-40 w-40 rounded-full bg-white/10 blur-2xl"
              />
              <p className="relative text-xs font-medium uppercase tracking-widest text-primary-foreground/80">
                Word games
              </p>
              <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
                <div className="min-w-0">
                  <h2 className="mt-2 font-display text-2xl leading-tight md:text-3xl">
                    {activeGameMeta.label} · course keywords
                  </h2>
                  <p className="mt-1 max-w-lg text-sm text-primary-foreground/80">
                    Every word comes from the courses you're learning, with a hint on hand whenever
                    you get stuck.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur">
                  <activeGameMeta.icon className="h-4 w-4" />
                  {puzzleLabel} · {activeDifficulty.label}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Setup / board */}
          {puzzle ? (
            <CrosswordBoard
              key={`${puzzleLabel}-${difficulty}-${puzzle.words.length}-${puzzle.rows}x${puzzle.cols}`}
              puzzle={puzzle}
              courseLabel={puzzleLabel}
              showSources={mixed}
              onSolved={handleSolved}
              onNewPuzzle={clearPuzzle}
            />
          ) : wordSearch ? (
            <WordSearchBoard
              key={`${puzzleLabel}-${difficulty}-${wordSearch.words.length}-${wordSearch.size}`}
              puzzle={wordSearch}
              courseLabel={puzzleLabel}
              showSources={mixed}
              onSolved={handleSolved}
              onNewPuzzle={clearPuzzle}
            />
          ) : (
            <motion.section
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-6"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Gamepad2 className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-display text-xl">New puzzle</h2>
                  <p className="text-sm text-muted-foreground">
                    Pick a game and what to revise, then start solving.
                  </p>
                </div>
              </div>

              {/* Game picker */}
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Game
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {GAMES.map((g) => {
                    const Icon = g.icon;
                    const selected = game === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setGame(g.key)}
                        aria-pressed={selected}
                        className={cn(
                          "flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40 hover:bg-secondary/50",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{g.label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {g.blurb}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Course picker */}
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Course
                </p>
                {courses.length === 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Enroll in a course to unlock word puzzles.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <CourseOption
                      title={ALL_COURSES_LABEL}
                      subtitle={`Mix terms from ${courses.length} course${courses.length === 1 ? "" : "s"}`}
                      selected={courseId === ALL_COURSES}
                      onSelect={() => setCourseId(ALL_COURSES)}
                    />
                    {courses.map((course) => (
                      <CourseOption
                        key={course.id}
                        title={course.title}
                        subtitle={course.summary ?? "Course vocabulary"}
                        selected={courseId === course.id}
                        onSelect={() => setCourseId(course.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Difficulty */}
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Difficulty
                </p>
                <div className="mt-3 inline-flex rounded-full border border-border bg-secondary/50 p-1">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setDifficulty(d.key)}
                      className={cn(
                        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                        difficulty === d.key
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {game === "wordsearch" ? (
                    <>
                      Up to {activeDifficulty.words} words on a {activeDifficulty.searchSize}×
                      {activeDifficulty.searchSize} grid
                      {activeDifficulty.reverse
                        ? ", hidden in any direction including backwards."
                        : activeDifficulty.diagonals
                          ? ", including diagonals."
                          : ", across and down only."}
                    </>
                  ) : (
                    <>
                      Up to {activeDifficulty.words} words on a {activeDifficulty.maxSize}-square
                      grid.
                    </>
                  )}
                </p>
              </div>

              {error && (
                <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button
                onClick={generate}
                disabled={generating || courses.length === 0}
                size="lg"
                className="mt-6 h-12 w-full rounded-full text-base font-semibold sm:w-auto sm:px-8"
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building your puzzle…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Generate puzzle
                  </>
                )}
              </Button>
            </motion.section>
          )}
        </div>

        {/* ----------------------------- RIGHT RAIL ----------------------------- */}
        <motion.aside
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-6 xl:sticky xl:top-24 xl:self-start"
        >
          <motion.div
            variants={staggerItem}
            className="rounded-3xl border border-border bg-card p-5 shadow-sm"
          >
            <h3 className="font-display text-base">Your game stats</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StatTile icon={Trophy} label="Puzzles solved" value={String(stats.solved)} />
              <StatTile
                icon={Timer}
                label="Best time"
                value={bestTime === null ? "—" : formatDuration(bestTime)}
              />
              <StatTile icon={Flame} label="Day streak" value={String(stats.streak)} />
              <StatTile icon={Lightbulb} label="Hints used" value={String(stats.hintsUsed)} />
            </div>
          </motion.div>

          {stats.history.length > 0 && (
            <motion.div
              variants={staggerItem}
              className="rounded-3xl border border-border bg-card p-5 shadow-sm"
            >
              <h3 className="font-display text-base">Recent solves</h3>
              <ul className="mt-3 space-y-2">
                {stats.history.slice(0, 5).map((h) => (
                  <li
                    key={h.at}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.course}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {GAME_LABELS[h.game ?? "crossword"]} · {h.hints} hint
                        {h.hints === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-primary">
                      {formatDuration(h.seconds)}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          <motion.div
            variants={staggerItem}
            className="rounded-3xl border border-border bg-card p-5 shadow-sm"
          >
            <h3 className="font-display text-base">How to play</h3>
            {heroGame === "wordsearch" ? (
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>Drag across a word in the grid, or tap its first and last letter.</li>
                <li>Words hide across, down, diagonally and backwards as difficulty rises.</li>
                <li>
                  Tap the <Lightbulb className="inline h-3.5 w-3.5 text-primary" /> beside a word to
                  see what it means — good revision while you hunt.
                </li>
                <li>Really stuck? The wand reveals where a word sits, and counts as a hint.</li>
              </ul>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>Click a cell to start typing; click it again to switch across/down.</li>
                <li>Arrow keys move around the grid, Backspace clears.</li>
                <li>
                  Stuck? Tap the <Lightbulb className="inline h-3.5 w-3.5 text-primary" /> beside
                  any clue for a hint on that word.
                </li>
                <li>Check, reveal a letter, or reveal a word from the toolbar.</li>
              </ul>
            )}
          </motion.div>
        </motion.aside>
      </div>
    </main>
  );
}

function CourseOption({
  title,
  subtitle,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "rounded-2xl border p-4 text-left transition-all",
        selected
          ? "border-primary bg-primary/10 shadow-sm"
          : "border-border bg-card hover:border-primary/40 hover:bg-secondary/50",
      )}
    >
      <span className="block truncate text-sm font-semibold">{title}</span>
      <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">{subtitle}</span>
    </button>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-2 font-display text-2xl leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
