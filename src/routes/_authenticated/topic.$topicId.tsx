import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { ArrowRight, FileText, Headphones, PlayCircle, Presentation, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StartQuizButton } from "@/components/course/StartQuizButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { fadeUp } from "@/lib/motion";

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

const VARK_TO_MODALITY: Record<string, Modality> = {
  visual: "video",
  aural: "audio",
  read_write: "text",
  kinesthetic: "text",
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

export const Route = createFileRoute("/_authenticated/topic/$topicId")({
  component: TopicPage,
});

function TopicPage() {
  const { topicId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  // The tab the student explicitly picked, if any. The active tab is derived
  // from this + VARK preference + what is actually available.
  const [picked, setPicked] = useState<Modality | null>(null);

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

  const { data: profile } = useQuery({
    queryKey: ["profile-modality", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("vark_primary")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  // Whether the lecturer has published a quiz for this module. Completing the
  // module requires finishing its quiz, so an unpublished quiz is surfaced here.
  const { data: hasQuiz } = useQuery({
    queryKey: ["topic-has-quiz", topicId],
    queryFn: async () => {
      const { data } = await supabase
        .from("questions")
        .select("id")
        .eq("topic_id", topicId)
        .limit(1);
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

  const activeModality = useMemo<Modality | undefined>(() => {
    if (availableModalities.length === 0) return undefined;
    if (picked && availableModalities.includes(picked)) return picked;
    const varkPref = profile?.vark_primary ? VARK_TO_MODALITY[profile.vark_primary] : undefined;
    if (varkPref && availableModalities.includes(varkPref)) return varkPref;
    return availableModalities[0];
  }, [availableModalities, picked, profile?.vark_primary]);

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

  const activeLessons = activeModality ? groups[activeModality] : [];

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
                {profile?.vark_primary && VARK_TO_MODALITY[profile.vark_primary] === k && (
                  <Sparkles
                    className={`ml-0.5 h-3 w-3 ${isActive ? "text-primary-foreground" : "text-accent"}`}
                  />
                )}
              </button>
            );
          })}
        </motion.div>
      )}

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
            activeLessons.map((lesson) => (
              <div key={lesson.id} className="rounded-2xl border border-border bg-card p-6 md:p-8">
                <h2 className="font-display text-2xl">{lesson.title}</h2>
                <div className="mt-5">
                  <LessonBody lesson={lesson} />
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <FileText className="h-6 w-6" />
              </span>
              <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
                No learning materials have been added to this topic yet. You can still take the quiz
                below.
              </p>
            </div>
          )}
        </motion.section>
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE, delay: 0.2 }}
        className="mt-8"
      >
        {hasQuiz === false ? (
          <div className="rounded-xl border border-dashed border-border bg-card/60 p-5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Module quiz coming soon.</span> Your
            lecturer hasn&apos;t published this module&apos;s quiz yet. You&apos;ll need to complete
            it to finish the module.
          </div>
        ) : user && !enrollment ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="font-medium text-foreground">Enroll to take the quiz</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You need to be enrolled in {data?.topic?.courses?.title || "this course"} to take this module's quiz.
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
        )}
      </motion.div>
    </main>
  );
}

/** Renders one lesson's body for its modality. Behaviour is unchanged from
 *  Phase 7 — direct/uploaded video uses <video>, provider links use <iframe>,
 *  audio uses <audio>, slides use the PDF iframe + open-in-new-tab link, text
 *  uses the Markdown renderer, and a non-text lesson's body_md is a caption. */
function LessonBody({ lesson }: { lesson: LessonRow }) {
  return (
    <>
      {lesson.modality === "text" && (
        <div className="prose-lesson max-w-none text-foreground">
          <ReactMarkdown>{lesson.body_md ?? ""}</ReactMarkdown>
        </div>
      )}
      {lesson.modality === "video" &&
        lesson.media_url &&
        (isDirectMediaUrl(lesson.media_url) ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-sm">
            <video src={lesson.media_url} title={lesson.title} controls className="h-full w-full" />
          </div>
        ) : (
          <div className="aspect-video w-full overflow-hidden rounded-xl shadow-sm">
            <iframe
              src={lesson.media_url}
              title={lesson.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ))}
      {lesson.modality === "audio" && lesson.media_url && (
        <audio controls src={lesson.media_url} className="w-full" />
      )}
      {lesson.modality === "slides" && lesson.media_url && (
        <div className="space-y-3">
          <div className="aspect-[4/3] w-full overflow-hidden rounded-xl border border-border shadow-sm">
            <iframe src={lesson.media_url} title={lesson.title} className="h-full w-full" />
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
      )}
      {lesson.modality !== "text" && lesson.body_md && (
        <p className="mt-4 text-sm text-muted-foreground">{lesson.body_md}</p>
      )}
    </>
  );
}
