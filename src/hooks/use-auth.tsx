import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Single, app-wide auth source of truth. Mounted once at the root so the
 * Supabase session is resolved a single time for the whole app. Navigating
 * between routes no longer remounts a fresh auth hook (which would flash
 * `loading: true` / `user: null`), so the `_authenticated` guard never sees a
 * transient "signed out" state and never bounces a logged-in user to /login.
 *
 * Session durability: a `SIGNED_OUT` event is NOT always a real logout — it can
 * also be fired when a background token refresh hiccups (network blip, or a
 * race between auto-refresh and the per-RPC refresh in auth-attacher.ts). When
 * we still hold a session, we try to recover with `refreshSession()` before
 * clearing the user, and we keep the user signed in on transient/network errors
 * (only a real invalid-token error logs out). This stops the app from kicking
 * an already-logged-in user to the login page after the ~1h token expiry.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Whether we currently believe a session exists (read inside async callbacks
  // without re-subscribing the listener).
  const hasSessionRef = useRef(false);

  useEffect(() => {
    let active = true;

    const apply = (s: Session | null) => {
      if (!active) return;
      setSession(s);
      setUser(s?.user ?? null);
      hasSessionRef.current = !!s;
      setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;

      // Any event that carries a session is authoritative — apply it.
      if (s) {
        apply(s);
        return;
      }

      // Null session on SIGNED_OUT: distinguish a real logout from a failed
      // refresh. If we never had a session, it's just the unauthenticated
      // baseline. If we did, attempt to recover before clearing.
      if (event === "SIGNED_OUT" && hasSessionRef.current) {
        // Defer the supabase call out of the callback to avoid the auth-lock
        // deadlock the SDK warns about.
        setTimeout(async () => {
          if (!active) return;
          try {
            const { data, error } = await supabase.auth.refreshSession();
            if (!active) return;
            if (data.session) {
              apply(data.session); // recovered — stay signed in
            } else if (error && (error.status === 400 || error.status === 401)) {
              apply(null); // genuinely signed out / refresh token invalid
            }
            // else: transient/network error — keep the current user; supabase
            // (and the next focus/online event) will retry.
          } catch {
            // Network error — keep the user signed in; do not bounce to login.
          }
        }, 0);
        return;
      }

      apply(null);
    });

    // Read the persisted session on mount. Don't let a (possibly slower) null
    // result clobber a live session that an auth event already delivered.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (data.session || !hasSessionRef.current) apply(data.session);
        else setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Rendered outside the provider — treat as "still resolving" rather than
    // throwing, so a stray consumer never crashes the tree.
    return { session: null, user: null, loading: true };
  }
  return ctx;
}
