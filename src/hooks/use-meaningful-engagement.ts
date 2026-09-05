import { useEffect, useRef } from "react";
import type { LessonModality } from "@/lib/lesson-shared";
import {
  advanceEngagement,
  createEngagementState,
  type EngagementSignal,
} from "@/lib/meaningful-engagement";

const TICK_MS = 1000;

/**
 * Phase A7 evidence-quality signal. Calls `onQualify(modality)` AT MOST ONCE
 * per (topicId, modality) per page visit, once that modality has been engaged
 * with for its content-length-aware `threshold` seconds (see
 * src/lib/meaningful-engagement.ts — `computeMeaningfulEngagementThreshold`).
 *
 * Two measurement modes, chosen by the caller via `signal`:
 * - `"exposure"` (text, slides, provider/iframe media): counts seconds the
 *   content is the active modality with the browser tab VISIBLE. Reads only
 *   `document.visibilityState` — no scroll / pointer / mouse / keyboard
 *   listeners. Accrual resets when the active modality changes and pauses
 *   while the tab is hidden. Represents meaningful *exposure* only — it never
 *   claims the student read the content.
 * - `"playback"` (native `<video>`/`<audio>` only): trusts `getPlaybackSeconds`
 *   — verified play time read from the media element. Not tab-gated.
 *
 * All accumulator rules (reset-on-switch, one-emit-per-key, threshold compare)
 * live in the pure `advanceEngagement` reducer; this hook only supplies the
 * per-second tick and the live inputs.
 */
export function useMeaningfulEngagement(params: {
  enabled: boolean;
  topicId: string;
  activeModality: LessonModality | undefined;
  threshold: number;
  signal: EngagementSignal;
  /** Cumulative verified playback seconds for the active modality's native
   *  media. Only read when `signal === "playback"`. */
  getPlaybackSeconds: () => number;
  onQualify: (modality: LessonModality) => void;
}): void {
  const { enabled, topicId, activeModality, threshold, signal, getPlaybackSeconds, onQualify } =
    params;

  const onQualifyRef = useRef(onQualify);
  onQualifyRef.current = onQualify;
  const getPlaybackSecondsRef = useRef(getPlaybackSeconds);
  getPlaybackSecondsRef.current = getPlaybackSeconds;

  const stateRef = useRef(createEngagementState());

  useEffect(() => {
    if (!enabled || !activeModality || !topicId) return;

    const id = setInterval(() => {
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      const emit = advanceEngagement(stateRef.current, {
        topicId,
        modality: activeModality,
        threshold,
        signal,
        visible,
        playbackSeconds: signal === "playback" ? getPlaybackSecondsRef.current() : 0,
        deltaSeconds: TICK_MS / 1000,
      });
      if (emit) onQualifyRef.current(emit);
    }, TICK_MS);

    return () => clearInterval(id);
  }, [enabled, topicId, activeModality, threshold, signal]);
}
