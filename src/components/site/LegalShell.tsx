import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";

export type TocItem = { id: string; label: string };

/**
 * Shared shell for the legal/doc pages (Terms, Privacy). Mirrors the dashboard
 * mockup's persistent left-sidebar layout: a sticky table-of-contents rail with
 * a scroll-spy active state sits beside the violet content cards. Header/Footer,
 * ambient glow, hero, and "last updated" footer are provided here so each page
 * only supplies its badge, heading, intro, TOC, and section content.
 */
export function LegalShell({
  badge,
  titlePlain,
  titleAccent,
  intro,
  toc,
  lastUpdated,
  children,
}: {
  badge: { icon: LucideIcon; label: string };
  titlePlain: string;
  titleAccent: string;
  intro: string;
  toc: TocItem[];
  lastUpdated: string;
  children: React.ReactNode;
}) {
  const BadgeIcon = badge.icon;
  const activeId = useScrollSpy(toc.map((t) => t.id));

  return (
    <div className="min-h-screen">
      <Header />
      <main className="relative overflow-hidden">
        {/* Ambient gradient glow */}
        <div className="absolute inset-x-0 top-0 -z-10 h-[420px] [background:radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]" />

        <div className="container mx-auto max-w-6xl px-4 pb-20 pt-10 md:pt-14">
          {/* Hero */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>

            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              <BadgeIcon className="h-3 w-3" /> {badge.label}
            </motion.span>

            <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
              {titlePlain} <span className="text-primary">{titleAccent}</span>
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground md:text-lg">{intro}</p>
          </motion.div>

          {/* Body: sticky TOC rail + content */}
          <div className="mt-12 grid gap-8 lg:grid-cols-[220px_1fr]">
            <aside className="hidden lg:block">
              <nav className="sticky top-24 rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm">
                <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  On this page
                </p>
                <ul className="space-y-0.5">
                  {toc.map((t) => {
                    const active = activeId === t.id;
                    return (
                      <li key={t.id}>
                        <a
                          href={`#${t.id}`}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                            active
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                              active ? "bg-primary" : "bg-border"
                            }`}
                          />
                          <span className="truncate">{t.label}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </aside>

            <div className="min-w-0">
              {children}

              <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="mt-12 border-t border-border/60 pt-6 text-xs text-muted-foreground"
              >
                Last updated: {lastUpdated}
              </motion.p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/** Highlights the TOC entry for the section currently in view. Client-only. */
function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-100px 0px -65% 0px", threshold: 0 },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}
