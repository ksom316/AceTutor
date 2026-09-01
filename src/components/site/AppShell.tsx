import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Bell, Moon, Sun } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useTheme } from "@/hooks/use-theme";
import { AppSidebar } from "@/components/site/AppSidebar";
import { SearchBar } from "@/components/site/SearchBar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ActiveQuizBanner } from "@/components/course/ActiveQuizBanner";
import { useNotifications } from "@/hooks/use-notifications";

function TopBar() {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const { unreadCount } = useNotifications();
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => router.history.back()}
        aria-label="Go back"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <SidebarTrigger className="text-muted-foreground" />
      <SearchBar />
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
          onClick={() => router.navigate({ to: "/notifications" })}
          className="relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
          className="grid h-9 w-9 place-items-center overflow-hidden rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ y: -16, opacity: 0, rotate: -90 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: 16, opacity: 0, rotate: 90 }}
              transition={{ duration: 0.2 }}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </header>
  );
}

/**
 * The persistent sidebar + top-bar shell for signed-in surfaces. Used by both
 * the `_authenticated` workspace routes and the logged-in home page so every
 * signed-in view shares one navigation.
 */
export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <div className="relative flex w-full flex-1 flex-col bg-background">
        <TopBar />
        <ActiveQuizBanner />
        <div className="min-h-[calc(100svh-4rem)]">{children}</div>
      </div>
    </SidebarProvider>
  );
}
