import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { fadeUp } from "@/lib/motion";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationList } from "@/components/site/NotificationList";

export const Route = createFileRoute("/lecturer/notifications")({
  component: LecturerNotifications,
});

function LecturerNotifications() {
  const { lecturerCourseId } = useRole();
  const { notifications, unreadCount, isLoading, isError, markRead, markAllRead, markingAll } =
    useNotifications();

  const courseQuery = useQuery({
    queryKey: ["lecturer-course", lecturerCourseId],
    enabled: !!lecturerCourseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("title, summary")
        .eq("id", lecturerCourseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-4xl px-4 py-10"
    >
      <h1 className="font-display text-4xl">Notifications</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Recent activity for{" "}
        <span className="font-medium text-foreground">
          {courseQuery.data?.title ?? "your assigned course"}
        </span>{" "}
        — new enrollments, quiz completions and module completions.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          disabled={unreadCount === 0 || markingAll}
          onClick={() => markAllRead()}
        >
          <CheckCheck className="mr-1.5 h-4 w-4" /> Mark all read
        </Button>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 w-full animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
            <h2 className="font-display text-xl">Couldn&apos;t load notifications</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <NotificationList
            notifications={notifications}
            onOpen={markRead}
            empty="Enrollments and quiz activity for your course will appear here."
          />
        )}
      </div>
    </motion.main>
  );
}
