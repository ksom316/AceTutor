import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, CheckCheck, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { fadeUp } from "@/lib/motion";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationList } from "@/components/site/NotificationList";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const [clearOpen, setClearOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    isLoading,
    markRead,
    markAllRead,
    markingAll,
    deleteOne,
    deletingId,
    clearAll,
    clearingAll,
  } = useNotifications();

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
          <p className="text-sm text-muted-foreground">Your recent activity and updates</p>
          <h1 className="font-display text-4xl leading-tight md:text-5xl">Notifications</h1>
        </div>
      </motion.div>

      {/* Feed */}
      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">
            Recent activity
            {unreadCount > 0 && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {unreadCount} new
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              disabled={unreadCount === 0 || markingAll}
              onClick={() => markAllRead()}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" /> Mark all read
            </Button>
            <AlertDialog
              open={clearOpen}
              onOpenChange={(o) => {
                if (!clearingAll) setClearOpen(o);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-destructive hover:text-destructive"
                  disabled={notifications.length === 0 || clearingAll}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all notifications?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes all of your notifications. This can&apos;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={clearingAll}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={clearingAll}
                    onClick={(e) => {
                      e.preventDefault();
                      clearAll({ onSuccess: () => setClearOpen(false) });
                    }}
                  >
                    {clearingAll && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 w-full animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : (
          <NotificationList
            notifications={notifications}
            onOpen={markRead}
            onDelete={deleteOne}
            deletingId={deletingId}
            empty="New materials and quizzes from your lecturer will appear here."
          />
        )}
      </section>
    </main>
  );
}
