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

/**
 * Client access to the AI Study Path backend.
 *
 *   useStudyPath(attemptId)        — one attempt: query + generate + complete +
 *                                    add/remove from My Learning
 *   useCourseStudyPaths(courseId)  — the student's SAVED paths for one course
 *
 * All generation / AI / persistence logic lives in study-path.functions.ts and
 * the SECURITY DEFINER RPCs (save_study_path, mark_study_path_completed,
 * set_study_path_saved). These hooks only wire those calls to React Query. They
 * never touch the ["result", attemptId] cache, and never affect official course
 * progress.
 */

const ONE_KEY = "study-path";
const COURSE_KEY = "study-paths-course";

const ROW_SELECT =
  "id, user_id, topic_id, course_id, attempt_id, weak_question_ids, content, created_at, saved_at, completed_at";

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
};

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

  const setSaved = useMutation({
    mutationFn: async ({ id, saved }: { id: string; saved: boolean }) => {
      const { error } = await supabase.rpc("set_study_path_saved", { _id: id, _saved: saved });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't update My Learning just now. Please try again."),
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
    /** Add to / remove from the student's "My Learning" area (reversible). */
    setSaved: (id: string, saved: boolean) => setSaved.mutate({ id, saved }),
    savingSaved: setSaved.isPending,
  };
}

/* ------------------------------------------------------------------ */

/**
 * A single saved/generated study path by its own id — for the dedicated study
 * path learning page. RLS (`study_paths_select_own`) guarantees the row is
 * returned only to its owner; the id is the only input and `user_id` is never
 * sent from the client. Reuses the same generate-free read + the completion and
 * "My Learning" mutations as {@link useStudyPath}.
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

  const setSaved = useMutation({
    mutationFn: async ({ id, saved }: { id: string; saved: boolean }) => {
      const { error } = await supabase.rpc("set_study_path_saved", { _id: id, _saved: saved });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't update My Learning just now. Please try again."),
  });

  return {
    studyPath: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    markCompleted: (id: string) => complete.mutate(id),
    completing: complete.isPending,
    setSaved: (id: string, saved: boolean) => setSaved.mutate({ id, saved }),
    savingSaved: setSaved.isPending,
  };
}

/* ------------------------------------------------------------------ */

export type CourseStudyPathStats = {
  total: number;
  completed: number;
  inProgress: number;
};

/**
 * The student's SAVED study paths for one course (module + general). RLS
 * (`study_paths_select_own`) guarantees only the caller's own rows — the
 * `user_id` is never sent from the client.
 */
export function useCourseStudyPaths(
  courseId: string | null | undefined,
  opts?: { enabled?: boolean },
) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = (opts?.enabled ?? true) && !!user && !!courseId;

  const query = useQuery({
    queryKey: [COURSE_KEY, courseId, user?.id],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ParsedStudyPath[]> => {
      const { data, error } = await supabase
        .from("study_paths")
        .select(ROW_SELECT)
        .eq("course_id", courseId!)
        .not("saved_at", "is", null)
        .order("created_at", { ascending: false });
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

  const setSaved = useMutation({
    mutationFn: async ({ id, saved }: { id: string; saved: boolean }) => {
      const { error } = await supabase.rpc("set_study_path_saved", { _id: id, _saved: saved });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't update My Learning just now. Please try again."),
  });

  const studyPaths = useMemo<ParsedStudyPath[]>(() => query.data ?? [], [query.data]);
  const stats = useMemo<CourseStudyPathStats>(() => {
    const total = studyPaths.length;
    const completed = studyPaths.reduce((n, p) => n + (p.completed_at ? 1 : 0), 0);
    return { total, completed, inProgress: total - completed };
  }, [studyPaths]);

  return {
    studyPaths,
    stats,
    isLoading: query.isLoading,
    isError: query.isError,
    markCompleted: (id: string) => complete.mutate(id),
    completing: complete.isPending,
    completingId: complete.isPending ? (complete.variables ?? null) : null,
    setSaved: (id: string, saved: boolean) => setSaved.mutate({ id, saved }),
    savingSaved: setSaved.isPending,
    savingSavedId: setSaved.isPending ? (setSaved.variables?.id ?? null) : null,
  };
}
