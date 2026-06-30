import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Brain,
  Headphones,
  Play,
  PlayCircle,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { HeroPreview } from "@/components/site/HeroPreview";
import { CourseCard } from "@/components/site/CourseCard";
import { useEnrolledCourses } from "@/hooks/use-enrolled-courses";
import { Button } from "@/components/ui/button";

import { useAuth } from "@/hooks/use-auth";
import { useStudentDashboard, type PerCourse } from "@/hooks/use-student-dashboard";
import { courseGradient } from "@/lib/course-visuals";
import { AppShell } from "@/components/site/AppShell";
import { supabase } from "@/integrations/supabase/client";

const DONUT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--muted)"];

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { user, loading } = useAuth();

  // Signed in → the same sidebar shell as the student workspace, so the home
  // page and the workspace share one navigation. Visitors keep the marketing
  // chrome (floating header + footer).
  if (user) {
    return (
      <AppShell user={user}>
        <AuthedHome userId={user.id} />
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main>{loading ? <div className="h-[60vh]" /> : <VisitorHome />}</main>
      <Footer />
    </div>
  );
}

/* ----------------------------- Visitor Home ----------------------------- */

const courses = [
  { slug: "dsa", title: "Data Structures & Algorithms", blurb: "Arrays, sorting, complexity." },
  { slug: "dbms", title: "Database Management", blurb: "SQL, joins, normalization." },
  { slug: "networks", title: "Computer Networks", blurb: "OSI, TCP/IP, sockets." },
  { slug: "se", title: "Software Engineering", blurb: "SDLC, agile, patterns." },
  { slug: "ai", title: "Introduction to AI", blurb: "Search, ML fundamentals." },
];

const stats = [
  { value: "5", label: "Courses" },
  { value: "16", label: "VARK questions" },
  { value: "3", label: "Modalities" },
  { value: "24/7", label: "AI tutor" },
];

function VisitorHome() {
  const { loggedIn, isEnrolled, enroll } = useEnrolledCourses();

  // Real catalog (shares the ["courses"] cache with the /courses page); falls
  // back to the hand-curated list so the marketing page is never empty.
  const { data: dbCourses } = useQuery({
    queryKey: ["courses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, slug, title, summary, order_index")
        .order("order_index");
      if (error) throw error;
      return data;
    },
  });

  const previewCourses = (dbCourses?.length
    ? dbCourses
    : courses.map((c) => ({ id: c.slug, slug: c.slug, title: c.title, summary: c.blurb }))
  ).slice(0, 6);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-10 md:pt-16">
        <div className="absolute inset-x-0 top-0 -z-10 h-[620px] [background:radial-gradient(55%_60%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_70%)]" />
        <div className="container mx-auto max-w-7xl px-4 pb-16 md:pb-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
            {/* Left — copy + CTAs + stats */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center lg:text-left"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3 w-3" /> Next-Gen Adaptive Tutor
              </span>
              <h1 className="mt-6 text-5xl font-bold leading-[1.02] tracking-tight md:text-7xl">
                One Tutor. <span className="text-primary">Three Ways</span> to Learn.
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground md:text-lg lg:mx-0">
                AceTutor adapts every lesson to your VARK learning style — switching between text, video, and audio — and
                tests what you know with quizzes that get smarter as you do.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
                <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
                  <Link to="/signup">
                    Get Started Free <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-12 rounded-full px-6 text-base">
                  <Link to="/login">Login</Link>
                </Button>
              </div>

              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="mt-12 grid max-w-lg grid-cols-2 gap-6 md:grid-cols-4 lg:mx-0"
              >
                {stats.map((s) => (
                  <motion.div key={s.label} variants={staggerItem} className="text-center lg:text-left">
                    <p className="text-3xl font-bold tracking-tight md:text-4xl">
                      <CountUpValue value={s.value} />
                    </p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">{s.label}</p>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right — product preview mockup */}
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
              className="mx-auto w-full max-w-xl lg:mx-0"
            >
              <HeroPreview />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="grid gap-4 md:grid-cols-3"
        >
          {[
            { icon: Brain, title: "VARK-aware", body: "A quick intake classifies how you process information — visual, aural, read/write, or kinesthetic." },
            { icon: PlayCircle, title: "Three modalities", body: "Every topic ships as readable notes, an explainer video, and a focused audio lesson." },
            { icon: Target, title: "Adaptive quizzes", body: "Question difficulty scales with your rolling accuracy so you're always working the right edge." },
          ].map(({ icon: Icon, title, body }) => (
            <motion.div
              key={title}
              variants={staggerItem}
              whileHover={{ y: -4 }}
              className="group rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-lg"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Courses preview */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-4xl font-bold tracking-tight">Five university courses, ready now.</h2>
            <p className="mt-2 text-muted-foreground">Hand-curated topics for the BSc CS / IT curriculum.</p>
          </div>
          <Link to="/courses" className="hidden text-sm text-muted-foreground hover:text-foreground md:inline-flex md:items-center">
            See all <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {previewCourses.map((c, i) => (
            <CourseCard
              key={c.id}
              course={c}
              index={i}
              loggedIn={loggedIn}
              enrolled={isEnrolled(c.id)}
              enrolling={enroll.isPending && enroll.variables === c.id}
              onEnroll={() => enroll.mutate(c.id)}
            />
          ))}
        </motion.div>
      </section>

      {/* How it works */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="rounded-3xl border border-border bg-card p-8 md:p-12"
        >
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">How AceTutor works</h2>
          <motion.ol
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="mt-8 grid gap-6 md:grid-cols-3"
          >
            {[
              { n: "01", t: "Tell us how you learn", d: "Answer 16 short questions to discover your VARK style.", Icon: Brain },
              { n: "02", t: "Study in your modality", d: "Lessons default to your preferred medium. Switch any time.", Icon: Headphones },
              { n: "03", t: "Quiz, review, repeat", d: "Adaptive quizzes diagnose gaps with plain-language feedback.", Icon: Target },
            ].map(({ n, t, d, Icon }) => (
              <motion.li
                key={n}
                variants={staggerItem}
                whileHover={{ y: -4 }}
                className="group rounded-2xl border border-border/60 p-5 transition-all hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-bold text-muted-foreground/40">{n}</span>
                  <Icon className="h-5 w-5 text-primary transition-transform duration-300 group-hover:scale-110" />
                </div>
                <h3 className="mt-3 text-lg font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </motion.li>
            ))}
          </motion.ol>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/signup">Create your free account</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full">
              <Link to="/login">Login</Link>
            </Button>
          </div>
        </motion.div>
      </section>

      {/* Final CTA band */}
      <section className="container mx-auto max-w-6xl px-4 pb-20 pt-4">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-8 text-center text-primary-foreground shadow-lg md:p-14"
        >
          <div aria-hidden className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="absolute -bottom-16 -left-6 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
          <h2 className="relative mx-auto max-w-2xl text-3xl font-bold tracking-tight md:text-5xl">
            Learn the way your brain actually works.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-sm text-primary-foreground/85 md:text-base">
            Take the VARK intake, pick a course, and start studying in your modality — text, video, or audio — today.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 rounded-full bg-white px-6 text-base text-primary hover:bg-white/90">
              <Link to="/signup">
                Get Started Free <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-white/40 bg-transparent px-6 text-base text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            >
              <Link to="/login">Login</Link>
            </Button>
          </div>
        </motion.div>
      </section>
    </>
  );
}

/* ---------------------------- Authed Home ------------------------------ */

function AuthedHome({ userId }: { userId: string }) {
  const { data: profile } = useQuery({
    queryKey: ["home-profile", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, vark_primary, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      return data;
    },
  });

  const { data: role } = useQuery({
    queryKey: ["home-role", userId],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
      return (data?.role as string | undefined) ?? "student";
    },
  });

  const isLecturer = role === "lecturer" || role === "admin";
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      {/* Welcome */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">
            Welcome back, {firstName} <span className="inline-block">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Let's continue your learning journey.</p>
        </div>
        {!profile?.vark_primary && !isLecturer && (
          <Link
            to="/onboarding/vark"
            className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-foreground hover:bg-primary/15"
          >
            Take the VARK intake <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </motion.section>

      {isLecturer ? <LecturerPanels /> : <StudentPanels userId={userId} />}
    </div>
  );
}

function StudentPanels({ userId }: { userId: string }) {
  const { perCourse, overallPct, donut, continueCourse, recommended, recentAttempts } =
    useStudentDashboard(userId);
  const donutHasData = donut.some((d) => d.value > 0);

  return (
    <>
      {/* Continue learning + progress donut */}
      <motion.section
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]"
      >
        {/* Continue learning */}
        <motion.div
          variants={staggerItem}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-6 text-primary-foreground shadow-lg md:p-8"
        >
          <div aria-hidden className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="absolute -bottom-16 -right-4 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <p className="relative text-xs font-medium uppercase tracking-widest text-primary-foreground/80">
            Continue learning
          </p>
          {continueCourse ? (
            <>
              <h2 className="relative mt-2 font-display text-2xl leading-tight md:text-3xl">
                {continueCourse.title}
              </h2>
              <p className="relative mt-1 text-sm text-primary-foreground/80">
                {continueCourse.done}/{continueCourse.total || "—"} lessons complete
              </p>
              <div className="relative mt-5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/25">
                <motion.div
                  className="h-full rounded-full bg-white"
                  initial={{ width: 0 }}
                  animate={{ width: `${continueCourse.pct}%` }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                />
              </div>
              <p className="relative mt-1.5 text-xs text-primary-foreground/80">{continueCourse.pct}% complete</p>
              <Link
                to="/courses/$slug"
                params={{ slug: continueCourse.slug }}
                className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
              >
                <Play className="h-4 w-4 fill-primary" /> Resume course
              </Link>
            </>
          ) : (
            <>
              <h2 className="relative mt-2 font-display text-2xl leading-tight md:text-3xl">
                Start your first course
              </h2>
              <p className="relative mt-1 max-w-sm text-sm text-primary-foreground/80">
                Browse the catalog and enroll to begin tracking your progress here.
              </p>
              <Link
                to="/courses"
                className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
              >
                <BookOpen className="h-4 w-4" /> Browse courses
              </Link>
            </>
          )}
        </motion.div>

        {/* Progress donut */}
        <motion.div variants={staggerItem} className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg">Your progress</h2>
            <Target className="h-4 w-4 text-primary" />
          </div>
          <div className="relative mt-2 h-40">
            {donutHasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donut}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={70}
                    paddingAngle={3}
                    stroke="var(--card)"
                    strokeWidth={2}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {donut.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
                Start a lesson to track progress
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="font-display text-3xl">{overallPct}%</div>
                <div className="text-[11px] text-muted-foreground">overall</div>
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs">
            {donut.map((d, i) => (
              <li key={d.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[i] }} />
                  {d.name}
                </span>
                <span className="font-medium">{d.value}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </motion.section>

      {/* My courses */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl">My courses</h2>
          <Link
            to="/my-courses"
            className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
        {perCourse.length > 0 ? (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {perCourse.map((c, i) => (
              <CourseProgressCard key={c.id} course={c} index={i} />
            ))}
          </motion.div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">You're not enrolled in any course yet.</p>
            <Button asChild className="mt-4 rounded-full">
              <Link to="/courses">Browse courses</Link>
            </Button>
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg">Recent quiz attempts</h2>
            <Trophy className="h-4 w-4 text-primary" />
          </div>
          {recentAttempts.length ? (
            <ul className="divide-y divide-border/70">
              {recentAttempts.map((a: any) => {
                const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.topics?.title ?? "Quiz"}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.topics?.courses?.title}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        pct >= 70 ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
                      }`}
                    >
                      {a.score}/{a.total} · {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No quizzes yet — take one to see your scores here.</p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg">Recommended for you</h2>
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          {recommended.length ? (
            <ul className="space-y-1">
              {recommended.map((c: any) => (
                <li key={c.id}>
                  <Link
                    to="/courses/$slug"
                    params={{ slug: c.slug }}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-secondary"
                  >
                    <span className="truncate">{c.title}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-2">
              <p className="text-sm text-muted-foreground">
                You're making progress everywhere — explore the catalog for something new.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3 rounded-full">
                <Link to="/courses">Browse catalog</Link>
              </Button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** A "My courses" card with a gradient thumbnail banner, status pill, and progress bar. */
function CourseProgressCard({ course, index }: { course: PerCourse; index: number }) {
  const status =
    course.pct >= 100
      ? { label: "Completed", className: "bg-success/15 text-success" }
      : course.touched > 0
        ? { label: "In Progress", className: "bg-primary/10 text-primary" }
        : { label: "Not Started", className: "bg-muted text-muted-foreground" };

  return (
    <motion.div variants={staggerItem} whileHover={{ y: -4 }}>
      <Link
        to="/courses/$slug"
        params={{ slug: course.slug }}
        className="group block h-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:border-primary/40 hover:shadow-lg"
      >
        {/* Gradient thumbnail */}
        <div className="relative h-24" style={{ background: courseGradient(index) }}>
          <span className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-xl bg-white/25 text-white backdrop-blur-sm">
            <BookOpen className="h-5 w-5" />
          </span>
          <span
            className={`absolute right-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${status.className}`}
          >
            {status.label}
          </span>
        </div>

        {/* Body */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-1 font-display text-lg">{course.title}</h3>
            <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {course.total > 0 ? `${course.total} lessons` : "Lessons coming soon"}
          </p>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              whileInView={{ width: `${course.pct}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{course.pct}% complete</p>
        </div>
      </Link>
    </motion.div>
  );
}

function LecturerPanels() {
  return (
    <>
      <section className="mt-10 grid gap-6 md:grid-cols-3">
        <StatCard icon={BookOpen} label="Managed courses" value="—" />
        <StatCard icon={Users} label="Students" value="—" />
        <StatCard icon={Trophy} label="Recent submissions" value="—" />
      </section>

      <section className="mt-10 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">Course management</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manage your courses, review student analytics, and respond to activity.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild className="rounded-full">
            <Link to="/courses">Open course catalog</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/profile">Profile & settings</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

/** Counts up to a numeric value when scrolled into view; renders non-numeric strings (e.g. "24/7") as-is. */
function CountUpValue({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const isPureNumber = /^\d+$/.test(value);
  const target = isPureNumber ? parseInt(value, 10) : 0;
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => String(Math.round(v)));
  const [display, setDisplay] = useState(isPureNumber ? "0" : value);

  useEffect(() => {
    if (!isPureNumber) return;
    const unsub = rounded.on("change", setDisplay);
    if (inView) {
      const controls = animate(mv, target, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
      return () => {
        unsub();
        controls.stop();
      };
    }
    return unsub;
  }, [inView, isPureNumber, target, mv, rounded]);

  return <span ref={ref}>{display}</span>;
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -4 }}
      className="group rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-lg"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary transition-transform duration-300 group-hover:scale-110" />
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
    </motion.div>
  );
}

