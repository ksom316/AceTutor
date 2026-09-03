import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/site/AppShell";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";

/**
 * Chrome for pages reachable both signed-in and signed-out (e.g. the course
 * catalog and course detail). Signed-in users get the same sidebar shell as the
 * dashboard/workspace so navigation is consistent everywhere; visitors keep the
 * marketing header + footer. Pages provide their own `<main>` inside.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (user) {
    return <AppShell user={user}>{children}</AppShell>;
  }

  return (
    <div className="min-h-screen">
      <Header />
      {children}
      <Footer />
    </div>
  );
}
