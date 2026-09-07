import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  ClipboardList,
  Gamepad2,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";

import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { HeroPreview } from "@/components/site/HeroPreview";
import { FeatureCarousel } from "@/components/site/FeatureCarousel";
import { EnrolledCoursesCarousel } from "@/components/site/EnrolledCoursesCarousel";
import { BrandShowcaseCarousel } from "@/components/site/BrandShowcaseCarousel";
import { CourseCard } from "@/components/site/CourseCard";
import { useEnrolledCourses } from "@/hooks/use-enrolled-courses";
import { Button } from "@/components/ui/button";

import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useStudentDashboard } from "@/hooks/use-student-dashboard";
import { AppShell } from "@/components/site/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { user, loading } = useAuth();
  const { isLecturer, loading: roleLoading } = useRole();
  const navigate = useNavigate();

  // A claimed lecturer's home is the lecturer workspace, not the student one.
  useEffect(() => {
    if (user && !roleLoading && isLecturer) navigate({ to: "/lecturer" });
  }, [user, roleLoading, isLecturer, navigate]);

  // Signed in → the same sidebar shell as the student workspace, so the home
  // page and the workspace share one navigation. Visitors keep the marketing
  // chrome (floating header + footer).
  if (user) {
    if (roleLoading || isLecturer) {
      return <div className="min-h-screen" />;
    }
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
  { value: "4", label: "Lesson formats" },
  { value: "2", label: "Assessment types" },
  { value: "24/7", label: "AI assistance" },
];

const studentPoints = [
  "Learn from structured lessons in text, video or audio",
  "Practise with module quizzes and course assessments",
  "Ask an AI tutor grounded in your actual course material",
  "Follow a personalized study path for the areas you missed",
  "Track your module and course progress as you go",
];

const lecturerPoints = [
  "Organize course materials, modules and topics in one workspace",
  "Create and manage module quizzes and course assessments",
  "Monitor the students enrolled in your course",
  "Review quiz performance and course analytics",
  "See which topics students are struggling with",
];

const platformFeatures = [
  { Icon: Layers, name: "Structured courses & materials", audience: "Students & lecturers" },
  { Icon: ClipboardList, name: "Quizzes & assessments", audience: "Students & lecturers" },
  { Icon: Brain, name: "AI-assisted learning", audience: "Students" },
  { Icon: Sparkles, name: "Personalized learning", audience: "Students" },
  { Icon: BarChart3, name: "Progress & performance analytics", audience: "Students & lecturers" },
];

const connectSteps = [
  {
    n: "01",
    t: "Lecturers build the course",
    d: "Materials, modules, topics and assessments, organized in one workspace.",
    Icon: GraduationCap,
  },
  {
    n: "02",
    t: "Students learn and practise",
    d: "Lessons in their preferred format, then module quizzes and course assessments.",
    Icon: BookOpen,
  },
  {
    n: "03",
    t: "Performance becomes insight",
    d: "Results feed progress tracking for students and analytics for lecturers.",
    Icon: BarChart3,
  },
  {
    n: "04",
    t: "Support reaches the right place",
    d: "Students get personalized study paths; lecturers see which topics need attention.",
    Icon: Target,
  },
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

  const previewCourses = (
    dbCourses?.length
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
                <Sparkles className="h-3 w-3" /> Learning · Teaching · Assessment · Insight
              </span>
              <h1 className="mt-5 text-5xl font-bold leading-[1.03] tracking-tight md:text-7xl">
                One platform for <span className="text-primary">learning</span> and{" "}
                <span className="text-primary">teaching</span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground md:text-lg lg:mx-0">
                AceTutor brings course content, quizzes, AI-assisted help and performance insights
                into one place — so students can learn and practise while lecturers manage their
                courses and see progress.
              <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
                <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
                  <Link to="/signup">
                    Get started <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-12 rounded-full px-6 text-base"
                >
                  <Link to="/login">Log in</Link>
                </Button>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Teaching a course?{" "}
                <Link
                  to="/signup"
                  search={{ role: "lecturer" }}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Sign up as a lecturer
                </Link>
              </p>

              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="mt-12 grid max-w-lg grid-cols-2 gap-6 md:grid-cols-4 lg:mx-0"
              >
                {stats.map((s) => (
                  <motion.div
                    key={s.label}
                    variants={staggerItem}
                    className="text-center lg:text-left"
                  >
                    <p className="text-3xl font-bold tracking-tight md:text-4xl">
                      <CountUpValue value={s.value} />
                    </p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      {s.label}
                    </p>
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

      {/* Both sides — students and lecturers */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="max-w-2xl"
        >
          <h2 className="text-4xl font-bold tracking-tight">Built for both sides of the course</h2>
          <p className="mt-2 text-muted-foreground">
            The same platform, seen from two angles — one for the people learning, one for the
            person running the course.
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="mt-8 grid gap-4 md:grid-cols-2"
        >
          <motion.div
            variants={staggerItem}
            className="rounded-3xl border border-border bg-card p-6 md:p-8"
          >
            <div className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <BookOpen className="h-5 w-5" />
              </span>
              <h3 className="text-xl font-semibold">For students</h3>
            </div>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              {studentPoints.map((p) => (
                <li key={p} className="flex items-start gap-2.5">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            variants={staggerItem}
            className="rounded-3xl border border-border bg-card p-6 md:p-8"
          >
            <div className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <GraduationCap className="h-5 w-5" />
              </span>
              <h3 className="text-xl font-semibold">For lecturers</h3>
            </div>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              {lecturerPoints.map((p) => (
                <li key={p} className="flex items-start gap-2.5">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>

        {/* Key platform features */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {platformFeatures.map(({ Icon, name, audience }) => (
            <motion.div
              key={name}
              variants={staggerItem}
              className="rounded-2xl border border-border/60 bg-card p-4"
            >
              <Icon className="h-5 w-5 text-primary" />
              <p className="mt-2.5 text-sm font-semibold leading-snug">{name}</p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {audience}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Feature carousel — a closer look at the student experience */}
      <FeatureCarousel />

      {/* Courses preview */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-4xl font-bold tracking-tight">
              Structured courses, ready to teach.
            </h2>
            <p className="mt-2 text-muted-foreground">
              Courses built for the BSc CS / IT curriculum — enroll to learn, or run one as a
              lecturer.
            </p>
          </div>
          <Link
            to="/courses"
            className="hidden text-sm text-muted-foreground hover:text-foreground md:inline-flex md:items-center"
          >
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

      {/* How the two sides connect */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="rounded-3xl border border-border bg-card p-8 md:p-12"
        >
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            How the two sides connect
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            One course, shared between the lecturer running it and the students taking it.
          </p>
          <motion.ol
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
          >
            {connectSteps.map(({ n, t, d, Icon }) => (
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
          <div
            aria-hidden
            className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-16 -left-6 h-44 w-44 rounded-full bg-white/10 blur-2xl"
          />
          <h2 className="relative mx-auto max-w-2xl text-3xl font-bold tracking-tight md:text-5xl">
            Bring your course together.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-sm text-primary-foreground/85 md:text-base">
            Create an account to start learning, or sign up as a lecturer to set up and run your
            course.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-white px-6 text-base text-primary hover:bg-white/90"
            >
              <Link to="/signup">
                Get started <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-white/40 bg-transparent px-6 text-base text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            >
              <Link to="/signup" search={{ role: "lecturer" }}>
                Sign up as a lecturer
              </Link>
            </Button>
          </div>
          <p className="relative mt-4 text-xs text-primary-foreground/75">
            Already have an account?{" "}
            <Link to="/login" className="font-medium underline underline-offset-4">
              Log in
            </Link>
          </p>
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
        .select("full_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      return data;
    },
  });

  const { isLecturer } = useRole();

  const { data: learningPrefs } = useQuery({
    queryKey: ["learning-preferences", userId],
    enabled: !isLecturer,
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_preferences")
        .select("explanation_style, lesson_format, wrong_answer_help")
        .eq("user_id", userId)
        .maybeSingle();
      return data;
    },
  });
  const hasPreferences = !!(
    learningPrefs?.explanation_style ||
    learningPrefs?.lesson_format ||
    learningPrefs?.wrong_answer_help
  );
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      {/* Welcome — a launch pad, not an analytics view. The numbers live on /dashboard. */}
      <motion.header variants={fadeUp} initial="hidden" animate="show">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {today}
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight md:text-4xl">
          {greetingFor(new Date())}, {firstName}.
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Pick up where you left off, or jump into something new.
        </p>
      </motion.header>

      {isLecturer ? (
        <LecturerPanels />
      ) : (
        <StudentHub userId={userId} hasPreferences={hasPreferences} />
      )}

      {!hasPreferences && !isLecturer && (
        <Link
          to="/onboarding/preferences"
          className="mt-8 flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/10 px-5 py-4 transition-colors hover:bg-primary/15"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Brain className="h-4 w-4" />
            </span>
            <span className="text-sm">
              <span className="font-medium text-foreground">Personalize your learning</span>
              <span className="block text-xs text-muted-foreground">
                Tell AceTutor how you prefer explanations and lesson formats.
              </span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}
    </div>
  );
}

/** Time-of-day greeting so the home header reads differently from the dashboard's. */
function greetingFor(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const HUB_ACTIONS = [
  { to: "/my-courses", label: "My courses", desc: "Everything you're enrolled in", Icon: BookOpen },
  {
    to: "/analytics",
    label: "Progress & analytics",
    desc: "Time, accuracy, and trends",
    Icon: BarChart3,
  },
  { to: "/games", label: "Learning games", desc: "Crosswords & word search", Icon: Gamepad2 },
  {
    to: "/dashboard",
    label: "Full dashboard",
    desc: "Your complete overview",
    Icon: LayoutDashboard,
  },
] as const;

function StudentHub({ userId, hasPreferences }: { userId: string; hasPreferences: boolean }) {
  const { continueCourse, perCourse } = useStudentDashboard(userId);

  return (
    <>
      {/* Your courses — a horizontal scroll carousel of every enrolled course. */}
      <EnrolledCoursesCarousel courses={perCourse} continueCourse={continueCourse} />

      {/* Quick actions — Home points you somewhere; the numbers and history live there. */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {HUB_ACTIONS.map(({ to, label, desc, Icon }) => (
          <motion.div key={to} variants={staggerItem} whileHover={{ y: -3 }}>
            <Link
              to={to}
              className="group flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                <Icon className="h-4 w-4" />
              </span>
              <span className="mt-3 text-sm font-semibold">{label}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{desc}</span>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {/* Brand showcase — the three poster designs, recreated as scrollable slides. */}
      <BrandShowcaseCarousel
        cta={
          hasPreferences
            ? { label: "Browse courses", to: "/courses" }
            : { label: "Set your learning preferences", to: "/onboarding/preferences" }
        }
      />
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
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your courses, review student analytics, and respond to activity.
        </p>
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

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
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
