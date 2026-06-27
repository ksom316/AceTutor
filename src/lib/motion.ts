/**
 * Shared framer-motion variants for consistent animations across the app.
 * Import these instead of redefining initial/animate objects per page.
 */
import type { Variants } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade + rise. Use on hero blocks and standalone elements. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

/** Subtle fade only. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.5, ease: EASE } },
};

/** Scale-in pop, good for badges / icons / cards. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: EASE } },
};

/**
 * Container that staggers its children. Pair with `staggerItem` on each child
 * and set `initial="hidden" animate="show"` (or `whileInView="show"`).
 */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

/** Child element for use inside `staggerContainer`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

/** Standard viewport config for scroll-triggered reveals. */
export const viewportOnce = { once: true, margin: "-60px" } as const;
