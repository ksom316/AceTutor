// Zero-dependency Node ESM loader hook so `node --test` can run a .ts file
// that (transitively) uses this project's "@/" path alias (which Vite/tsc
// already resolve for the real app — this only teaches plain `node --test`
// the same mapping, purely for standalone unit tests of pure src/lib
// helpers). Not used by the app itself; dev/test tooling only.
//
// Usage: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test <file>
import { register } from "node:module";

register("./node-test-alias-loader.mjs", import.meta.url);

// Everything below runs in the loader thread.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_ROOT = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

  const rest = specifier.slice(2); // "lib/mastery" etc.
  const base = new URL(rest, SRC_ROOT);
  const candidates = [base, new URL(rest + ".ts", SRC_ROOT), new URL(rest + ".tsx", SRC_ROOT)];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
    }
  }
  // No match — fall through so Node raises its normal, clear error.
  return nextResolve(specifier, context);
}
