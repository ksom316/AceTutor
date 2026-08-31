import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import useEmblaCarousel from "embla-carousel-react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpen, Play } from "lucide-react";
import type { PerCourse } from "@/hooks/use-student-dashboard";

const EASE = [0.22, 1, 0.36, 1] as const;
const AUTOPLAY_MS = 4500;

/** Bold panel gradients, cycled by position — mirrors the marketing palette. */
const GRADIENTS = [
  "from-primary via-primary to-[oklch(0.52_0.2_300)]",
  "from-[oklch(0.55_0.19_255)] via-[oklch(0.5_0.2_285)] to-[oklch(0.5_0.2_312)]",
  "from-[oklch(0.5_0.2_300)] via-[oklch(0.53_0.19_324)] to-[oklch(0.56_0.17_15)]",
  "from-[oklch(0.56_0.15_190)] via-[oklch(0.53_0.17_228)] to-[oklch(0.5_0.2_275)]",
  "from-[oklch(0.5_0.19_278)] via-[oklch(0.48_0.2_300)] to-[oklch(0.51_0.18_338)]",
];

/**
 * The logged-in home's headline element: a horizontally scrolling carousel of
 * every course the student is enrolled in, "Continue learning" featured first.
 * Native drag / touch scroll (embla) with snap, gentle autoplay that pauses on
 * hover / focus, arrows, and a stepwise progress bar + dots.
 */
export function EnrolledCoursesCarousel({
  courses,
  continueCourse,
}: {
  courses: PerCourse[];
  continueCourse: PerCourse | null;
}) {
  const reduce = useReducedMotion();

  const ordered =
    continueCourse && courses.some((c) => c.id === continueCourse.id)
      ? [continueCourse, ...courses.filter((c) => c.id !== continueCourse.id)]
      : courses;

  const [emblaRef, embla] = useEmblaCarousel({ align: "start", containScroll: "trimSnaps" });
  const [selected, setSelected] = useState(0);
  const [snapCount, setSnapCount] = useState(0);
  const [paused, setPaused] = useState(false);

  const scrollTo = useCallback((i: number) => embla?.scrollTo(i), [embla]);

  useEffect(() => {
    if (!embla) return;
    const sync = () => {
      setSnapCount(embla.scrollSnapList().length);
      setSelected(embla.selectedScrollSnap());
    };
    sync();
    embla.on("select", sync).on("reInit", sync);
    return () => {
      embla.off("select", sync).off("reInit", sync);
    };
  }, [embla]);

  useEffect(() => {
    if (!embla || paused || reduce || ordered.length < 2) return;
    const id = window.setInterval(() => {
      if (embla.canScrollNext()) embla.scrollNext();
      else embla.scrollTo(0);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [embla, paused, reduce, ordered.length]);

  if (ordered.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mt-8"
      >
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.52_0.2_300)] p-8 text-primary-foreground shadow-lg md:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/15 blur-3xl"
          />
          <p className="relative text-xs font-semibold uppercase tracking-widest text-primary-foreground/80">
            Get started
          </p>
          <h2 className="relative mt-2 font-display text-2xl md:text-3xl">
            Start your first course
          </h2>
          <p className="relative mt-2 max-w-md text-sm text-primary-foreground/85">
            Browse the catalog and enroll — your courses will show up here to pick up any time.
          </p>
          <Link
            to="/courses"
            className="relative mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
          >
            <BookOpen className="h-4 w-4" /> Browse courses
          </Link>
        </div>
      </motion.div>
    );
  }

  const barFill = snapCount > 0 ? (selected + 1) / snapCount : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="mt-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg">Your courses</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => embla?.scrollPrev()}
            className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => embla?.scrollNext()}
            className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <Link
            to="/my-courses"
            className="ml-1 hidden items-center text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-4 [touch-action:pan-y]">
          {ordered.map((c, i) => (
            <div key={c.id} className="min-w-0 shrink-0 grow-0 basis-[86%] sm:basis-[360px]">
              <CourseSlide
                course={c}
                gradient={GRADIENTS[i % GRADIENTS.length]}
                featured={i === 0 && !!continueCourse}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary"
            style={{
              transform: `scaleX(${Math.max(barFill, 0.04)})`,
              transformOrigin: "left",
              transition: "transform 240ms cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: snapCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === selected}
              onClick={() => scrollTo(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === selected ? "w-5 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/40"
              }`}
            />
          ))}
        </div>
      </div>
    </motion.section>
  );
}

function CourseSlide({
  course,
  gradient,
  featured,
}: {
  course: PerCourse;
  gradient: string;
  featured: boolean;
}) {
  const started = course.touched > 0 || course.pct > 0;
  const status = featured
    ? "Continue learning"
    : course.pct >= 100
      ? "Completed"
      : started
        ? "In progress"
        : "Not started";

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={`relative flex h-52 select-none flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br ${gradient} p-5 text-primary-foreground shadow-lg shadow-primary/10`}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
        <BookOpen
          className="absolute -bottom-5 -right-3 h-32 w-32 text-white/10"
          strokeWidth={1.25}
        />
      </div>

      <div className="relative">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary-foreground/80">
          {status}
        </p>
        <h3 className="mt-1 line-clamp-2 font-display text-xl leading-tight">{course.title}</h3>
      </div>

      <div className="relative">
        <div className="flex items-center justify-between text-[11px] text-primary-foreground/85">
          <span>
            {course.total > 0 ? `${course.done}/${course.total} modules` : "Modules coming soon"}
          </span>
          <span>{course.pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/25">
          <motion.div
            className="h-full rounded-full bg-white"
            initial={{ width: 0 }}
            whileInView={{ width: `${course.pct}%` }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: EASE }}
          />
        </div>
        <Link
          to="/courses/$slug"
          params={{ slug: course.slug }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-primary shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
        >
          <Play className="h-3.5 w-3.5 fill-current" /> {started ? "Resume" : "Start"}
        </Link>
      </div>
    </motion.div>
  );
}
