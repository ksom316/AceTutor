import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Pencil,
  Trophy,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type AppNotification, notificationTarget } from "@/hooks/use-notifications";

const KIND_ICON: Record<string, typeof Bell> = {
  material: BookOpen,
  module_quiz: ClipboardList,
  general_quiz: GraduationCap,
  material_updated: Pencil,
  module_updated: Pencil,
  quiz_updated: Pencil,
  note: BookOpen,
  quiz: ClipboardList,
  enrollment: UserPlus,
  quiz_completed: CheckCircle2,
  module_completed: Trophy,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function RowInner({ n }: { n: AppNotification }) {
  const Icon = KIND_ICON[n.kind] ?? Bell;
  return (
    <>
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
          n.read_at ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{n.title}</p>
          {!n.read_at && (
            <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{n.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {n.course?.title ? `${n.course.title} · ` : ""}
          {relativeTime(n.created_at)}
        </p>
      </div>
    </>
  );
}

function Row({ n, onOpen }: { n: AppNotification; onOpen: (id: string) => void }) {
  const target = notificationTarget(n);
  const base = cn(
    "flex gap-3 border-b border-border p-4 text-left last:border-b-0",
    !n.read_at && "bg-primary/5",
  );
  const linkCls = cn(base, "transition-colors hover:bg-secondary/50");
  const handle = () => onOpen(n.id);
  const inner = <RowInner n={n} />;

  if (!target) {
    return (
      <button type="button" onClick={handle} className={cn(base, "w-full")}>
        {inner}
      </button>
    );
  }

  switch (target.kind) {
    case "topic":
      return (
        <Link
          to="/topic/$topicId"
          params={{ topicId: target.topicId }}
          onClick={handle}
          className={linkCls}
        >
          {inner}
        </Link>
      );
    case "course-quiz":
      return (
        <Link
          to="/course-quiz/$quizId"
          params={{ quizId: target.quizId }}
          onClick={handle}
          className={linkCls}
        >
          {inner}
        </Link>
      );
    case "course":
      return (
        <Link
          to="/courses/$slug"
          params={{ slug: target.slug }}
          onClick={handle}
          className={linkCls}
        >
          {inner}
        </Link>
      );
    case "lecturer-students":
      return (
        <Link to="/lecturer/students" onClick={handle} className={linkCls}>
          {inner}
        </Link>
      );
    case "lecturer-performance":
      return (
        <Link to="/lecturer/performance" onClick={handle} className={linkCls}>
          {inner}
        </Link>
      );
  }
}

/**
 * Shared notification feed used by the student and lecturer notification pages.
 * Clicking a row marks it read (via `onOpen`) and navigates to the relevant
 * page; rows with no navigable target still mark read on click.
 */
export function NotificationList({
  notifications,
  onOpen,
  empty,
}: {
  notifications: AppNotification[];
  onOpen: (id: string) => void;
  empty: ReactNode;
}) {
  if (notifications.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {notifications.map((n) => (
        <Row key={n.id} n={n} onOpen={onOpen} />
      ))}
    </div>
  );
}
