/**
 * The ONE authoritative path for "does this student already have an official
 * quiz running, and can they start this one?".
 *
 * Enforcement is server-side: a BEFORE INSERT trigger on `quiz_attempts`
 * (`enforce_one_active_official_quiz`, migration 20260905240000) takes a
 * per-student advisory lock and rejects a second unfinished, non-expired
 * OFFICIAL attempt for a different quiz — so two tabs / two devices clicking
 * Start at the same instant can never open two. These helpers are the shared
 * client view of that rule (used by both runner routes + StartQuizButton), so
 * the check is not re-implemented per component.
 *
 * Practice "Quiz Me" is stateless and never writes `quiz_attempts`, so it is
 * completely outside this restriction.
 */

import { supabase } from "@/integrations/supabase/client";
import { effectiveQuizDeadline } from "@/lib/course-quiz";

export type ActiveQuizAttempt = {
  attemptId: string;
  kind: "module" | "general";
  /** topic id (module) or course-quiz id (general) — the runner route param. */
  paramId: string;
  title: string;
  contextName: string | null;
  /** The EFFECTIVE deadline — `expires_at` for a module quiz, or
   *  `min(expires_at, course_quizzes.deadline)` for a General Course Quiz. */
  expiresAt: string;
};

type Row = {
  id: string;
  topic_id: string | null;
  course_quiz_id: string | null;
  expires_at: string;
  topics: { title: string; courses: { title: string } | null } | null;
  course_quizzes: {
    title: string;
    deadline: string | null;
    courses: { title: string } | null;
  } | null;
};

/** The student's single in-progress, timed OFFICIAL attempt, if any. Same query
 *  `useActiveQuiz` renders in the global banner — one source of truth. */
export async function loadActiveOfficialAttempt(userId: string): Promise<ActiveQuizAttempt | null> {
  const { data: row } = await supabase
    .from("quiz_attempts")
    .select(
      "id, topic_id, course_quiz_id, expires_at, topics(title, courses(title)), course_quizzes(title, deadline, courses(title))",
    )
    .eq("user_id", userId)
    .is("finished_at", null)
    .not("expires_at", "is", null)
    .gt("expires_at", new Date().toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const r = (row ?? null) as Row | null;
  if (!r) return null;

  if (r.topic_id) {
    return {
      attemptId: r.id,
      kind: "module",
      paramId: r.topic_id,
      title: r.topics?.title ?? "Module quiz",
      contextName: r.topics?.courses?.title ?? null,
      expiresAt: r.expires_at,
    };
  }
  if (r.course_quiz_id) {
    const effective = effectiveQuizDeadline(r.expires_at, r.course_quizzes?.deadline ?? null);
    if (!effective || Date.parse(effective) <= Date.now()) return null;
    return {
      attemptId: r.id,
      kind: "general",
      paramId: r.course_quiz_id,
      title: r.course_quizzes?.title ?? "General Course Quiz",
      contextName: r.course_quizzes?.courses?.title ?? null,
      expiresAt: effective,
    };
  }
  return null;
}

export type OfficialQuizRef =
  | { kind: "module"; topicId: string }
  | { kind: "general"; courseQuizId: string };

/**
 * True when `active` is a live official attempt for a DIFFERENT quiz than the
 * one the student is trying to start — i.e. it blocks the new start.
 * Resuming the SAME quiz (active matches `ref`) returns false: that is a
 * resume, not a new attempt.
 */
export function isBlockingActiveAttempt(
  active: ActiveQuizAttempt | null | undefined,
  ref: OfficialQuizRef,
): boolean {
  if (!active) return false;
  if (ref.kind === "module") {
    return !(active.kind === "module" && active.paramId === ref.topicId);
  }
  return !(active.kind === "general" && active.paramId === ref.courseQuizId);
}

/** Machine sentinel raised by `enforce_one_active_official_quiz`. */
export const ONE_ACTIVE_OFFICIAL_QUIZ_TOKEN = "ONE_ACTIVE_OFFICIAL_QUIZ";

export function isOneActiveOfficialQuizError(
  err: { message?: string | null } | null | undefined,
): boolean {
  return !!err?.message && err.message.includes(ONE_ACTIVE_OFFICIAL_QUIZ_TOKEN);
}

export const ACTIVE_QUIZ_ELSEWHERE_MESSAGE =
  "You already have a quiz in progress. Finish it — or let its timer run out — before starting a new one.";
