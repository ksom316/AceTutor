import { supabase } from "@/integrations/supabase/client";
import { friendlyClaimError } from "@/lib/cross-role-auth";

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

/** Read the pending Lecturer ID without consuming it. */
export function peekPendingLecturerId(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
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
  // The DB is the sole authority: it refuses to overwrite an established
  // student account's role and raises `ROLE_CONFLICT_STUDENT:` — surface that
  // as a clear, non-technical message.
  if (error) return { status: "failed", message: friendlyClaimError(error.message) };
  return { status: "claimed" };
}

/** If a Lecturer ID is pending and the caller is authenticated, run the claim.
 *  Safe to call unconditionally after any sign-in. */
export async function finishPendingLecturerClaim(): Promise<ClaimResult> {
  const id = takePendingLecturerId();
  if (!id) return { status: "none" };
  return claimLecturerSlot(id);
}

/**
 * Login-time verification for the "Lecturer" sign-in option. The Lecturer ID
 * typed at login is not proof of anything on its own — this runs AFTER
 * `signInWithPassword` and confirms the *authenticated* user genuinely owns the
 * slot for that ID:
 *
 *  - `lecturer_slots` is read under RLS (`lecturer_slots_select_own`), so a row
 *    is returned only when `enteredId` is a slot whose `claimed_by = auth.uid()`.
 *    Any other ID — someone else's, or one that does not exist — produces the
 *    same empty result, so nothing about other lecturers is revealed.
 *  - `claimed_by` is additionally checked against the authenticated user id.
 *  - the account must also hold the internal `teacher` role.
 *
 * A claim left pending by lecturer *signup* (email-confirmation path) is
 * finished first, but only when the pending ID matches what the user typed, so
 * a first sign-in still verifies. `claim_lecturer_slot` is never invoked for an
 * arbitrary typed ID, so a student cannot acquire a slot from the login page.
 */
export async function verifyLecturerLogin(userId: string, enteredId: string): Promise<boolean> {
  const key = enteredId.trim().toUpperCase();

  const pending = peekPendingLecturerId();
  if (pending && pending.trim().toUpperCase() === key) {
    await finishPendingLecturerClaim();
  }

  const [slotRes, roleRes] = await Promise.all([
    supabase.from("lecturer_slots").select("claimed_by").eq("lecturer_id", key).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
  ]);

  const ownsSlot = !!slotRes.data && slotRes.data.claimed_by === userId;
  const hasTeacherRole = roleRes.data?.role === "teacher";
  return ownsSlot && hasTeacherRole;
}
