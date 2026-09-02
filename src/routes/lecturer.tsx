import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { AppShell } from "@/components/site/AppShell";
import { finishPendingLecturerClaim, hasPendingLecturerId } from "@/lib/lecturer-claim";

export const Route = createFileRoute("/lecturer")({
  component: LecturerLayout,
});

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
 * Layout + guard for /lecturer/*. The chrome — collapsible sidebar, top bar,
 * back button, search, theme toggle, notifications — is the shared `AppShell`,
 * exactly what the student workspace renders; `AppSidebar` inside it switches to
 * the lecturer navigation from `useRole()`. Route protection here is UX only —
 * RLS + the SECURITY DEFINER functions are the real boundary. The guard decides
 * purely from the database-backed role (useRole), never from the URL, and waits
 * for both auth and role to settle before redirecting to avoid loops / flashes.
 */
function LecturerLayout() {
  const { user, loading: authLoading } = useAuth();
  const { isLecturer, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const claimingRef = useRef(false);

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

  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
