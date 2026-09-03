import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Loader2,
  Pencil,
  Trash2,
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

/** The row's own clickable area — mark-read + navigate. Kept separate from the
 *  delete button below so the two are flex siblings, never nested interactive
 *  elements. */
function RowContent({ n, onOpen }: { n: AppNotification; onOpen: (id: string) => void }) {
  const target = notificationTarget(n);
  const base = "flex min-w-0 flex-1 gap-3 p-4 text-left";
  const cls = cn(base, "transition-colors hover:bg-secondary/50");
  const handle = () => onOpen(n.id);
  const inner = <RowInner n={n} />;

  if (!target) {
    return (
      <button type="button" onClick={handle} className={base}>
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
          className={cls}
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
          className={cls}
        >
          {inner}
        </Link>
      );
    case "course":
      return (
        <Link to="/courses/$slug" params={{ slug: target.slug }} onClick={handle} className={cls}>
          {inner}
        </Link>
      );
    case "lecturer-students":
      return (
        <Link to="/lecturer/students" onClick={handle} className={cls}>
          {inner}
        </Link>
      );
    case "lecturer-performance":
      return (
        <Link to="/lecturer/performance" onClick={handle} className={cls}>
          {inner}
        </Link>
      );
  }
}

function Row({
  n,
  onOpen,
  onDelete,
  deleting,
}: {
  n: AppNotification;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-stretch border-b border-border last:border-b-0",
        !n.read_at && "bg-primary/5",
      )}
    >
      <RowContent n={n} onOpen={onOpen} />
      <button
        type="button"
        aria-label="Delete notification"
        title="Delete notification"
        disabled={deleting}
        onClick={(e) => {
          // The row's own Link/button is a flex sibling, not an ancestor, so
          // this click can never trigger onOpen/navigation on its own — the
          // stop is just an extra guard in case the row markup ever nests.
          e.stopPropagation();
          onDelete(n.id);
        }}
        className="m-1 flex shrink-0 items-center rounded-md px-2 text-muted-foreground/50 transition-colors hover:text-destructive focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

/**
 * Shared notification feed used by the student and lecturer notification pages.
 * Clicking a row marks it read (via `onOpen`) and navigates to the relevant
 * page; rows with no navigable target still mark read on click. Each row also
 * has a delete control (`onDelete`) that deletes without marking read or
 * navigating; `deletingId` is the row currently being deleted.
 */
export function NotificationList({
  notifications,
  onOpen,
  onDelete,
  deletingId,
  empty,
}: {
  notifications: AppNotification[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId?: string | null;
  empty: ReactNode;
}) {
  if (notifications.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {notifications.map((n) => (
        <Row key={n.id} n={n} onOpen={onOpen} onDelete={onDelete} deleting={deletingId === n.id} />
      ))}
    </div>
  );
}
