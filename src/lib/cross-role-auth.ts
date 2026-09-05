/**
 * Pure decision logic for "one authenticated identity = one AceTutor role".
 *
 * The DATABASE is the enforcement point:
 *   - `user_roles` has a one-row-per-user unique constraint and a `status`
 *     column that distinguishes an ESTABLISHED role from a PROVISIONAL
 *     placeholder (a would-be lecturer between signup and claim)
 *     (20260905230000_one_role_per_user.sql). Its writes are SECURITY DEFINER
 *     only, so a client can never grant itself a role.
 *   - `handle_new_user()` writes an ESTABLISHED `student` for every signup
 *     EXCEPT one that declared lecturer intent, which gets a PROVISIONAL
 *     `student` placeholder. The client `signup_intent` marker only weakens
 *     the row — it grants nothing.
 *   - `claim_lecturer_slot()` decides on `status`: an ESTABLISHED student is
 *     rejected outright; a provisional/missing row converts IN PLACE to
 *     teacher. It never deletes/overwrites a role. Activity is only a
 *     defensive backstop for provisional/legacy rows.
 *   - the student-surface login paths (password + Google OAuth) sign a
 *     lecturer account straight back out.
 *
 * These helpers mirror that logic so it is unit-testable and so the UI shows
 * the same wording. No React, no Supabase, no path magic.
 */

/** Passed as `raw_user_meta_data.signup_intent` by the lecturer signup form. */
export const SIGNUP_INTENT_LECTURER = "lecturer";

export type RoleStatus = "provisional" | "established";

export type ClaimConflictInput = {
  /** The row in `user_roles` for this user, or null when there is none yet. */
  existingRole: "student" | "teacher" | "admin" | null;
  /** `user_roles.status` for that row, or null when there is no row. */
  roleStatus: RoleStatus | null;
  /** DEFENSIVE BACKSTOP ONLY — not the primary rule. True when a
   *  provisional/legacy account still carries real student history. */
  hasLegacyStudentActivity: boolean;
  /** The typed Lecturer ID resolves to a real `lecturer_slots` row. */
  slotExists: boolean;
  /** …and that slot has already been claimed by someone. */
  slotClaimed: boolean;
  /** …by THIS user (a retry / resumed claim). */
  slotClaimedBySelf: boolean;
};

export type ClaimDecision =
  | { ok: true }
  | { ok: false; code: "ALREADY_LECTURER" | "INVALID_ID" | "ID_CLAIMED" | "ROLE_CONFLICT_STUDENT" };

/**
 * The exact order `claim_lecturer_slot()` decides in:
 *  1. this account already owns a slot                       -> ALREADY_LECTURER
 *  2. the Lecturer ID is not real                            -> INVALID_ID
 *  3. it is real but someone else claimed it                 -> ID_CLAIMED
 *  4. PRIMARY RULE: role='student' AND status='established'   -> ROLE_CONFLICT_STUDENT
 *  5. BACKSTOP: provisional/legacy/no-row WITH student history-> ROLE_CONFLICT_STUDENT
 *  6. otherwise (teacher retry, or a provisional placeholder) -> ok
 */
export function resolveRoleClaimConflict(input: ClaimConflictInput): ClaimDecision {
  if (input.slotClaimedBySelf) return { ok: false, code: "ALREADY_LECTURER" };
  if (!input.slotExists) return { ok: false, code: "INVALID_ID" };
  if (input.slotClaimed) return { ok: false, code: "ID_CLAIMED" };

  // PRIMARY RULE — decided on the explicit status, never on activity.
  if (input.existingRole === "student" && input.roleStatus === "established") {
    return { ok: false, code: "ROLE_CONFLICT_STUDENT" };
  }

  // DEFENSIVE BACKSTOP — a `teacher` row is a retry/mid-claim (always ok);
  // any other non-established state that still carries student history is
  // treated as an established student.
  if (input.existingRole !== "teacher" && input.hasLegacyStudentActivity) {
    return { ok: false, code: "ROLE_CONFLICT_STUDENT" };
  }

  return { ok: true };
}

export const ROLE_CONFLICT_STUDENT_TOKEN = "ROLE_CONFLICT_STUDENT";

export const LECTURER_ACCOUNT_ON_STUDENT_SURFACE_MESSAGE =
  "This email is already registered as a lecturer account. Please sign in with the Lecturer option (email, password and Lecturer ID) or use a different email.";

export const STUDENT_ACCOUNT_ON_LECTURER_SURFACE_MESSAGE =
  "This email is already registered as a student account. Please sign in as a student or use a different email.";

/** Turn a raw `claim_lecturer_slot` error message into something a user should
 *  see (strips the machine `ROLE_CONFLICT_STUDENT:` sentinel prefix). */
export function friendlyClaimError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "Could not verify your Lecturer ID.";
  if (msg.includes(ROLE_CONFLICT_STUDENT_TOKEN)) return STUDENT_ACCOUNT_ON_LECTURER_SURFACE_MESSAGE;
  return msg;
}

export function isRoleConflictStudentError(raw: string | null | undefined): boolean {
  return !!raw && raw.includes(ROLE_CONFLICT_STUDENT_TOKEN);
}
