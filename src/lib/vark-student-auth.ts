/**
 * Pure, dependency-free student-role check for predictVarkMlCategory
 * (vark-inference.functions.ts). Split into its own module (no
 * @tanstack/react-start, no zod, no path aliases) specifically so it can be
 * unit tested with Node's built-in test runner without pulling in the
 * server-function/runtime machinery — see vark-inference.functions.test.ts.
 *
 * Strictly role === "student" — not the broader client-side "not a claimed
 * lecturer" convention (use-role.ts / post-auth-redirect.ts), which would
 * also let an admin or an unclaimed teacher through. A failed query, a
 * missing row, or any role other than exactly "student" is rejected; never
 * assume "student" as a default the way the client UI does.
 */
export function isAuthorizedStudent(roleRes: {
  data: { role: string } | null;
  error: unknown;
}): boolean {
  return !roleRes.error && roleRes.data?.role === "student";
}
