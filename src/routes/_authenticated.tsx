import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Moon, Search, Sun } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { AppSidebar } from "@/components/site/AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function TopBar() {
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground" />
      <div className="relative hidden flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search courses, topics, quizzes…"
          className="h-10 w-full max-w-md rounded-full border border-border bg-card pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
        />
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Notifications"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
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

function AuthLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading your workspace…
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <div className="relative flex w-full flex-1 flex-col bg-background">
        <TopBar />
        <div className="min-h-[calc(100svh-4rem)]">
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
}
