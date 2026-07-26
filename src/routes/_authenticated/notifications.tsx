import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";

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

      <p className="mt-4 px-1 text-xs text-muted-foreground">
        These preferences are saved on this device.
      </p>
    </main>
  );
}
