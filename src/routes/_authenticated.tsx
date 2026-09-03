import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { AppShell } from "@/components/site/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

/**
 * Account / info pages that belong to every signed-in user, not just students,
 * and that a claimed lecturer reaches from their own sidebar (Profile / Settings
 * / Contact). Every other `_authenticated` route still bounces a lecturer to
 * their workspace.
 *
 * `/contact` is its own public route (not an `_authenticated` child), but it
 * MUST be listed: when this layout is mounted (lecturer on Profile/Settings) and
 * the router's `location.pathname` transitions to `/contact`, the redirect
 * effect below would otherwise fire once and send the lecturer to `/lecturer`
 * before the `/contact` route can take over — the "Contact opens Dashboard on
 * the first click" bug. RLS remains the real boundary.
 */
const LECTURER_SHARED_PATHS = new Set(["/profile", "/settings", "/security", "/about", "/contact"]);

function AuthLayout() {
  const { user, loading } = useAuth();
  const { isLecturer, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const redirectedRef = useRef(false);

  // A lecturer may sit on a shared account page; anywhere else in the student
  // workspace, redirect them to /lecturer.
  const lecturerMustLeave = isLecturer && !LECTURER_SHARED_PATHS.has(pathname);

  useEffect(() => {
    // Skip while auth is still hydrating
    if (loading) return;
    // User is confirmed signed in
    if (user) {
      redirectedRef.current = false;
      // A claimed lecturer never belongs in the student workspace — except on
      // the shared account pages (Profile / Settings / …).
      if (!roleLoading && lecturerMustLeave) {
        navigate({ to: "/lecturer" });
      }
      return;
    }

    // loading=false, user=null — the React context may not have caught
    // up yet (SSR hydration race).  Check Supabase directly to be
    // certain the user is genuinely unauthenticated before redirecting.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) return; // context will update on next auth event
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      const from = window.location.pathname + window.location.search;
      navigate({ to: "/login", search: { redirect: from } });
    });
  }, [user, loading, roleLoading, lecturerMustLeave, navigate]);

  // Wait for both auth and role before showing the shell, so a lecturer never
  // sees a flash of the student interface before the redirect. On a shared
  // account page a lecturer is allowed through (AppShell renders their sidebar).
  if (loading || !user || roleLoading || lecturerMustLeave) {
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
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
