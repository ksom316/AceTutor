import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import {
  getRemedialVideoRecommendation,
  type RemedialVideoResult,
} from "@/lib/remedial-video.functions";

/**
 * R6 client access to the remedial-video recommendation.
 *
 * One server call, cached on the Study Path row: the query fires once and is
 * NOT refetched on window focus or remount, so the Study Path never re-searches
 * YouTube on every render. `refresh()` forces a fresh search+save.
 *
 * A failed call resolves to "no recommendation" — it never throws into the
 * remediation UI and never touches Text/Audio/Visual.
 */
export function useRemedialVideo(studyPathId: string, options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = (options?.enabled ?? true) && !!user && !!studyPathId;
  const run = useServerFn(getRemedialVideoRecommendation);

  const key = ["remedial-video", studyPathId, user?.id];

  const query = useQuery({
    queryKey: key,
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
    queryFn: async (): Promise<RemedialVideoResult | null> => {
      try {
        return await run({ data: { studyPathId } });
      } catch {
        return null; // fail-safe: no card, remediation unaffected
      }
    },
  });

  const refresh = useMutation({
    mutationFn: async (): Promise<RemedialVideoResult | null> => {
      try {
        return await run({ data: { studyPathId, refresh: true } });
      } catch {
        return null;
      }
    },
    onSuccess: (result) => {
      if (result) qc.setQueryData(key, result);
    },
  });

  const result = query.data ?? null;

  return {
    recommendation: result?.recommendation ?? null,
    searchUnavailable: result?.searchUnavailable ?? false,
    loading: query.isLoading,
    /** the query resolved (with or without a video). */
    ready: query.isFetched,
    refresh: () => refresh.mutate(),
    refreshing: refresh.isPending,
  };
}
