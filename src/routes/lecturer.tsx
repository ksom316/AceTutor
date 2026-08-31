import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
} from "lucide-react";
import logoAsset from "@/assets/ace-logo.jpg";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRole } from "@/hooks/use-role";
import { finishPendingLecturerClaim, hasPendingLecturerId } from "@/lib/lecturer-claim";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lecturer")({
  component: LecturerLayout,
});

const LECTURER_NAV = [
  { to: "/lecturer", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/lecturer/students", label: "Students", icon: Users, exact: false },
  { to: "/lecturer/materials", label: "Materials", icon: BookOpen, exact: false },
  { to: "/lecturer/quizzes", label: "Quizzes", icon: ClipboardList, exact: false },
  { to: "/lecturer/performance", label: "Performance", icon: BarChart3, exact: false },
] as const;

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading your workspace…
      </div>
    </div>
  );
}

/**
 * Layout + guard for /lecturer/*. Route protection here is UX only — the real
 * boundary is RLS + the SECURITY DEFINER functions. The guard decides purely
 * from the database-backed role (useRole), never from the URL, and waits for
 * both auth and role to settle before redirecting to avoid loops / flashes.
 */
function LecturerLayout() {
  const { user, loading: authLoading } = useAuth();
  const { isLecturer, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();
  const claimingRef = useRef(false);
  const isMobile = useIsMobile();
  // The left navigation sidebar. Visible by default; collapsible with the
  // header button. On desktop it occupies space beside the content; on mobile
  // it is an off-canvas drawer (no dark overlay either way).
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Default to open on desktop, closed on mobile — re-evaluated when the
  // viewport crosses the breakpoint.
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // On mobile the sidebar is a drawer, so close it after navigating.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [pathname, isMobile]);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      navigate({ to: "/login", search: { redirect: window.location.pathname } });
      return;
    }

    if (roleLoading || isLecturer) return;

    // Signed in but not (yet) a lecturer. Finish a pending Lecturer-ID claim
    // from signup if there is one; otherwise this is a student — send them home.
    if (claimingRef.current) return;
    claimingRef.current = true;
    let cancelled = false;

    (async () => {
      if (hasPendingLecturerId()) {
        const result = await finishPendingLecturerClaim();
        if (cancelled) return;
        if (result.status === "claimed") {
          await qc.invalidateQueries({ queryKey: ["user-role"] });
          claimingRef.current = false;
          return; // useRole refetch flips isLecturer -> the guard lets us stay
        }
      }
      if (!cancelled) navigate({ to: "/dashboard" });
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, roleLoading, user, isLecturer, navigate, qc]);

  if (authLoading || roleLoading || !user || !isLecturer) {
    return <LoadingScreen />;
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const isActive = (to: string, exact: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  const activeItem = LECTURER_NAV.find((item) => isActive(item.to, item.exact));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="flex h-16">
          {/* Toggle lives in the sidebar's own column so it clearly controls it:
              when expanded it caps the sidebar (same width + border); when
              collapsed it stays flush with the collapsed sidebar's left edge. */}
          <div
            className={cn(
              "flex shrink-0 items-center px-3 transition-[width] duration-200 ease-out",
              sidebarOpen ? "md:w-60 md:border-r md:border-border" : "md:w-[3.75rem]",
            )}
          >
            <button
              type="button"
              aria-label={sidebarOpen ? "Collapse navigation sidebar" : "Expand navigation sidebar"}
              aria-expanded={sidebarOpen}
              aria-controls="lecturer-sidebar"
              onClick={() => setSidebarOpen((o) => !o)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
            <Link to="/lecturer" className="flex shrink-0 items-center gap-2">
              <img
                src={logoAsset}
                alt="AceTutor"
                width={30}
                height={30}
                className="rounded-lg object-contain shadow-sm"
              />
              <span className="text-sm font-bold tracking-tight">AceTutor</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · Lecturer workspace
              </span>
            </Link>

            {activeItem && (
              <span className="hidden min-w-0 items-center gap-1.5 truncate text-sm font-medium text-foreground md:flex">
                <span aria-hidden className="text-muted-foreground">
                  /
                </span>
                <activeItem.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{activeItem.label}</span>
              </span>
            )}

            <button
              type="button"
              onClick={signOut}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Left navigation sidebar. Desktop: sits in the flow and takes space
            beside the content. Mobile: an off-canvas drawer that slides over the
            content. No dark overlay in either mode. */}
        <aside
          id="lecturer-sidebar"
          aria-label="Lecturer navigation"
          className={cn(
            "z-20 shrink-0 border-r border-border bg-background",
            "fixed inset-y-0 left-0 top-16 w-60 -translate-x-full transition-transform duration-200 ease-out",
            sidebarOpen && "translate-x-0",
            "md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:translate-x-0 md:overflow-hidden md:transition-[width]",
            sidebarOpen ? "md:w-60" : "md:w-0 md:border-r-0",
          )}
        >
          <nav className="flex w-60 flex-col gap-1 p-3">
            {LECTURER_NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to, item.exact);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => {
                    if (isMobile) setSidebarOpen(false);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
