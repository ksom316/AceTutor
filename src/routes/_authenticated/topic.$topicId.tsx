import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  FileText,
  Headphones,
  PlayCircle,
  Presentation,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StartQuizButton } from "@/components/course/StartQuizButton";
import { GuidedReader } from "@/components/course/GuidedReader";
import { MasteryBadge, MasteryTrend } from "@/components/course/MasteryBadge";
import {
  ExplainSelectionButton,
  type LessonSelection,
} from "@/components/course/ExplainSelectionButton";
import { ContextualExplanation } from "@/components/course/ContextualExplanation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { useMeaningfulEngagement } from "@/hooks/use-meaningful-engagement";
import {
  MEANINGFUL_ENGAGEMENT_MIN_SECONDS,
  resolveEngagementPlan,
} from "@/lib/meaningful-engagement";
import { resolveInitialModality } from "@/lib/initial-modality";
import { useVarkProfile } from "@/hooks/use-vark-profile";
import { computeModuleMastery } from "@/lib/mastery";
import type { PerfAttempt } from "@/lib/quiz-performance";
import { splitLessonIntoSections } from "@/lib/reading-sections";
import { isAllowedLessonMediaUrl } from "@/lib/lesson-shared";
import { fadeUp } from "@/lib/motion";
import { VARK_CATEGORY_LABEL } from "@/lib/vark";
import {
  resolveEffectiveVarkCategory,
  resolveVarkContentRecommendation,
} from "@/lib/vark-content-recommendation";
import { buildRecommendationContext, logInteraction } from "@/lib/learning-interactions";
import { getAdaptiveModalityRecommendation } from "@/lib/adaptive-modality.functions";
import type { AdaptiveModalityRecommendation } from "@/lib/adaptive-modality";

type Modality = "text" | "video" | "audio" | "slides";

/** Uploaded files / direct media links play in a <video>/<audio> tag; provider
 *  links (YouTube, Vimeo…) need an <iframe> embed. */
function isDirectMediaUrl(url: string): boolean {
  return (
    /\.(mp4|webm|ogv|ogg|mov|m4v|m4a|mp3|wav|aac)(\?|#|$)/i.test(url) ||
    url.includes("/storage/v1/object/")
  );
}

type LessonRow = {
  id: string;
  modality: Modality;
  title: string;
  body_md: string | null;
  media_url: string | null;
  duration_sec: number | null;
};
type TopicDetail = {
  id: string;
  title: string;
  summary: string | null;
  course_id: string;
  courses: { title: string; slug: string } | null;
};

// A student's preferred lesson format (learning_preferences.lesson_format) maps
// to a lesson modality. It only chooses the default tab — every available format
// stays selectable, and an unavailable preferred format falls back gracefully.
const FORMAT_TO_MODALITY: Record<string, Modality> = {
  written: "text",
  visual: "video",
  audio: "audio",
};

// Canonical tab order. A tab is rendered only when the topic actually has at
// least one lesson of that modality — nothing is assumed from the app.
const MODALITY_ORDER: Modality[] = ["text", "video", "audio", "slides"];
const MODALITY_TABS: Record<
  Modality,
  { Icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  text: { Icon: FileText, label: "Read" },
  video: { Icon: PlayCircle, label: "Watch" },
  audio: { Icon: Headphones, label: "Listen" },
  slides: { Icon: Presentation, label: "Slides" },
};

const EASE = [0.22, 1, 0.36, 1] as const;

// Dismissible "highlight to explain" learning tip — remembered per browser only.
const EXPLAIN_HINT_KEY = "acetutor:explain-hint-dismissed";

export const Route = createFileRoute("/_authenticated/topic/$topicId")({
  component: TopicPage,
});

function TopicPage() {
  const { topicId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  // The tab the student explicitly picked, if any. The active tab is derived
  // from this + the student's preferred lesson format + what is available.
  const [picked, setPicked] = useState<Modality | null>(null);

  // Contextual "Explain with AceTutor" — additive. `lessonAreaRef` scopes the
  // selection detection to the lesson content; `explainTarget` is the passage
  // being explained in the compact panel; `showHint` is the one-time tip.
  const lessonAreaRef = useRef<HTMLDivElement>(null);
  const [explainTarget, setExplainTarget] = useState<LessonSelection | null>(null);
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    try {
      setShowHint(localStorage.getItem(EXPLAIN_HINT_KEY) !== "1");
    } catch {
      /* storage unavailable — just don't show the tip */
    }
  }, []);
  const dismissHint = () => {
    setShowHint(false);
    try {
      localStorage.setItem(EXPLAIN_HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["topic", topicId],
    queryFn: async () => {
      const { data: topic } = await supabase
        .from("topics")
        .select("id, title, summary, course_id, courses(title, slug)")
        .eq("id", topicId)
        .maybeSingle();
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, modality, title, body_md, media_url, duration_sec")
        .eq("topic_id", topicId)
        .order("order_index");
      return {
        topic: (topic ?? null) as unknown as TopicDetail | null,
        lessons: (lessons ?? []) as unknown as LessonRow[],
      };
    },
  });

  // Check if user is enrolled in the course
  const { data: enrollment } = useQuery({
    queryKey: ["topic-enrollment", user?.id, data?.topic?.course_id],
    enabled: !!user && !!data?.topic?.course_id,
    queryFn: async () => {
      const { data: enroll } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", user!.id)
        .eq("course_id", data!.topic!.course_id)
        .maybeSingle();
      return enroll;
    },
  });

  // Study time on a module belongs to its course.
  useStudyCourse(data?.topic?.course_id);

  // This module's mastery — the score of the student's most recent completed
  // official module quiz (never averaged). RLS scopes quiz_attempts to the
  // caller, so this only ever reads the student's own attempts.
  const { data: topicAttempts = [] } = useQuery({
    queryKey: ["topic-mastery-attempts", user?.id, topicId],
    enabled: !!user && !!enrollment,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("quiz_attempts")
        .select("id, topic_id, score, total, finished_at, answered_count, started_at")
        .eq("user_id", user!.id)
        .eq("topic_id", topicId);
      return (rows ?? []) as PerfAttempt[];
    },
  });
  const moduleMastery = useMemo(
    () => computeModuleMastery({ id: topicId, title: data?.topic?.title ?? "" }, topicAttempts),
    [topicId, data?.topic?.title, topicAttempts],
  );

  const { data: learningPrefs } = useQuery({
    queryKey: ["topic-learning-prefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_preferences")
        .select("lesson_format")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });
  const preferredModality = learningPrefs?.lesson_format
    ? FORMAT_TO_MODALITY[learningPrefs.lesson_format]
    : undefined;

  // Whether the lecturer has published a quiz for this module. Completing the
  // module requires finishing its quiz, so an unpublished quiz is surfaced here.
  const { data: hasQuiz } = useQuery({
    queryKey: ["topic-has-quiz", topicId],
    queryFn: async () => {
      // Students can't read `questions` directly (SEC-01) — this RPC echoes
      // back only the topic ids that have a quiz.
      const { data } = await supabase.rpc("topics_with_questions", { _topic_ids: [topicId] });
      return (data ?? []).length > 0;
    },
  });

  // Group the topic's lessons by modality, preserving the query's order_index
  // order. Every lesson is kept — multiple lessons per modality are expected.
  const groups = useMemo(() => {
    const all = data?.lessons ?? [];
    return {
      text: all.filter((l) => l.modality === "text"),
      video: all.filter((l) => l.modality === "video"),
      audio: all.filter((l) => l.modality === "audio"),
      slides: all.filter((l) => l.modality === "slides"),
    } satisfies Record<Modality, LessonRow[]>;
  }, [data?.lessons]);

  const availableModalities = useMemo(
    () => MODALITY_ORDER.filter((m) => groups[m].length > 0),
    [groups],
  );

  // Phase A4 — VARK-aware content recommendation. Presentation-only: reads
  // the already-persisted VARK profile (never re-runs ML inference here),
  // and only ever adds a badge/caption below — it never changes
  // activeModality/preferredModality (Learning Preferences' own, separate
  // default-tab mechanism, untouched) and never reorders or hides lessons.
  const { profile: varkProfile } = useVarkProfile();
  const effectiveVarkCategory = useMemo(() => resolveEffectiveVarkCategory(varkProfile), [varkProfile]);
  const varkRecommendation = useMemo(
    () => resolveVarkContentRecommendation(effectiveVarkCategory, availableModalities),
    [effectiveVarkCategory, availableModalities],
  );

  // Phase A7 — server-computed adaptive modality recommendation. Reads only
  // this student's own learning_interactions history server-side and returns
  // just the final recommendation. Best-effort: while it loads or if it
  // fails, `displayedRecommendation` falls back to the A4 VARK recommendation
  // above, so the topic page and its content are never affected.
  const runAdaptive = useServerFn(getAdaptiveModalityRecommendation);
  const adaptiveQuery = useQuery({
    queryKey: ["adaptive-modality", user?.id, topicId],
    enabled: !!user && !!topicId && availableModalities.length > 0,
    staleTime: 60_000,
    queryFn: () => runAdaptive({ data: { topicId } }),
  });
  // The recommendation ACTUALLY shown to the student: the adaptive result
  // once it has resolved, otherwise the A4 VARK recommendation. Memoized so
  // it's a stable reference for the logging effects below.
  const displayedRecommendation = useMemo<Pick<
    AdaptiveModalityRecommendation,
    "modality" | "category" | "source"
  > | null>(() => {
    if (adaptiveQuery.data) return adaptiveQuery.data;
    if (varkRecommendation) {
      return {
        modality: varkRecommendation.modality,
        category: varkRecommendation.category,
        source: "vark" as const,
      };
    }
    return null;
  }, [adaptiveQuery.data, varkRecommendation]);

  // Phase A7 final UX — the effective recommendation drives the INITIAL tab:
  // a genuine adaptive override → A4 VARK recommendation → Learning-Preferences
  // default → first available. The learner is never re-classified; only the
  // current recommended modality moves (see src/lib/initial-modality.ts).
  // Both candidates come from `displayedRecommendation` (the same value shown
  // in the UI): source "adaptive" is the override, source "vark" is the A4
  // recommendation (server-resolved, else the client A4 fallback).
  const overrideModality =
    displayedRecommendation?.source === "adaptive" ? displayedRecommendation.modality : null;
  const varkRecModality =
    displayedRecommendation?.source === "vark" ? displayedRecommendation.modality : null;

  // Freeze the auto-selected initial tab the first render A7 has settled (or
  // isn't going to run). After that only a manual `picked` can move the tab —
  // a late adaptive result, refetch, or re-render never yanks it. Revisiting
  // within the query's staleTime freezes immediately from cache (no flicker);
  // only a genuine override on a cold load can briefly show the VARK tab
  // first, because the override isn't known until the request returns.
  const adaptiveWillRun = !!user && !!topicId;
  const canFreezeInitial =
    availableModalities.length > 0 &&
    (!adaptiveWillRun || adaptiveQuery.isFetched || adaptiveQuery.isError);

  const frozenInitialRef = useRef<Modality | null>(null);
  if (frozenInitialRef.current === null && canFreezeInitial) {
    frozenInitialRef.current =
      resolveInitialModality({
        manualPick: null,
        adaptiveOverrideModality: overrideModality,
        varkModality: varkRecModality,
        preferredModality: preferredModality ?? null,
        availableModalities,
      }) ?? null;
  }
  const frozenInitial = frozenInitialRef.current;

  const activeModality = useMemo<Modality | undefined>(() => {
    if (availableModalities.length === 0) return undefined;
    if (picked && availableModalities.includes(picked)) return picked;
    if (frozenInitial && availableModalities.includes(frozenInitial)) return frozenInitial;
    // Pre-freeze only (A7 still first-loading): `displayedRecommendation` is
    // the client A4 VARK value here, so this already matches the frozen result
    // except on a genuine first-load override.
    return resolveInitialModality({
      manualPick: null,
      adaptiveOverrideModality: overrideModality,
      varkModality: varkRecModality,
      preferredModality: preferredModality ?? null,
      availableModalities,
    });
  }, [availableModalities, picked, frozenInitial, overrideModality, varkRecModality, preferredModality]);

  const activeLessons = activeModality ? groups[activeModality] : [];

  // Phase A6 — best-effort behavioral logging. Never affects
  // activeModality/lesson order/rendering: these effects only ever call the
  // fire-and-forget logInteraction() helper, which never throws. Ref-guarded
  // so switching back to an already-logged modality, or a lesson already
  // seen this page visit, never creates a duplicate row.
  //
  // Phase A7: logging is held until the adaptive query has SETTLED
  // (`isFetched` is true after success OR error). This guarantees the
  // recorded `recommended_modality` / `recommendation_source` is the
  // recommendation the student is actually seeing — never a premature VARK
  // value that the adaptive result would supersede a moment later.
  const recommendedModality = displayedRecommendation?.modality ?? null;
  const recommendationSource = displayedRecommendation?.modality
    ? displayedRecommendation.source
    : null;

  // `modality_selected` means the student ACTUALLY picked a format tab — it is
  // keyed off `picked`, never the system-selected initial `activeModality`, so
  // an auto-displayed recommendation never fabricates a selection event.
  const loggedPicksRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user || !picked || !topicId || !adaptiveQuery.isFetched) return;
    if (!availableModalities.includes(picked)) return;
    const key = `${topicId}:${picked}`;
    if (loggedPicksRef.current.has(key)) return;
    loggedPicksRef.current.add(key);
    logInteraction(user.id, {
      event_type: "modality_selected",
      course_id: data?.topic?.course_id ?? null,
      topic_id: topicId,
      modality: picked,
      recommendationContext: buildRecommendationContext({
        recommendedModality,
        recommendationSource,
        effectiveCategory: effectiveVarkCategory,
        actualModality: picked,
      }),
    });
  }, [
    user,
    topicId,
    picked,
    availableModalities,
    data?.topic?.course_id,
    recommendedModality,
    recommendationSource,
    effectiveVarkCategory,
    adaptiveQuery.isFetched,
  ]);

  const loggedLessonIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user || !topicId || !adaptiveQuery.isFetched) return;
    for (const lesson of activeLessons) {
      if (loggedLessonIdsRef.current.has(lesson.id)) continue;
      loggedLessonIdsRef.current.add(lesson.id);
      logInteraction(user.id, {
        event_type: "lesson_opened",
        course_id: data?.topic?.course_id ?? null,
        topic_id: topicId,
        lesson_id: lesson.id,
        modality: lesson.modality,
        recommendationContext: buildRecommendationContext({
          recommendedModality,
          recommendationSource,
          effectiveCategory: effectiveVarkCategory,
          actualModality: lesson.modality,
        }),
      });
    }
    // activeLessons is a derived array (new reference each render) — depend on
    // its lesson ids specifically so this doesn't re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user,
    topicId,
    activeLessons.map((l) => l.id).join(","),
    data?.topic?.course_id,
    recommendedModality,
    recommendationSource,
    effectiveVarkCategory,
    adaptiveQuery.isFetched,
  ]);

  // Phase A7 evidence-quality — a modality qualifies as real study evidence
  // only after a CONTENT-LENGTH-AWARE slice of engagement (see
  // src/lib/meaningful-engagement.ts): ~30% of the estimated reading /
  // playback time, clamped to 90–300s. For native (direct/uploaded) video &
  // audio this counts verified playback time; for text, slides, and
  // provider/iframe media it counts foreground-visible exposure. This is the
  // ONLY signal A7's adaptive recommendation treats as modality evidence;
  // modality_selected / lesson_opened above stay as plain A6 analytics.
  const engagementPlan = useMemo(() => {
    if (!activeModality) {
      return { threshold: MEANINGFUL_ENGAGEMENT_MIN_SECONDS, signal: "exposure" as const };
    }
    const lessons = groups[activeModality];
    const totalTextLength = lessons.reduce((n, l) => n + (l.body_md?.length ?? 0), 0);
    const durations = lessons.map((l) => l.duration_sec ?? 0);
    const totalDurationSec = durations.some((d) => d > 0)
      ? durations.reduce((a, b) => a + b, 0)
      : null;
    const mediaLessons = lessons.filter((l) => l.media_url);
    const playbackVerifiable =
      (activeModality === "video" || activeModality === "audio") &&
      mediaLessons.length > 0 &&
      mediaLessons.length === lessons.length &&
      mediaLessons.every((l) => isDirectMediaUrl(l.media_url!));
    return resolveEngagementPlan({
      modality: activeModality,
      totalTextLength,
      totalDurationSec,
      playbackVerifiable,
    });
  }, [activeModality, groups]);

  // Verified play time (seconds) per native <video>/<audio> lesson, reported
  // by <TrackedMedia>. Summed across the active modality's lessons for the
  // "playback" engagement signal. Ref only — never triggers a re-render.
  const playbackByLessonRef = useRef<Map<string, number>>(new Map());

  useMeaningfulEngagement({
    enabled: !!user && availableModalities.length > 0 && adaptiveQuery.isFetched,
    topicId,
    activeModality,
    threshold: engagementPlan.threshold,
    signal: engagementPlan.signal,
    getPlaybackSeconds: () => {
      if (!activeModality) return 0;
      let total = 0;
      for (const l of groups[activeModality]) {
        total += playbackByLessonRef.current.get(l.id) ?? 0;
      }
      return total;
    },
    onQualify: (modality) => {
      if (!user) return;
      logInteraction(user.id, {
        event_type: "meaningful_engagement",
        course_id: data?.topic?.course_id ?? null,
        topic_id: topicId,
        modality,
        recommendationContext: buildRecommendationContext({
          recommendedModality,
          recommendationSource,
          effectiveCategory: effectiveVarkCategory,
          actualModality: modality,
        }),
      });
    },
  });

  if (isLoading) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-10 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mt-8 h-10 w-56 animate-pulse rounded-full bg-muted" />
        <div className="mt-8 h-64 w-full animate-pulse rounded-2xl bg-muted" />
      </main>
    );
  }

  if (!data?.topic) {
    return (
      <main className="container mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center px-4 py-12">
        <div className="max-w-md rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <h1 className="font-display text-2xl">Topic not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This lesson is unavailable or may have been moved.
          </p>
          <Button onClick={() => navigate({ to: "/dashboard" })} className="mt-6 rounded-full">
            Back to dashboard
          </Button>
        </div>
      </main>
    );
  }

  const courseRelation = data.topic.courses as
    | { title?: string; slug?: string }
    | { title?: string; slug?: string }[]
    | null;
  const course = Array.isArray(courseRelation) ? courseRelation[0] : courseRelation;

  // The module quiz CTA. Its placement depends on modality: for a text lesson it
  // is shown at the END of the reading (the last Guided Reader page, or below a
  // short single-page lesson); for video / audio / slides / no-materials it
  // stays in its own block below the content.
  const quizCta =
    hasQuiz === false ? (
      <div className="rounded-xl border border-dashed border-border bg-card/60 p-5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Module quiz coming soon.</span> Your lecturer
        hasn&apos;t published this module&apos;s quiz yet. You&apos;ll need to complete it to finish
        the module.
      </div>
    ) : user && !enrollment ? (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
        <p className="font-medium text-foreground">Enroll to take the quiz</p>
        <p className="mt-1 text-sm text-muted-foreground">
          You need to be enrolled in {data?.topic?.courses?.title || "this course"} to take this
          module&apos;s quiz.
        </p>
        <Button
          onClick={() =>
            navigate({
              to: "/courses/$slug",
              params: { slug: data?.topic?.courses?.slug || "" },
            })
          }
          className="mt-3 rounded-full"
        >
          Go to course to enroll
        </Button>
      </div>
    ) : (
      <StartQuizButton
        topicId={topicId}
        size="lg"
        className="rounded-full transition-transform hover:scale-[1.02] active:scale-95"
      >
        Start quiz <ArrowRight className="ml-1.5 h-4 w-4" />
      </StartQuizButton>
    );

  const textLessonReading = activeModality === "text";

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <motion.div variants={fadeUp} initial="hidden" animate="show">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {course?.slug ? (
            <Link
              to="/courses/$slug"
              params={{ slug: course.slug }}
              className="transition-colors hover:text-foreground hover:underline"
            >
              {course.title ?? "Course"}
            </Link>
          ) : (
            (course?.title ?? "Course")
          )}
        </p>
        <h1 className="mt-2 font-display text-5xl">{data.topic.title}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{data.topic.summary}</p>
        {enrollment && moduleMastery.completedAttempts > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Your mastery</span>
            <MasteryBadge level={moduleMastery.level} score={moduleMastery.score} />
            <MasteryTrend mastery={moduleMastery} />
          </div>
        )}
      </motion.div>

      {availableModalities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE, delay: 0.1 }}
          className="mt-8 inline-flex flex-wrap rounded-full border border-border bg-muted p-1 text-sm shadow-sm"
        >
          {availableModalities.map((k) => {
            const { Icon, label } = MODALITY_TABS[k];
            const isActive = activeModality === k;
            return (
              <button
                key={k}
                onClick={() => setPicked(k)}
                aria-pressed={isActive}
                className={`relative isolate inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-colors duration-300 ${
                  isActive
                    ? "text-primary-foreground"
                    : "text-foreground/80 hover:bg-background/70 hover:text-foreground"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="modality-pill"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    className="absolute inset-0 -z-10 rounded-full bg-primary shadow-sm"
                  />
                )}
                <Icon className="h-4 w-4" /> {label}
                {preferredModality === k && (
                  <Sparkles
                    className={`ml-0.5 h-3 w-3 ${isActive ? "text-primary-foreground" : "text-accent"}`}
                  />
                )}
                {displayedRecommendation?.modality === k && (
                  <Badge
                    variant="secondary"
                    className="ml-0.5 h-4 gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium"
                  >
                    Recommended for you
                  </Badge>
                )}
              </button>
            );
          })}
        </motion.div>
      )}

      {displayedRecommendation?.modality &&
        (displayedRecommendation.source === "adaptive" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Adjusted based on your recent learning activity and quiz outcomes — every format above
            is still available.
          </p>
        ) : displayedRecommendation.category ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Recommended based on your {VARK_CATEGORY_LABEL[displayedRecommendation.category]} learning
            profile — every format above is still available.
          </p>
        ) : null)}

      {/* Learning tip — highlight a passage to ask AceTutor. Shown once per
          browser, dismissible, never blocking. */}
      {showHint && user && activeLessons.length > 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="flex-1 text-muted-foreground">
            <span className="font-medium text-foreground">Learning tip:</span> highlight any
            confusing sentence or code snippet in a lesson and ask AceTutor to explain it.
          </p>
          <button
            type="button"
            onClick={dismissHint}
            aria-label="Dismiss tip"
            className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div ref={lessonAreaRef}>
        <AnimatePresence mode="wait">
          <motion.section
            key={activeModality ?? "empty"}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="mt-8 space-y-6"
          >
            {activeModality ? (
              activeLessons.map((lesson, idx) => (
                <div
                  key={lesson.id}
                  data-lesson-title={lesson.title}
                  className="rounded-2xl border border-border bg-card p-6 md:p-8"
                >
                  <h2 className="font-display text-2xl">{lesson.title}</h2>
                  <div className="mt-5">
                    <LessonBody
                      lesson={lesson}
                      quizCta={
                        textLessonReading && idx === activeLessons.length - 1 ? quizCta : undefined
                      }
                      onPlayback={(playedSeconds) =>
                        playbackByLessonRef.current.set(lesson.id, playedSeconds)
                      }
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <FileText className="h-6 w-6" />
                </span>
                <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
                  No learning materials have been added to this topic yet. You can still take the
                  quiz below.
                </p>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      {/* Selection detection is a pure client-side affordance — available to any
          signed-in reader. Enrollment is enforced server-side by `askCourse`
          (and surfaced as the panel's generic error) when the request runs. */}
      <ExplainSelectionButton
        containerRef={lessonAreaRef}
        enabled={!!user && activeLessons.length > 0}
        onExplain={setExplainTarget}
      />

      {explainTarget && (
        <ContextualExplanation
          key={`${explainTarget.lessonTitle ?? ""}:${explainTarget.text}`}
          selectedText={explainTarget.text}
          lessonTitle={explainTarget.lessonTitle}
          context={{
            courseId: data.topic.course_id,
            courseTitle: course?.title || data.topic.title,
            moduleTitle: data.topic.title,
            moduleTopicId: topicId,
            moduleSummary: data.topic.summary ?? undefined,
          }}
          onClose={() => setExplainTarget(null)}
        />
      )}

      {/* For a text lesson the quiz CTA lives at the end of the reading (handled
          by TextLessonBody); every other modality keeps it in its own block. */}
      {!textLessonReading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE, delay: 0.2 }}
          className="mt-8"
        >
          {quizCta}
        </motion.div>
      )}
    </main>
  );
}

/**
 * A native `<video>`/`<audio>` element that reports cumulative VERIFIED
 * playback seconds (normal forward progression only — seeks, skips and
 * rewinds are excluded). Used only for direct/uploaded media; provider embeds
 * render as an `<iframe>` whose playback can't be read without a provider SDK.
 */
function TrackedMedia({
  kind,
  src,
  title,
  className,
  onPlayedSeconds,
}: {
  kind: "video" | "audio";
  src: string;
  title?: string;
  className?: string;
  onPlayedSeconds?: (seconds: number) => void;
}) {
  const playedRef = useRef(0);
  const lastTimeRef = useRef(0);
  const onPlayedRef = useRef(onPlayedSeconds);
  onPlayedRef.current = onPlayedSeconds;

  const handleTimeUpdate = (e: SyntheticEvent<HTMLMediaElement>) => {
    const el = e.currentTarget;
    const delta = el.currentTime - lastTimeRef.current;
    lastTimeRef.current = el.currentTime;
    if (!el.paused && delta > 0 && delta < 1.5) {
      playedRef.current += delta;
      onPlayedRef.current?.(playedRef.current);
    }
  };
  const syncCursor = (e: SyntheticEvent<HTMLMediaElement>) => {
    lastTimeRef.current = e.currentTarget.currentTime;
  };

  return kind === "video" ? (
    <video
      src={src}
      title={title}
      controls
      className={className}
      onTimeUpdate={handleTimeUpdate}
      onSeeking={syncCursor}
    />
  ) : (
    <audio
      src={src}
      controls
      className={className}
      onTimeUpdate={handleTimeUpdate}
      onSeeking={syncCursor}
    />
  );
}

/** Shown when a stored `media_url` predates the media allowlist (migration
 *  20260917120000) and is not a shape we will embed. Historical data is left
 *  untouched — the lecturer is asked to re-add the lesson media. */
function UnsupportedMediaNotice({ url }: { url: string }) {
  const safeHref = /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
      <p>This lesson&rsquo;s media can&rsquo;t be shown here.</p>
      {safeHref && (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
        >
          Open the original link <ArrowRight className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

/** Renders one lesson's body for its modality. Rendering is unchanged from
 *  Phase 7 — direct/uploaded video & audio use native elements (now wrapped by
 *  <TrackedMedia> to report verified playback time), provider links use a
 *  sandboxed <iframe>, slides use the PDF iframe + open-in-new-tab link, text
 *  uses the Markdown renderer, and a non-text lesson's body_md is a caption. */
function LessonBody({
  lesson,
  quizCta,
  onPlayback,
}: {
  lesson: LessonRow;
  quizCta?: ReactNode;
  onPlayback?: (playedSeconds: number) => void;
}) {
  return (
    <>
      {lesson.modality === "text" && (
        <TextLessonBody markdown={lesson.body_md ?? ""} title={lesson.title} quizCta={quizCta} />
      )}
      {lesson.modality === "video" &&
        lesson.media_url &&
        (isDirectMediaUrl(lesson.media_url) ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-sm">
            <TrackedMedia
              kind="video"
              src={lesson.media_url}
              title={lesson.title}
              className="h-full w-full"
              onPlayedSeconds={onPlayback}
            />
          </div>
        ) : isAllowedLessonMediaUrl(lesson.media_url) ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl shadow-sm">
            <iframe
              src={lesson.media_url}
              title={lesson.title}
              className="h-full w-full"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        ) : (
          <UnsupportedMediaNotice url={lesson.media_url} />
        ))}
      {lesson.modality === "audio" && lesson.media_url && (
        <TrackedMedia
          kind="audio"
          src={lesson.media_url}
          className="w-full"
          onPlayedSeconds={onPlayback}
        />
      )}
      {lesson.modality === "slides" &&
        lesson.media_url &&
        (isAllowedLessonMediaUrl(lesson.media_url) ? (
          <div className="space-y-3">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-xl border border-border shadow-sm">
              <iframe
                src={lesson.media_url}
                title={lesson.title}
                className="h-full w-full"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            </div>
            <a
              href={lesson.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Open slides in a new tab <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : (
          <UnsupportedMediaNotice url={lesson.media_url} />
        ))}
      {lesson.modality !== "text" && lesson.body_md && (
        <p className="mt-4 text-sm text-muted-foreground">{lesson.body_md}</p>
      )}
    </>
  );
}

/**
 * A text lesson's body. Substantial lessons are shown page-by-page with the
 * shared `GuidedReader` (the same primitive Personalized Learning uses) —
 * `splitLessonIntoSections` decides how, preferring Markdown headings and
 * falling back to evenly sized pages, and returns `null` for short content so it
 * renders as a single markdown page exactly as before. This never changes lesson
 * completion — there is no per-lesson completion action on this page.
 *
 * `quizCta` (the module quiz CTA) is shown only at the very end of the reading:
 * on the last Guided Reader page for a paginated lesson, or below the markdown
 * for a short single-page lesson.
 */
function TextLessonBody({
  markdown,
  title,
  quizCta,
}: {
  markdown: string;
  title: string;
  quizCta?: ReactNode;
}) {
  const sections = useMemo(() => splitLessonIntoSections(markdown), [markdown]);

  const endCta = quizCta ? <div className="mt-8 border-t border-border pt-6">{quizCta}</div> : null;

  if (!sections) {
    return (
      <>
        <div className="prose-lesson max-w-none text-foreground">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>
        {endCta}
      </>
    );
  }

  const lastIndex = sections.length - 1;
  const finalCta = quizCta ? undefined : (
    <p className="text-sm text-muted-foreground">End of lesson.</p>
  );

  return (
    <GuidedReader
      resetKey={`${title}:${markdown.length}`}
      ariaLabel={`${title} — guided reading`}
      stepWord="Page"
      className="border-0 bg-transparent p-0"
      finalCta={finalCta}
      sections={sections.map((s, i) => ({
        key: `page-${i}`,
        heading: s.heading ?? undefined,
        body: (
          <>
            <div className="prose-lesson max-w-none text-foreground">
              <ReactMarkdown>{s.body}</ReactMarkdown>
            </div>
            {i === lastIndex && endCta}
          </>
        ),
      }))}
    />
  );
}
