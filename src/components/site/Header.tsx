import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { AppNavSheet } from "@/components/site/AppNavSheet";
import logoAsset from "@/assets/ace-logo.jpg";

export function Header() {
  const { user, loading } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-4 z-40 px-4"
    >
      <div className="container mx-auto max-w-6xl">
        <div className="flex h-14 items-center justify-between rounded-full border border-border bg-background/80 px-3 shadow-sm backdrop-blur-xl transition-shadow hover:shadow-md supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-2">
            {user && <AppNavSheet user={user} />}
            <Link to="/" className="group flex items-center gap-2 pl-1">
              <img
                src={logoAsset}
                alt="AceTutor"
                width={32}
                height={32}
                className="rounded-lg object-contain transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
              />
              <span className="text-base font-bold tracking-tight transition-colors group-hover:text-primary">
                AceTutor
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-1.5">
            {user && (
              <button
                type="button"
                onClick={toggle}
                aria-label="Toggle theme"
                className="grid h-9 w-9 place-items-center overflow-hidden rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={theme}
                    initial={{ y: -16, opacity: 0, rotate: -90 }}
                    animate={{ y: 0, opacity: 1, rotate: 0 }}
                    exit={{ y: 16, opacity: 0, rotate: 90 }}
                    transition={{ duration: 0.2 }}
                  >
                    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </motion.span>
                </AnimatePresence>
              </button>
            )}
            {!loading && !user && (
              <>
                <Button asChild variant="ghost" size="sm" className="rounded-full">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild size="sm" className="rounded-full px-4">
                  <Link to="/signup">Sign up</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  );
}
