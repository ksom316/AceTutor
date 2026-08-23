import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bell, BookOpen, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

type PrefKey = "courseReminders" | "newLessons" | "quizResults" | "liveClasses" | "productUpdates";

type Pref = { key: PrefKey; title: string; description: string };

const PREFS: Pref[] = [
  {
    key: "courseReminders",
    title: "Course reminders",
    description: "Nudges to keep your learning streak going.",
  },
  {
    key: "newLessons",
    title: "New lessons",
    description: "When new lessons are added to a course you're taking.",
  },
  {
    key: "quizResults",
    title: "Quiz results",
    description: "A summary each time you finish a quiz.",
  },
  {
    key: "liveClasses",
    title: "Live classes",
    description: "Reminders before a live class you've joined.",
  },
  {
    key: "productUpdates",
    title: "Product updates",
    description: "Occasional news about new AceTutor features.",
  },
];

const DEFAULTS: Record<PrefKey, boolean> = {
  courseReminders: true,
  newLessons: true,
  quizResults: true,
  liveClasses: true,
  productUpdates: false,
};

const storageKey = (userId: string) => `acetutor:notif-prefs:${userId}`;

function NotificationsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>(DEFAULTS);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, kind, title, message, created_at, read_at, courses(title, slug)")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Preferences are stored locally per user (no schema change required).
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(storageKey(user.id));
      if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
      else setPrefs(DEFAULTS);
    } catch {
      setPrefs(DEFAULTS);
    }
  }, [user]);

  const toggle = (key: PrefKey) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (user) {
        try {
          localStorage.setItem(storageKey(user.id), JSON.stringify(next));
        } catch {
          /* ignore storage failures */
        }
      }
      toast.success(`${PREFS.find((p) => p.key === key)?.title} ${next[key] ? "on" : "off"}`);
      return next;
    });
  };

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      {/* Header */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="flex items-center gap-3"
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Bell className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm text-muted-foreground">Choose what AceTutor can notify you about</p>
          <h1 className="font-display text-4xl leading-tight md:text-5xl">Notifications</h1>
        </div>
      </motion.div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mt-8 overflow-hidden rounded-2xl border border-border bg-card"
      >
        {PREFS.map((p) => (
          <motion.label
            key={p.key}
            variants={staggerItem}
            htmlFor={`notif-${p.key}`}
            className="flex cursor-pointer items-center gap-4 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-secondary/40"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{p.title}</p>
              <p className="text-xs text-muted-foreground">{p.description}</p>
            </div>
            <Switch
              id={`notif-${p.key}`}
              checked={prefs[p.key]}
              onCheckedChange={() => toggle(p.key)}
            />
          </motion.label>
        ))}
      </motion.div>

      <section className="mt-8">
        <h2 className="font-display text-2xl">From your teachers</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          {notifications.length > 0 ? notifications.map((notification) => {
            const course = Array.isArray(notification.courses) ? notification.courses[0] : notification.courses;
            const Icon = notification.kind === "quiz" ? ClipboardList : BookOpen;
            return (
              <div key={notification.id} className={`flex gap-3 border-b border-border p-4 last:border-b-0 ${notification.read_at ? "" : "bg-primary/5"}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{notification.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{notification.message}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{new Date(notification.created_at).toLocaleString()}</p>
                </div>
                {course?.slug && <Link to="/courses/$slug" params={{ slug: course.slug }} className="self-center text-xs font-semibold text-primary hover:underline">Open course</Link>}
              </div>
            );
          }) : <p className="p-5 text-sm text-muted-foreground">New notes and quizzes from your teachers will appear here.</p>}
        </div>
      </section>

      <p className="mt-4 px-1 text-xs text-muted-foreground">
        These preferences are saved on this device.
      </p>
    </main>
  );
}
