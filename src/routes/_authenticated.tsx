import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { AppShell } from "@/components/site/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { user, loading } = useAuth();
  const { isLecturer, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const redirectedRef = useRef(false);

  useEffect(() => {
    // Skip while auth is still hydrating
    if (loading) return;
    // User is confirmed signed in
    if (user) {
      redirectedRef.current = false;
      // A claimed lecturer never belongs in the student workspace.
      if (!roleLoading && isLecturer) {
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
  }, [user, loading, roleLoading, isLecturer, navigate]);

  // Wait for both auth and role before showing the student shell, so a lecturer
  // never sees a flash of the student interface before the redirect.
  if (loading || !user || roleLoading || isLecturer) {
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
