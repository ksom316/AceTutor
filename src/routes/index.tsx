import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Headphones,
  
  PlayCircle,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const CHART_PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { user, loading } = useAuth();

  return (
    <div className="min-h-screen">
      <Header />
      <main>{loading ? <div className="h-[60vh]" /> : user ? <AuthedHome userId={user.id} /> : <VisitorHome />}</main>
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
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-10 md:pt-16">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] [background:radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_70%)]" />
        <div className="container mx-auto max-w-6xl px-4 pb-16 md:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-4xl text-center"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" /> Next-Gen Adaptive Tutor
            </span>
            <h1 className="mt-6 text-5xl font-bold leading-[1.02] tracking-tight md:text-7xl">
              One Tutor. <span className="text-primary">Three Ways</span> to Learn.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
              AceTutor adapts every lesson to your VARK learning style — switching between text, video, and audio — and
              tests what you know with quizzes that get smarter as you do.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
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
              className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-6 md:grid-cols-4"
            >
              {stats.map((s) => (
                <motion.div key={s.label} variants={staggerItem} className="text-left md:text-center">
                  <p className="text-4xl font-bold tracking-tight md:text-5xl">
                    <CountUpValue value={s.value} />
                  </p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">{s.label}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c, i) => (
            <motion.div
              key={c.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <Link
                to="/courses/$slug"
                params={{ slug: c.slug }}
                className="group block h-full rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </div>
                <h3 className="mt-4 text-2xl font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{c.blurb}</p>
              </Link>
            </motion.div>
          ))}
        </div>
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

  const { data: enrollments } = useQuery({
    queryKey: ["home-enrollments", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("course_id, created_at, courses(id, slug, title, summary)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: attempts } = useQuery({
    queryKey: ["home-attempts", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_attempts")
        .select("id, score, total, finished_at, topic_id, topics(title, slug, courses(slug, title))")
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const isLecturer = role === "lecturer" || role === "admin";
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const enrolledCourses = (enrollments ?? []).map((e: any) => e.courses).filter(Boolean);
  const recentCourses = enrolledCourses.slice(0, 3);

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
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight md:text-5xl">{firstName}</h1>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {isLecturer ? "Lecturer" : "Student"} workspace
          </p>
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

      {isLecturer ? (
        <LecturerPanels />
      ) : (
        <StudentPanels
          recentCourses={recentCourses}
          enrolledCourses={enrolledCourses}
          totalEnrolled={enrolledCourses.length}
          attempts={attempts ?? []}
        />
      )}
    </div>
  );
}

function StudentPanels({
  recentCourses,
  enrolledCourses,
  totalEnrolled,
  attempts,
}: {
  recentCourses: any[];
  enrolledCourses: any[];
  totalEnrolled: number;
  attempts: any[];
}) {
  const navigate = useNavigate();
  const firstCourseSlug = recentCourses[0]?.slug;
  void navigate;
  void firstCourseSlug;

  return (
    <>
      {/* Quick action */}
      <section className="mt-10 rounded-3xl border border-border bg-card p-6 md:p-8">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-2xl font-semibold tracking-tight">Expand your learning</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse the catalog and enroll in additional courses any time.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="lg" className="h-12 rounded-xl">
            <Link to="/courses">
              <BookOpen className="mr-1.5 h-4 w-4" /> Enroll in a new course
            </Link>
          </Button>
        </div>
      </section>


      {/* Learning overview */}
      <motion.section
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={viewportOnce}
        className="mt-8 grid gap-6 md:grid-cols-3"
      >
        <StatCard icon={BookOpen} label="Enrolled courses" value={String(totalEnrolled)} />
        <StatCard icon={Trophy} label="Quizzes taken" value={String(attempts.length)} />
        <StatCard
          icon={Target}
          label="Avg. score"
          value={
            attempts.length
              ? `${Math.round(
                  (attempts.reduce((s, a) => s + (a.score / Math.max(1, a.total)) * 100, 0) / attempts.length),
                )}%`
              : "—"
          }
        />
      </motion.section>

      {/* Progress charts */}
      <ProgressCharts enrolledCourses={enrolledCourses} attempts={attempts} />

      {/* Recently accessed courses */}
      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Your courses</h2>
          <Link to="/courses" className="text-sm text-muted-foreground hover:text-foreground">
            Browse catalog →
          </Link>
        </div>
        {recentCourses.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentCourses.map((c) => (
              <Link
                key={c.slug}
                to="/courses/$slug"
                params={{ slug: c.slug }}
                className="group block rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40"
              >
                <BookOpen className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-lg font-semibold">{c.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>
                <span className="mt-3 inline-flex items-center text-sm text-primary">
                  Continue <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
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
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent quiz attempts</h2>
            <Trophy className="h-5 w-5 text-accent" />
          </div>
          {attempts.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {attempts.map((a: any) => (
                <li key={a.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
                  <span className="truncate pr-3">{a.topics?.title ?? "Quiz"}</span>
                  <span className="text-muted-foreground">
                    {a.score} / {a.total}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No quizzes yet — take one to see your progress.</p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recommended for you</h2>
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {courses
              .filter((c) => !recentCourses.some((r) => r.slug === c.slug))
              .slice(0, 4)
              .map((c) => (
                <li key={c.slug} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
                  <span className="truncate pr-3">{c.title}</span>
                  <Link to="/courses/$slug" params={{ slug: c.slug }} className="text-primary hover:underline">
                    View
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      </section>
    </>
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

/* --------------------------- Progress charts --------------------------- */

function ProgressCharts({ enrolledCourses, attempts }: { enrolledCourses: any[]; attempts: any[] }) {
  // Bar chart: score (%) for each recent attempt, oldest → newest.
  const scoreData = [...attempts]
    .reverse()
    .map((a: any, i: number) => ({
      name: a.topics?.title ? truncate(a.topics.title, 16) : `Quiz ${i + 1}`,
      score: Math.round((a.score / Math.max(1, a.total)) * 100),
    }));

  // Pie chart: how your study time is split across courses.
  // Prefer quizzes-per-course; fall back to enrolled courses so the chart is never empty.
  const counts = new Map<string, number>();
  for (const a of attempts) {
    const title = a.topics?.courses?.title ?? "Other";
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  let pieData = Array.from(counts, ([name, value]) => ({ name, value }));
  let pieLabel = "Quizzes taken per course";
  if (pieData.length === 0) {
    pieData = (enrolledCourses ?? []).map((c: any) => ({ name: c.title, value: 1 }));
    pieLabel = "Courses you're enrolled in";
  }

  const hasAnyData = scoreData.length > 0 || pieData.length > 0;
  if (!hasAnyData) return null;

  const scoreConfig: ChartConfig = {
    score: { label: "Score %", color: "var(--color-chart-1)" },
  };
  const pieConfig: ChartConfig = Object.fromEntries(
    pieData.map((d, i) => [d.name, { label: d.name, color: CHART_PALETTE[i % CHART_PALETTE.length] }]),
  );

  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-2">
      {/* Bar graph — scores over time */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quiz scores over time</h2>
          <Target className="h-5 w-5 text-primary" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Your most recent quiz results, as a percentage.</p>
        {scoreData.length ? (
          <ChartContainer config={scoreConfig} className="mt-4 aspect-[16/9] w-full">
            <BarChart data={scoreData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={8} width={36} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="score" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">Take a quiz to start tracking your scores.</p>
        )}
      </div>

      {/* Pie chart — course distribution */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Where you're focused</h2>
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{pieLabel}.</p>
        {pieData.length ? (
          <ChartContainer config={pieConfig} className="mt-4 aspect-square max-h-[280px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent />} />
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} stroke="var(--color-card)" strokeWidth={2} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">Enroll in a course to see your focus areas.</p>
        )}
        {pieData.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {pieData.map((d, i) => (
              <li key={d.name} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }}
                />
                <span className="text-muted-foreground">{d.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
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

