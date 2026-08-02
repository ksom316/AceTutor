import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { ArrowRight, FileText, Headphones, PlayCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StartQuizButton } from "@/components/course/StartQuizButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useStudyCourse } from "@/hooks/use-study-time";
import { fadeUp } from "@/lib/motion";

type Modality = "text" | "video" | "audio";

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

const EASE = [0.22, 1, 0.36, 1] as const;

export const Route = createFileRoute("/_authenticated/topic/$topicId")({
  component: TopicPage,
});

function TopicPage() {
  const { topicId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [modality, setModality] = useState<Modality>("text");

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

  useEffect(() => {
    if (profile?.vark_primary) setModality(VARK_TO_MODALITY[profile.vark_primary] ?? "text");
  }, [profile?.vark_primary]);

  const lesson = useMemo(
    () => data?.lessons.find((l) => l.modality === modality),
    [data, modality],
  );

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

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE, delay: 0.1 }}
        className="mt-8 inline-flex rounded-full border border-border bg-muted p-1 text-sm shadow-sm"
      >
        {(
          [
            { k: "text", Icon: FileText, label: "Read" },
            { k: "video", Icon: PlayCircle, label: "Watch" },
            { k: "audio", Icon: Headphones, label: "Listen" },
          ] as { k: Modality; Icon: React.ComponentType<{ className?: string }>; label: string }[]
        ).map(({ k, Icon, label }) => {
          const isActive = modality === k;
          return (
            <button
              key={k}
              onClick={() => setModality(k)}
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

      <AnimatePresence mode="wait">
        <motion.section
          key={modality + (lesson?.id ?? "none")}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="mt-8 rounded-2xl border border-border bg-card p-6 md:p-8"
        >
          {lesson ? (
            <>
              <h2 className="font-display text-2xl">{lesson.title}</h2>
              <div className="mt-5">
                {lesson.modality === "text" && (
                  <div className="prose-lesson max-w-none text-foreground">
                    <ReactMarkdown>{lesson.body_md ?? ""}</ReactMarkdown>
                  </div>
                )}
                {lesson.modality === "video" && lesson.media_url && (
                  <div className="aspect-video w-full overflow-hidden rounded-xl shadow-sm">
                    <iframe
                      src={lesson.media_url}
                      title={lesson.title}
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                )}
                {lesson.modality === "audio" && lesson.media_url && (
                  <audio controls src={lesson.media_url} className="w-full" />
                )}
                {lesson.modality !== "text" && lesson.body_md && (
                  <p className="mt-4 text-sm text-muted-foreground">{lesson.body_md}</p>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                {modality === "video" ? (
                  <PlayCircle className="h-6 w-6" />
                ) : modality === "audio" ? (
                  <Headphones className="h-6 w-6" />
                ) : (
                  <FileText className="h-6 w-6" />
                )}
              </span>
              <p className="mt-4 text-sm text-muted-foreground">
                No {modality === "text" ? "reading" : modality === "video" ? "video" : "audio"}{" "}
                lesson is available for this topic yet. Try another format above.
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
        <StartQuizButton
          topicId={topicId}
          size="lg"
          className="rounded-full transition-transform hover:scale-[1.02] active:scale-95"
        >
          Start quiz <ArrowRight className="ml-1.5 h-4 w-4" />
        </StartQuizButton>
      </motion.div>
    </main>
  );
}
