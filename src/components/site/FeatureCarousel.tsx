import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  Ear,
  Eye,
  FileText,
  Hand,
  Play,
  Sparkles,
  TrendingUp,
  Type,
  Video,
} from "lucide-react";
import { viewportOnce } from "@/lib/motion";

const EASE = [0.22, 1, 0.36, 1] as const;
const AUTOPLAY_MS = 3000;

/* --------------------------------- Slides --------------------------------- */

const SLIDES = [
  {
    id: "vark",
    tag: "Step 1 · Onboarding",
    title: "Learn how you actually learn",
    body: "A 16-question VARK intake pins down whether you absorb ideas best by seeing, hearing, reading, or doing — then every lesson adapts to match.",
    Visual: VarkVisual,
  },
  {
    id: "modality",
    tag: "Every topic",
    title: "Text, video, and audio — your call",
    body: "The same topic ships in three modalities. Start in the one that fits you and switch mid-lesson whenever it suits you.",
    Visual: ModalityVisual,
  },
  {
    id: "adaptive",
    tag: "Practice",
    title: "Quizzes that scale with you",
    body: "Question difficulty tracks your rolling accuracy, so you're always working just past your comfort zone — never bored, never buried.",
    Visual: AdaptiveVisual,
  },
  {
    id: "tutor",
    tag: "Anytime",
    title: "An AI tutor that knows your course",
    body: "Ask anything and get answers grounded in your actual course material — explanations, summaries, and quick knowledge checks on demand.",
    Visual: TutorVisual,
  },
  {
    id: "analytics",
    tag: "Progress",
    title: "See every gain you make",
    body: "Module completion, quiz accuracy, and study time come together in one view, so you always know what to revisit next.",
    Visual: AnalyticsVisual,
  },
] as const;

/* ------------------------------- Carousel -------------------------------- */

export function FeatureCarousel() {
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

  return (
    <section className="container mx-auto max-w-6xl px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={{ duration: 0.5, ease: EASE }}
        className="mb-8"
      >
        <h2 className="text-4xl font-bold tracking-tight">A closer look at the student side</h2>
        <p className="mt-2 text-muted-foreground">
          Five parts of the day-to-day student experience — drag or scroll through.
        </p>
      </motion.div>

      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-sm md:p-10"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
        />

        <div className="relative -mx-2 overflow-hidden" ref={emblaRef}>
          <div className="flex [touch-action:pan-y]">
            {SLIDES.map((s, i) => (
              <div key={s.id} className="min-w-0 shrink-0 grow-0 basis-full px-2">
                <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
                  {/* Copy */}
                  <div className="order-2 lg:order-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      <Sparkles className="h-3 w-3" /> {s.tag}
                    </span>
                    <h3 className="mt-4 font-display text-2xl font-bold tracking-tight md:text-3xl">
                      {s.title}
                    </h3>
                    <p className="mt-3 max-w-md text-sm text-muted-foreground md:text-base">
                      {s.body}
                    </p>
                  </div>

                  {/* Visual */}
                  <div className="order-1 lg:order-2">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-secondary/40 to-background">
                      <motion.div
                        key={`${s.id}-${selected === i}`}
                        initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, ease: EASE }}
                        className="absolute inset-0 p-5"
                      >
                        <s.Visual />
                      </motion.div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="relative mt-8 flex items-center gap-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => embla?.scrollPrev()}
              aria-label="Previous"
              className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => embla?.scrollNext()}
              aria-label="Next"
              className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(i)}
                aria-label={`Go to ${s.title}`}
                aria-current={i === selected}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === selected ? "w-10 bg-primary" : "w-2 bg-border hover:bg-muted-foreground/40"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Visuals -------------------------------- */

function VarkVisual() {
  const opts = [
    { icon: Eye, label: "Visual" },
    { icon: Ear, label: "Aural" },
    { icon: FileText, label: "Read / Write", active: true },
    { icon: Hand, label: "Kinesthetic" },
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        VARK intake · Question 7
      </p>
      <p className="mt-1.5 text-sm font-semibold">How do you best lock in a new idea?</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {opts.map((o, i) => (
          <motion.div
            key={o.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.4, ease: EASE }}
            className={`relative flex items-center gap-2 rounded-xl border p-2.5 text-[11px] font-medium ${
              o.active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            <o.icon className="h-3.5 w-3.5 shrink-0" />
            {o.label}
            {o.active && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.55, type: "spring", stiffness: 320, damping: 14 }}
                className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"
              >
                <Check className="h-2.5 w-2.5" />
              </motion.span>
            )}
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.75 }}
        className="mt-3 flex items-center gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-[10px] text-muted-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        Result: Read/Write learner — lessons now default to notes.
      </motion.div>
    </div>
  );
}

function ModalityVisual() {
  const modes = [
    { icon: Type, label: "Text" },
    { icon: Video, label: "Video" },
    { icon: AudioLines, label: "Audio" },
  ];
  const [m, setM] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setM((x) => (x + 1) % modes.length), 1600);
    return () => window.clearInterval(id);
  }, [modes.length]);

  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Topic · Database Normalization
      </p>
      <div className="mt-2 flex gap-1 rounded-full border border-border bg-background p-1">
        {modes.map((mm, i) => (
          <button
            key={mm.label}
            type="button"
            className="relative flex-1 rounded-full px-2 py-1.5 text-[11px] font-medium"
          >
            {i === m && (
              <motion.span
                layoutId="fc-modepill"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <span
              className={`relative flex items-center justify-center gap-1.5 ${
                i === m ? "text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              <mm.icon className="h-3.5 w-3.5" /> {mm.label}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 h-[104px] rounded-xl border border-border bg-background/70 p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={m}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="h-full"
          >
            {m === 0 && (
              <div className="space-y-1.5 py-1">
                {[92, 80, 68, 84, 56].map((w, i) => (
                  <div key={i} className="h-2 rounded-full bg-muted" style={{ width: `${w}%` }} />
                ))}
              </div>
            )}
            {m === 1 && (
              <div className="grid h-full place-items-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                  <Play className="h-4 w-4 fill-current" />
                </span>
              </div>
            )}
            {m === 2 && (
              <div className="flex h-full items-center justify-center gap-1">
                {Array.from({ length: 15 }).map((_, i) => (
                  <motion.span
                    key={i}
                    className="w-1 rounded-full bg-primary"
                    animate={{ height: [6, 8 + ((i * 7) % 5) * 6, 6] }}
                    transition={{
                      duration: 0.9,
                      repeat: Infinity,
                      delay: i * 0.05,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function AdaptiveVisual() {
  const bars = [38, 52, 44, 66, 90];
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Adaptive quiz
        </p>
        <motion.span
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
        >
          <TrendingUp className="h-3 w-3" /> Difficulty rising
        </motion.span>
      </div>
      <div className="mt-2 rounded-xl border border-border bg-background/70 p-3">
        <p className="text-[11px] font-semibold">
          Which normal form removes transitive dependencies?
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {["1NF", "2NF", "3NF", "BCNF"].map((c, i) => (
            <motion.div
              key={c}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.06 }}
              className={`rounded-md border px-2 py-1 text-[10px] ${
                c === "3NF"
                  ? "border-success/60 bg-success/10 text-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {c}
            </motion.div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-14 items-end gap-2">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            initial={{ height: 4 }}
            animate={{ height: `${h}%` }}
            transition={{ delay: 0.15 + i * 0.1, duration: 0.5, ease: EASE }}
            className={`w-full rounded-t-md ${
              i === bars.length - 1 ? "bg-primary" : "bg-primary/25"
            }`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Accuracy is high — the next set steps up.
      </p>
    </div>
  );
}

function TutorVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        AI Course Tutor
      </p>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
        className="ml-auto max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[11px] text-primary-foreground"
      >
        Explain B-trees like I'm five.
      </motion.div>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.35 }}
        className="mr-auto max-w-[82%] rounded-2xl rounded-bl-sm border border-border bg-background px-3 py-2"
      >
        <TutorReply />
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.1 }}
        className="mr-auto inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] text-muted-foreground"
      >
        <BookOpen className="h-3 w-3" /> Grounded in your course material
      </motion.div>
    </div>
  );
}

function TutorReply() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), 1200);
    return () => window.clearTimeout(t);
  }, []);

  if (!done) {
    return (
      <span className="flex gap-1 py-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
    );
  }
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-[11px] leading-relaxed text-foreground"
    >
      A B-tree is a tidy bookshelf: each shelf points to smaller shelves, so you reach any book in
      just a few hops.
    </motion.p>
  );
}

function AnalyticsVisual() {
  const rows = [
    { label: "Databases", pct: 82 },
    { label: "Algorithms", pct: 64 },
    { label: "Networks", pct: 45 },
  ];
  return (
    <div className="flex h-full items-center gap-5">
      <div className="shrink-0">
        <motion.div
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="grid h-24 w-24 place-items-center rounded-full"
          style={{
            background:
              "conic-gradient(var(--primary) 0% 68%, color-mix(in oklab, var(--primary) 14%, transparent) 68% 100%)",
          }}
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-background">
            <span className="text-base font-bold">68%</span>
          </div>
        </motion.div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Overall</p>
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{r.label}</span>
              <span>{r.pct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${r.pct}%` }}
                transition={{ delay: 0.2 + i * 0.12, duration: 0.6, ease: EASE }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
