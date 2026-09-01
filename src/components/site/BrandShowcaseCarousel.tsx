import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import useEmblaCarousel from "embla-carousel-react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CheckCircle2,
  GraduationCap,
  Headphones,
  LineChart,
  ListChecks,
  MessageSquare,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import studyLaptopPhoto from "@/assets/promo/study-laptop.jpg";
import studyHeadphonesPhoto from "@/assets/promo/study-headphones.jpg";

const EASE = [0.22, 1, 0.36, 1] as const;
const AUTOPLAY_MS = 3000;

/**
 * Three brand-poster style slides for the logged-in home — recreated as code
 * (not raster images) so they stay crisp and pick up the app's own tokens.
 * Same embla scroll mechanics as the other home carousels: drag/swipe, snap,
 * gentle autoplay that pauses on hover / focus, arrows + dots.
 */
export type BrandShowcaseCta = {
  label: string;
  to: "/courses" | "/onboarding/vark" | "/signup";
};

export function BrandShowcaseCarousel({ cta }: { cta: BrandShowcaseCta }) {
  const reduce = useReducedMotion();
  const [emblaRef, embla] = useEmblaCarousel({ align: "center", containScroll: "trimSnaps" });
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(false);

  const scrollTo = useCallback((i: number) => embla?.scrollTo(i), [embla]);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setSelected(embla.selectedScrollSnap());
    onSelect();
    embla.on("select", onSelect).on("reInit", onSelect);
    return () => {
      embla.off("select", onSelect).off("reInit", onSelect);
    };
  }, [embla]);

  useEffect(() => {
    if (!embla || paused || reduce) return;
    const id = window.setInterval(() => {
      if (embla.canScrollNext()) embla.scrollNext();
      else embla.scrollTo(0);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [embla, paused, reduce]);

  const slides = [
    <LightSlide key="learn" />,
    <DarkSlide key="journey" />,
    <GradientSlide key="study" cta={cta} />,
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE }}
      className="mt-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-4 [touch-action:pan-y]">
          {slides.map((slide, i) => (
            <div key={i} className="min-w-0 shrink-0 grow-0 basis-full">
              {slide}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => embla?.scrollPrev()}
          aria-label="Previous"
          className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => scrollTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === selected}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === selected ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/40"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => embla?.scrollNext()}
          aria-label="Next"
          className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.section>
  );
}

/** "Ace" + "Tutor" wordmark, in either a light-panel or dark-panel palette. */
function Wordmark({ on }: { on: "light" | "dark" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-display text-base font-extrabold tracking-tight ${
        on === "light" ? "text-foreground" : "text-white"
      }`}
    >
      <GraduationCap className={`h-5 w-5 ${on === "light" ? "text-primary" : "text-white"}`} />
      <span>
        Ace
        <span className={on === "light" ? "text-primary" : "text-[oklch(0.82_0.11_305)]"}>
          Tutor
        </span>
      </span>
    </span>
  );
}

/* --------------------------------- Slide 1 -------------------------------- */
/** "Learn Smarter. Get Personalized. Achieve More." — full-bleed photo, same
 *  treatment as Slide 3, so the two "poster" slides read as one family. */
function LightSlide() {
  const chips = ["AI-Powered", "Adaptive", "Multimodal"];
  const highlights = [
    { Icon: Brain, text: "Adapts every lesson to your VARK learning style" },
    { Icon: Headphones, text: "Switches between text, video, and audio" },
    { Icon: Target, text: "Quizzes that get smarter as you improve" },
  ];

  return (
    <div className="relative flex h-full min-h-[460px] flex-col justify-between gap-6 overflow-hidden rounded-3xl p-8 text-white md:min-h-[420px] md:p-12">
      <img src={studyLaptopPhoto} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-primary/92 via-[oklch(0.4_0.17_282)]/65 to-[oklch(0.4_0.17_282)]/15"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[oklch(0.24_0.13_282)]/80 via-transparent to-transparent"
      />

      <div className="relative">
        <Wordmark on="dark" />
        <h3 className="mt-4 max-w-md font-display text-2xl font-bold leading-tight md:text-3xl">
          Learn smarter. Get personalized. Achieve more.
        </h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm"
            >
              <Sparkles className="h-3 w-3" /> {label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative max-w-xs space-y-2.5">
        {highlights.map(({ Icon, text }, i) => (
          <motion.div
            key={text}
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            whileHover={{ x: 4 }}
            transition={{ delay: 0.1 + i * 0.1, duration: 0.4, ease: EASE }}
            className="flex items-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-[oklch(0.24_0.13_282)] shadow-md dark:bg-white/10 dark:text-white dark:shadow-none dark:ring-1 dark:ring-white/15 dark:backdrop-blur-sm"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary dark:bg-white/15 dark:text-white">
              <Icon className="h-3.5 w-3.5" />
            </span>
            {text}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- Slide 2 -------------------------------- */
/** "Your AI Tutor. Your Learning Journey." — dark panel, brain mark + 5 pillars. */
function DarkSlide() {
  const pillars = [
    { Icon: ListChecks, label: "Learn", sub: "Anytime, anywhere" },
    { Icon: SlidersHorizontal, label: "Adaptive", sub: "To your style" },
    { Icon: Headphones, label: "Multimodal", sub: "Text, video, audio" },
    { Icon: MessageSquare, label: "Real-time", sub: "Feedback" },
    { Icon: LineChart, label: "Track", sub: "Your progress" },
  ];

  return (
    <div className="relative flex h-full min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-b from-[oklch(0.2_0.05_268)] via-[oklch(0.15_0.045_270)] to-[oklch(0.11_0.03_270)] px-8 py-10 text-center text-white md:min-h-[380px] md:px-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:22px_22px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-16 h-56 w-56 -translate-x-1/2 rounded-full bg-[oklch(0.6_0.18_300)] opacity-25 blur-3xl"
      />

      <Wordmark on="dark" />
      <h3 className="relative mt-4 max-w-lg font-display text-2xl font-bold leading-tight md:text-3xl">
        Your AI Tutor.{" "}
        <span className="bg-gradient-to-r from-[oklch(0.8_0.1_300)] to-[oklch(0.78_0.13_330)] bg-clip-text text-transparent">
          Your Learning Journey.
        </span>
      </h3>
      <p className="relative mt-2 max-w-sm text-sm text-white/70">
        Personalized content, real-time feedback, and adaptive quizzes that help you excel.
      </p>

      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: EASE }}
        className="relative mt-6 grid h-16 w-16 place-items-center rounded-full bg-white/10 ring-1 ring-white/20"
      >
        <Brain className="h-7 w-7 text-[oklch(0.85_0.1_300)]" />
      </motion.div>

      <div className="relative mt-7 grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-5">
        {pillars.map(({ Icon, label, sub }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 + i * 0.06, duration: 0.35, ease: EASE }}
            className="flex flex-col items-center gap-1.5"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white">
              <Icon className="h-4 w-4" />
            </span>
            <p className="text-xs font-semibold">{label}</p>
            <p className="text-[10px] text-white/60">{sub}</p>
          </motion.div>
        ))}
      </div>

      <p className="relative mt-7 text-xs font-medium uppercase tracking-widest text-white/50">
        Ace your studies with <span className="text-[oklch(0.82_0.11_305)]">AceTutor</span>
      </p>
    </div>
  );
}

/* --------------------------------- Slide 3 -------------------------------- */
/** "Study in a way that works for you." — gradient panel, checklist + join CTA. */
function GradientSlide({ cta }: { cta: BrandShowcaseCta }) {
  const checklist = [
    { Icon: CheckCircle2, text: "Identify your learning style" },
    { Icon: Headphones, text: "Access engaging content in text, audio & video" },
    { Icon: Sparkles, text: "Test your knowledge with smart quizzes" },
    { Icon: RotateCcw, text: "Get instant feedback and improve" },
  ];

  return (
    <div className="relative flex h-full min-h-[420px] flex-col justify-between gap-6 overflow-hidden rounded-3xl p-8 text-white md:min-h-[380px] md:p-12">
      <img
        src={studyHeadphonesPhoto}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-[oklch(0.22_0.09_300)]/92 via-[oklch(0.24_0.09_300)]/60 to-[oklch(0.24_0.09_300)]/10"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[oklch(0.18_0.08_300)]/80 via-transparent to-transparent"
      />

      <div className="relative">
        <Wordmark on="dark" />
        <h3 className="mt-4 max-w-md font-display text-2xl font-bold leading-tight md:text-3xl">
          Study in a way that works for <span className="underline decoration-2">you.</span>
        </h3>
        <ul className="mt-5 max-w-md space-y-2.5">
          {checklist.map(({ Icon, text }, i) => (
            <motion.li
              key={text}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 + i * 0.07, duration: 0.35, ease: EASE }}
              className="flex items-center gap-2.5 text-sm"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {text}
            </motion.li>
          ))}
        </ul>
      </div>

      <div className="relative flex flex-col gap-3 rounded-2xl bg-black/35 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/90">
          Join thousands of students learning smarter every day.
        </p>
        <Link
          to={cta.to}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[oklch(0.35_0.15_320)] shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
        >
          {cta.label} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
