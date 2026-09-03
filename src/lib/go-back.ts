import { scrollRestorationCache } from "@tanstack/router-core";

/**
 * Go back to the previous page, landing at the top of it.
 *
 * The router runs with `scrollRestoration: true`, which snapshots each page's
 * scroll offset and restores it on history navigation. The signed-out back
 * buttons want the opposite: arrive at the top of the previous page. The
 * snapshots live in the router-core module-level cache (sessionStorage is only
 * its persistence layer), so clear that in-memory state before navigating —
 * with nothing to restore, the router falls back to scrolling to 0,0. Falls
 * back to home when the page was opened directly (no in-app history).
 */
export function goBackToTop() {
  scrollRestorationCache?.set(() => ({}));
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/");
}
