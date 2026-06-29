import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import logoAsset from "@/assets/ace-logo.jpg";

const EASE = [0.22, 1, 0.36, 1] as const;
const DURATION_MS = 2000;

/**
 * Full-screen branded splash shown on first load of a browser session.
 * Renders the ACE brain logo inside an animated orbital ring with the
 * "Learn · Think · Achieve" tagline, then fades away.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Only show once per browser session — reloads within the tab skip it.
    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem("ace-splash-seen") === "1";
    } catch {
      alreadySeen = false;
    }
    if (alreadySeen) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(false);
      try {
        sessionStorage.setItem("ace-splash-seen", "1");
      } catch {
        /* storage unavailable — splash will simply show again next load */
      }
    }, DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="ace-splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: EASE } }}
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#0a0e24]"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 38%, #131a3f 0%, #0a0e24 60%, #070a1c 100%)",
          }}
          aria-hidden="true"
        >
          {/* Ambient glows */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(34,211,238,0.18), transparent 70%)" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(168,85,247,0.20), transparent 70%)" }}
          />

          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.14, delayChildren: 0.1 } } }}
            className="relative flex flex-col items-center px-6 text-center"
          >
            {/* Logo + orbital ring */}
            <motion.div
              variants={{
                hidden: { opacity: 0, scale: 0.82 },
                show: { opacity: 1, scale: 1, transition: { duration: 0.7, ease: EASE } },
              }}
              className="relative grid h-44 w-44 place-items-center sm:h-52 sm:w-52"
            >
              {/* Rotating gradient swoosh ring */}
              <motion.svg
                viewBox="0 0 200 200"
                className="absolute inset-0 h-full w-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
              >
                <defs>
                  <linearGradient id="ace-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#22d3ee" />
                    <stop offset="55%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#a855f7" />
                  </linearGradient>
                </defs>
                <circle
                  cx="100"
                  cy="100"
                  r="92"
                  fill="none"
                  stroke="url(#ace-ring)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray="150 139"
                  opacity={0.9}
                />
              </motion.svg>

              {/* Pulsing halo behind the logo */}
              <motion.span
                aria-hidden
                className="absolute h-28 w-28 rounded-3xl blur-2xl sm:h-32 sm:w-32"
                style={{ background: "linear-gradient(135deg, #22d3ee, #a855f7)" }}
                animate={{ opacity: [0.35, 0.6, 0.35], scale: [0.95, 1.05, 0.95] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />

              <img
                src={logoAsset}
                alt="AceTutor"
                width={120}
                height={120}
                className="relative h-28 w-28 rounded-3xl object-contain shadow-2xl sm:h-32 sm:w-32"
              />
            </motion.div>

            {/* Wordmark */}
            <motion.h1
              variants={{
                hidden: { opacity: 0, y: 14 },
                show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
              }}
              className="mt-8 text-3xl font-bold tracking-tight text-white sm:text-4xl"
            >
              Ace
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                Tutor
              </span>
            </motion.h1>

            {/* Tagline with accent lines */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 10 },
                show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
              }}
              className="mt-3 flex items-center gap-3"
            >
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-cyan-400 sm:w-12" />
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/70 sm:text-sm">
                Learn · Think · Achieve
              </p>
              <span className="h-px w-8 bg-gradient-to-l from-transparent to-violet-400 sm:w-12" />
            </motion.div>

            {/* Loading bar */}
            <motion.div
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { duration: 0.4 } },
              }}
              className="mt-10 h-0.5 w-40 overflow-hidden rounded-full bg-white/10"
            >
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-violet-500"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: (DURATION_MS - 200) / 1000, ease: EASE }}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
