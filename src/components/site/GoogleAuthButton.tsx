import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/site/GoogleIcon";

/**
 * "Continue with Google" button shared by the sign-in and sign-up pages.
 * Opens the in-app Google account chooser (/auth/google), which mirrors
 * Google's OAuth picker: demo accounts sign in/up directly, and "Use another
 * account" runs the real Google OAuth flow. Either way /auth/callback then runs
 * the shared post-auth router. An explicit `redirect` (a deep link) is carried
 * through; with none, the callback decides the destination by role/preferences.
 */
export function GoogleAuthButton({
  label = "Continue with Google",
  redirect,
}: {
  /** Button text, e.g. "Sign up with Google" / "Sign in with Google". */
  label?: string;
  /** Optional in-app deep-link path to land on after the Google round-trip. */
  redirect?: string;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const start = () => {
    if (loading) return; // guard against double-clicks during navigation
    setLoading(true);
    navigate({ to: "/auth/google", search: redirect ? { redirect } : {} });
  };

  return (
    <Button
      variant="outline"
      onClick={start}
      disabled={loading}
      className="w-full rounded-xl h-11 gap-2"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening Google…
        </>
      ) : (
        <>
          <GoogleIcon className="h-4 w-4" />
          {label}
        </>
      )}
    </Button>
  );
}
