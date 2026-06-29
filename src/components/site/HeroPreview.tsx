import { motion } from "framer-motion";
import { BookOpen, GraduationCap, LayoutDashboard, Play, Search, Sparkles, Target } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";

/**
 * Decorative, non-interactive faux-dashboard shown in the marketing hero.
 * Mirrors the product mockup (sidebar shell, "Continue learning" gradient card,
 * progress ring, course tiles) using the app's violet tokens — no real data,
 * no chart lib. Purely illustrative, so it's hidden from assistive tech.
 */

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: BookOpen, label: "My Courses" },
  { icon: Target, label: "Progress" },
  { icon: GraduationCap, label: "Quizzes" },
];

const tiles = [
  { title: "Data Structures", pct: 75, hue: "var(--chart-1)" },
  { title: "Databases", pct: 40, hue: "var(--chart-2)" },
];

export function HeroPreview() {
  return (
    <div className="relative">
      {/* Soft violet glow behind the window */}
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2.5rem] [background:radial-gradient(60%_60%_at_70%_30%,color-mix(in_oklab,var(--color-primary)_22%,transparent),transparent_75%)]"
      />

      {/* App window */}
      <motion.div
        aria-hidden
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-2xl shadow-primary/10"
      >
        {/* Window title bar */}
        <div className="flex items-center gap-1.5 border-b border-border/70 bg-secondary/40 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.8_0.15_85)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>

        <div className="flex">
          {/* Sidebar rail */}
          <div className="hidden w-36 shrink-0 flex-col gap-1 border-r border-border/70 p-3 sm:flex">
            <div className="mb-2 flex items-center gap-2 px-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-bold tracking-tight">AceTutor</span>
            </div>
            {navItems.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium ${
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </div>
            ))}
          </div>

          {/* Main panel */}
          <div className="min-w-0 flex-1 space-y-4 p-4">
            {/* Top bar */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] text-muted-foreground">Welcome back</p>
                <p className="text-sm font-bold tracking-tight">Alex</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[10px] text-muted-foreground md:inline-flex">
                  <Search className="h-3 w-3" /> Search courses…
                </span>
                <span className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-[oklch(0.5_0.2_300)]" />
              </div>
            </div>

            {/* Continue learning + progress ring */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.6fr_1fr]">
              {/* Continue learning gradient card */}
              <motion.div
                variants={staggerItem}
                className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-4 text-primary-foreground"
              >
                <div aria-hidden className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/15 blur-xl" />
                <p className="text-[10px] font-medium uppercase tracking-widest text-primary-foreground/80">
                  Continue learning
                </p>
                <p className="mt-1 text-sm font-bold">UI/UX Design Fundamentals</p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                  <motion.div
                    className="h-full rounded-full bg-white"
                    initial={{ width: 0 }}
                    animate={{ width: "72%" }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
                  />
                </div>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[10px] font-semibold text-primary">
                  <Play className="h-3 w-3 fill-primary" /> Resume
                </span>
              </motion.div>

              {/* Progress ring */}
              <motion.div
                variants={staggerItem}
                className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card p-3"
              >
                <div
                  className="grid h-20 w-20 place-items-center rounded-full"
                  style={{
                    background:
                      "conic-gradient(var(--primary) 0% 72%, color-mix(in oklab, var(--primary) 14%, transparent) 72% 100%)",
                  }}
                >
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-card text-center">
                    <span className="text-sm font-bold leading-none">72%</span>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">Overall progress</p>
              </motion.div>
            </div>

            {/* Course tiles */}
            <motion.div variants={staggerItem} className="grid grid-cols-2 gap-3">
              {tiles.map((t) => (
                <div key={t.title} className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="h-10 w-full" style={{ background: `linear-gradient(120deg, ${t.hue}, color-mix(in oklab, ${t.hue} 55%, white))` }} />
                  <div className="p-2.5">
                    <p className="truncate text-[11px] font-semibold">{t.title}</p>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full" style={{ width: `${t.pct}%`, background: t.hue }} />
                    </div>
                    <p className="mt-1 text-[9px] text-muted-foreground">{t.pct}% complete</p>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Floating accent chips */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0, y: 12, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.6, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -left-3 top-20 hidden rounded-2xl border border-border bg-card px-3 py-2 shadow-lg sm:block"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <GraduationCap className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-semibold leading-tight">VARK style</p>
            <p className="text-[9px] text-muted-foreground">Visual learner</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        aria-hidden
        initial={{ opacity: 0, y: 12, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.75, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="animate-float absolute -bottom-4 -right-2 hidden rounded-2xl border border-border bg-card px-3 py-2 shadow-lg sm:block"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-success/15 text-success">
            <Target className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-semibold leading-tight">Quiz · 8/10</p>
            <p className="text-[9px] text-muted-foreground">Adaptive set</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
