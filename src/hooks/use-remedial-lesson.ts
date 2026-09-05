import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  generateRemedialLesson,
  getRemedialRecommendation,
  remedialErrorMessage,
  type RemedialLessonResult,
  type RemedialRecommendationResult,
} from "@/lib/remedial.functions";

/**
 * R1 client access to the remedial-content backend.
 *
 * - `recommendation` — the recommended remedial format (cheap, no AI). Drives
 *   the "Recommended for you: …" label and the default format toggle.
 * - `generate(regenerate?)` — one AI generation, persisted server-side. Reuses
 *   cached content unless `regenerate` is true. Errors surface as a toast and
 *   `generateError`; the Study Path itself is never touched.
 *
 * All AI / persistence / modality logic lives server-side in
 * remedial.functions.ts. This hook only wires it to React Query. It never
 * mutates VARK, Learning Preferences, A7 state or Mastery.
 */
export function useRemedialLesson(studyPathId: string, options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = (options?.enabled ?? true) && !!user && !!studyPathId;

  const runRecommend = useServerFn(getRemedialRecommendation);
  const runGenerate = useServerFn(generateRemedialLesson);

  const recommendationQuery = useQuery({
    queryKey: ["remedial-recommendation", studyPathId, user?.id],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: (): Promise<RemedialRecommendationResult> => runRecommend({ data: { studyPathId } }),
  });

  const generate = useMutation({
    mutationFn: (regenerate?: boolean): Promise<RemedialLessonResult> =>
      runGenerate({ data: { studyPathId, regenerate: !!regenerate } }),
    onSuccess: () => {
      // Refresh the Study Path row so the newly-saved remedial content shows.
      qc.invalidateQueries({ queryKey: ["study-path"] });
    },
    onError: (e) => toast.error(remedialErrorMessage(e)),
  });

  return {
    recommendation: recommendationQuery.data ?? null,
    recommendationLoading: recommendationQuery.isLoading,
    generate: (regenerate?: boolean) => generate.mutate(regenerate),
    generating: generate.isPending,
    generateResult: generate.data ?? null,
    generateFailed: generate.isError,
    generateErrorMessage: generate.error ? remedialErrorMessage(generate.error) : null,
    resetGenerate: () => generate.reset(),
  };
}
