import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { RemedialContent } from "@/lib/remedial-content";
import type { RemedialModality, RemedialModalitySource } from "@/lib/remedial-modality";
import {
  advanceRemedialEngagement,
  createRemedialEngagementState,
  remedialEngagementKey,
  remedialEngagementSignal,
  remedialEngagementThreshold,
} from "@/lib/remedial-engagement";
import { logRemedialInteraction } from "@/lib/remedial-tracking";

const TICK_MS = 1000;

/**
 * R4 — records remedial-intervention evidence for the Study Path page.
 *
 * - `logFormatSelection(format)` — call ONLY from a real toggle click that
 *   changes the format. Never from the initial auto-selection or a render.
 * - a 1s loop accumulates conservative, format-specific meaningful-engagement
 *   evidence (text/visual = visible-tab exposure; audio = the genuine spoken
 *   seconds the caller supplies) and logs at most one
 *   `remedial_meaningful_engagement` per (studyPath, format, contentVersion) —
 *   also deduped against anything a prior session already persisted.
 *
 * Everything here is fire-and-forget: a tracking failure never surfaces to the
 * student and never touches narration / tab switching / the Study Path. It
 * feeds NOTHING to A7.
 */
export function useRemedialTracking(input: {
  enabled: boolean;
  studyPathId: string;
  content: RemedialContent | null;
  /** `study_paths.remedial_generated_at` (ISO) — the truthful content version. */
  contentVersion: string | null;
  activeFormat: RemedialModality;
  recommendedFormat: RemedialModality | null;
  // R8.3 — widened for the personal-history recommendation source.
  recommendationSource: RemedialModalitySource | "history" | null;
  /** cumulative genuine spoken seconds for the current narration (audio only;
   *  measured by RemedialAudioPlayer while speaking, not paused, tab visible). */
  audioSpokenSeconds: number;
}) {
  const { user } = useAuth();
  const enabled = input.enabled && !!user && !!input.studyPathId;

  // Reload dedup: keys already recorded server-side for this Study Path.
  const persistedQuery = useQuery({
    queryKey: ["remedial-engagement-log", input.studyPathId, user?.id],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await supabase
        .from("learning_interactions")
        .select("remedial_format, remedial_content_version")
        .eq("study_path_id", input.studyPathId)
        .eq("event_type", "remedial_meaningful_engagement");
      const set = new Set<string>();
      for (const r of data ?? []) {
        if (r.remedial_format) {
          set.add(
            remedialEngagementKey(
              input.studyPathId,
              r.remedial_format as RemedialModality,
              r.remedial_content_version ?? null,
            ),
          );
        }
      }
      return set;
    },
  });

  const stateRef = useRef(createRemedialEngagementState());
  const persistedRef = useRef<ReadonlySet<string>>(new Set());
  persistedRef.current = persistedQuery.data ?? new Set();
  const audioRef = useRef(input.audioSpokenSeconds);
  audioRef.current = input.audioSpokenSeconds;

  const ctxRef = useRef(input);
  ctxRef.current = input;

  const threshold = useMemo(
    () => (input.content ? remedialEngagementThreshold(input.content, input.activeFormat) : 0),
    [input.content, input.activeFormat],
  );

  useEffect(() => {
    if (!enabled || !ctxRef.current.content) return;
    const id = window.setInterval(() => {
      const c = ctxRef.current;
      if (!c.content) return;
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      const emit = advanceRemedialEngagement(stateRef.current, {
        studyPathId: c.studyPathId,
        format: c.activeFormat,
        contentVersion: c.contentVersion,
        threshold,
        signal: remedialEngagementSignal(c.activeFormat),
        visible,
        playbackSeconds: c.activeFormat === "audio" ? audioRef.current : 0,
        deltaSeconds: TICK_MS / 1000,
        alreadyPersisted: persistedRef.current,
      });
      if (emit) {
        void logRemedialInteraction({
          studyPathId: c.studyPathId,
          eventType: "remedial_meaningful_engagement",
          format: emit,
          recommendedFormat: c.recommendedFormat,
          recommendationSource: c.recommendationSource,
        });
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, threshold, input.activeFormat, input.contentVersion]);

  const logFormatSelection = useCallback(
    (format: RemedialModality) => {
      const c = ctxRef.current;
      if (!enabled) return;
      void logRemedialInteraction({
        studyPathId: c.studyPathId,
        eventType: "remedial_format_selected",
        format,
        recommendedFormat: c.recommendedFormat,
        recommendationSource: c.recommendationSource,
      });
    },
    [enabled],
  );

  return { logFormatSelection };
}
