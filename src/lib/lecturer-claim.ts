import { supabase } from "@/integrations/supabase/client";

/**
 * Helpers for turning a signed-in account into a lecturer by claiming a
 * pre-assigned Lecturer ID.
 *
 * The database function `claim_lecturer_slot` is the sole authority — it
 * validates the ID, row-locks the slot, binds the account to the slot's fixed
 * course and grants the internal `teacher` role. Nothing here decides the role
 * or the course; the only thing kept client-side is the raw Lecturer ID string
 * (in sessionStorage, never localStorage) so the claim can resume after email
 * confirmation. That string on its own grants nothing.
 */

const PENDING_KEY = "acetutor:pending-lecturer-id";

/** Remember a Lecturer ID entered during signup so the claim can finish once a
 *  session exists (e.g. after email confirmation, on the next sign-in). */
export function stashPendingLecturerId(id: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, id.trim());
  } catch {
    /* private mode / storage disabled — the claim just can't auto-resume */
  }
}

export function hasPendingLecturerId(): boolean {
  try {
    return !!sessionStorage.getItem(PENDING_KEY);
  } catch {
    return false;
  }
}

function takePendingLecturerId(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_KEY);
    if (value) sessionStorage.removeItem(PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}

export type ClaimResult =
  | { status: "claimed" }
  | { status: "failed"; message: string }
  | { status: "none" };

/** Claim `id` for the current session. Used by the immediate signup path. */
export async function claimLecturerSlot(id: string): Promise<ClaimResult> {
  const { error } = await supabase.rpc("claim_lecturer_slot", { _lecturer_id: id.trim() });
  if (error) return { status: "failed", message: error.message };
  return { status: "claimed" };
}

/** If a Lecturer ID is pending and the caller is authenticated, run the claim.
 *  Safe to call unconditionally after any sign-in. */
export async function finishPendingLecturerClaim(): Promise<ClaimResult> {
  const id = takePendingLecturerId();
  if (!id) return { status: "none" };
  return claimLecturerSlot(id);
}
