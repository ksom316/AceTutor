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
 * Single, app-wide auth source of truth. Token refresh is left to Supabase's
 * auto-refresh plus the guarded serverFn middleware. Avoid calling
 * refreshSession() from auth-state listeners because that can stampede
 * /auth/v1/token and trigger 429 rate limits.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      apply(nextSession);
    });

    // Read the persisted session on mount. Don't let a slower null result
    // clobber a live session that an auth event already delivered.
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

  return <AuthContext.Provider value={{ session, user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return { session: null, user: null, loading: true };
  }
  return ctx;
}
