import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  generateStudyPath,
  type GenerateStudyPathResult,
  type StudyPathContent,
  studyPathContentSchema,
  studyPathErrorMessage,
} from "@/lib/study-path.functions";
import { remedialContentSchema, type RemedialContent } from "@/lib/remedial-content";
import type { RemedialModality } from "@/lib/remedial-modality";

/**
 * Client access to the AI Study Path backend.
 *
 *   useStudyPath(attemptId)        — one attempt: query + generate + complete
 *   useStudyPathById(studyPathId)  — one path by id: query + complete + remove
 *   useCourseStudyPaths(courseId)  — the student's Study Paths for one course
 *
 * All generation / AI / persistence logic lives in study-path.functions.ts and
 * the SECURITY DEFINER RPCs (save_study_path, mark_study_path_completed,
 * delete_study_path). These hooks only wire those calls to React Query. They
 * never touch the ["result", attemptId] cache, and never affect official course
 * progress.
 */

const ONE_KEY = "study-path";
const COURSE_KEY = "study-paths-course";

const ROW_SELECT =
  "id, user_id, topic_id, course_id, attempt_id, weak_question_ids, content, created_at, saved_at, completed_at, remedial_content, remedial_modality, remedial_generated_at";

/** R1 — the cached remedial explanation on a Study Path row, if present + valid. */
export type StudyPathRemedial = {
  content: RemedialContent;
  modality: RemedialModality;
  generatedAt: string;
};

/** A study_paths row whose `content` has been validated with the shared schema.
 *  A row whose stored content no longer matches the contract is treated as
 *  absent (`null`) rather than rendered half-broken. */
export type ParsedStudyPath = {
  id: string;
  /** Null for a course-level (General Course Quiz) study path. */
  topic_id: string | null;
  course_id: string;
  attempt_id: string;
  weak_question_ids: string[];
  content: StudyPathContent;
  created_at: string;
  saved_at: string | null;
  completed_at: string | null;
  /** R1 — cached personalized remedial explanation, or null. */
  remedial: StudyPathRemedial | null;
};

type StudyPathDbRow = {
  id: string;
  user_id: string;
  topic_id: string | null;
  course_id: string;
  attempt_id: string;
  weak_question_ids: string[] | null;
  content: unknown;
  created_at: string;
  saved_at: string | null;
  completed_at: string | null;
  remedial_content: unknown;
  remedial_modality: string | null;
  remedial_generated_at: string | null;
};

function parseRemedial(row: StudyPathDbRow): StudyPathRemedial | null {
  if (!row.remedial_content || !row.remedial_generated_at) return null;
  const parsed = remedialContentSchema.safeParse(row.remedial_content);
  if (!parsed.success) return null;
  const modality: RemedialModality =
    row.remedial_modality === "audio" || row.remedial_modality === "visual"
      ? row.remedial_modality
      : "text";
  return { content: parsed.data, modality, generatedAt: row.remedial_generated_at };
}

function parseRow(row: StudyPathDbRow): ParsedStudyPath | null {
  const parsed = studyPathContentSchema.safeParse(row.content);
  if (!parsed.success) return null;
  return {
    id: row.id,
    topic_id: row.topic_id,
    course_id: row.course_id,
    attempt_id: row.attempt_id,
    weak_question_ids: row.weak_question_ids ?? [],
    content: parsed.data,
    created_at: row.created_at,
    saved_at: row.saved_at,
    completed_at: row.completed_at,
    remedial: parseRemedial(row),
  };
}

/* ------------------------------------------------------------------ */

export function useStudyPath(attemptId: string, options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const runGenerate = useServerFn(generateStudyPath);
  const enabled = (options?.enabled ?? true) && !!user && !!attemptId;

  const query = useQuery({
    queryKey: [ONE_KEY, attemptId, user?.id],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ParsedStudyPath | null> => {
      const { data, error } = await supabase
        .from("study_paths")
        .select(ROW_SELECT)
        .eq("attempt_id", attemptId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return parseRow(data as unknown as StudyPathDbRow);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [ONE_KEY, attemptId] });
    qc.invalidateQueries({ queryKey: [COURSE_KEY] });
  };

  const generate = useMutation({
    mutationFn: async (): Promise<GenerateStudyPathResult> => runGenerate({ data: { attemptId } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(studyPathErrorMessage(e)),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_study_path_completed", { _id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't save that just now. Please try again."),
  });

  return {
    /** The student's validated study path for this attempt, or null if none. */
    studyPath: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    /** Run generation on demand (fire-and-forget — errors surface as a toast,
     *  and the outcome drives the UI via `studyPath` / `generateResult`). */
    generate: () => generate.mutate(),
    generating: generate.isPending,
    /** Last generation result — used to show the "no weak areas" state. */
    generateResult: generate.data ?? null,
    markCompleted: (id: string) => complete.mutate(id),
    completing: complete.isPending,
  };
}

/* ------------------------------------------------------------------ */

/**
 * A single generated study path by its own id — for the dedicated study path
 * learning page. RLS (`study_paths_select_own`) guarantees the row is returned
 * only to its owner; the id is the only input. Exposes the same completion and
 * removal entry points as {@link useCourseStudyPaths}.
 */
export function useStudyPathById(studyPathId: string, options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = (options?.enabled ?? true) && !!user && !!studyPathId;

  const query = useQuery({
    queryKey: [ONE_KEY, "by-id", studyPathId, user?.id],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ParsedStudyPath | null> => {
      const { data, error } = await supabase
        .from("study_paths")
        .select(ROW_SELECT)
        .eq("id", studyPathId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return parseRow(data as unknown as StudyPathDbRow);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [ONE_KEY] });
    qc.invalidateQueries({ queryKey: [COURSE_KEY] });
  };

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_study_path_completed", { _id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't save that just now. Please try again."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_study_path", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Study Path removed");
      invalidate();
    },
    onError: () => toast.error("Couldn't remove that Study Path just now. Please try again."),
  });

  return {
    studyPath: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    markCompleted: (id: string) => complete.mutate(id),
    completing: complete.isPending,
    removeStudyPath: (id: string, opts?: { onSuccess?: () => void }) => remove.mutate(id, opts),
    removing: remove.isPending,
  };
}

/* ------------------------------------------------------------------ */

/**
 * A module's CURRENT Study Path action, derived from the shared performance
 * model's `currentStudyPathAttemptId` and the course's Study Path rows. The one
 * interpretation of "does this module currently have a Study Path" — reused by
 * Personalized Learning and My Performance so their CTAs never diverge. An older
 * (historical) path for the module never produces "continue" / "review".
 */
export type ModuleStudyPathCta =
  | { kind: "build"; studyPathId: null; path: null }
  | { kind: "continue"; studyPathId: string; path: ParsedStudyPath }
  | { kind: "review"; studyPathId: string; path: ParsedStudyPath };

export function moduleStudyPathCta(
  currentStudyPathAttemptId: string | null,
  pathsByAttemptId: Map<string, ParsedStudyPath>,
): ModuleStudyPathCta {
  const current = currentStudyPathAttemptId
    ? pathsByAttemptId.get(currentStudyPathAttemptId)
    : undefined;
  if (!current) return { kind: "build", studyPathId: null, path: null };
  return current.completed_at
    ? { kind: "review", studyPathId: current.id, path: current }
    : { kind: "continue", studyPathId: current.id, path: current };
}

/**
 * The student's study paths for one course (module + general). By default only
 * rows with a non-null `saved_at` are returned; the "Save / Add to My Learning"
 * feature was retired, so every current caller passes `all: true` to get every
 * generated path. The `saved_at` filter and column are left in place purely as
 * schema compatibility. RLS (`study_paths_select_own`) guarantees only the
 * caller's own rows.
 */
export function useCourseStudyPaths(
  courseId: string | null | undefined,
  opts?: { enabled?: boolean; all?: boolean },
) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = (opts?.enabled ?? true) && !!user && !!courseId;
  const all = opts?.all ?? false;

  const query = useQuery({
    queryKey: [COURSE_KEY, courseId, user?.id, all ? "all" : "saved"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ParsedStudyPath[]> => {
      let q = supabase.from("study_paths").select(ROW_SELECT).eq("course_id", courseId!);
      if (!all) q = q.not("saved_at", "is", null);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as StudyPathDbRow[])
        .map(parseRow)
        .filter((r): r is ParsedStudyPath => r !== null);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [COURSE_KEY] });
    qc.invalidateQueries({ queryKey: [ONE_KEY] });
  };

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_study_path_completed", { _id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't save that just now. Please try again."),
  });

  // Delete ONE study_paths row, the caller's own. Via the SECURITY DEFINER
  // `delete_study_path` RPC — study_paths has no client-facing delete policy by
  // design. Removes nothing else: quiz attempts, scores, progress, preferences
  // and other Study Paths are untouched.
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_study_path", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Study Path removed");
      invalidate();
    },
    onError: () => toast.error("Couldn't remove that Study Path just now. Please try again."),
  });

  const studyPaths = useMemo<ParsedStudyPath[]>(() => query.data ?? [], [query.data]);

  return {
    studyPaths,
    isLoading: query.isLoading,
    isError: query.isError,
    markCompleted: (id: string) => complete.mutate(id),
    completing: complete.isPending,
    completingId: complete.isPending ? (complete.variables ?? null) : null,
    removeStudyPath: (id: string) => remove.mutate(id),
    removingId: remove.isPending ? (remove.variables ?? null) : null,
  };
}
