import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { LogOut } from "lucide-react";
import logoAsset from "@/assets/ace-logo.jpg";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
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
 * Layout + guard for /lecturer/*. Route protection here is UX only — the real
 * boundary is RLS + the SECURITY DEFINER functions. The guard decides purely
 * from the database-backed role (useRole), never from the URL, and waits for
 * role resolution before redirecting to avoid loops / flashes.
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
      navigate({ to: "/login", search: { redirect: "/lecturer" } });
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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl">
        <Link to="/lecturer" className="flex items-center gap-2">
          <img
            src={logoAsset}
            alt="AceTutor"
            width={30}
            height={30}
            className="rounded-lg object-contain shadow-sm"
          />
          <span className="text-sm font-bold tracking-tight">AceTutor</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">· Lecturer workspace</span>
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </header>
      <Outlet />
    </div>
  );
}
