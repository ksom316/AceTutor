/**
 * R4 — conservative, format-specific "did the student meaningfully engage with
 * this remedial explanation?" evidence.
 *
 * Reuses the A6/A7 content-length-aware threshold helper
 * (`computeMeaningfulEngagementThreshold`) and mirrors the
 * `advanceEngagement` accumulator rules — it is NOT a new threshold system.
 * The only difference is the identity: A7 keys on `topicId:modality`, R4 keys
 * on `studyPathId:format:contentVersion` (a stable, truthful key derived from
 * `study_paths.remedial_generated_at`).
 *
 * These signals are TRACKING only — §7: they never enter A7 evidence, reward,
 * `evidenceCount`, `linkedOutcomeCount`, or override logic.
 *
 * Pure — no React, no Supabase, no `window`.
 */

import {
  computeMeaningfulEngagementThreshold,
  type EngagementSignal,
} from "@/lib/meaningful-engagement";
import { remedialContentToScript, type RemedialContent } from "@/lib/remedial-content";
import type { RemedialModality } from "@/lib/remedial-modality";

/** The visible prose a student reads in the Text / Visual remedial views:
 *  title + summary + explanation + worked example + key points + practice. */
export function remedialDisplayTextLength(content: RemedialContent): number {
  return [
    content.title,
    content.summary,
    content.explanation,
    content.workedExample ?? "",
    content.keyPoints.join(" "),
    content.practicePrompt ?? "",
  ]
    .join(" ")
    .trim().length;
}

/** Assumed spoken rate for estimating a full narration's length. Deliberately
 *  below silent-reading speed (~200 wpm) — speech is slower, so a lower rate
 *  yields a longer estimate and therefore a *higher*, more conservative
 *  listening threshold. */
export const NARRATION_WORDS_PER_MINUTE = 155;

export function estimatedNarrationSeconds(content: RemedialContent): number {
  const words = remedialContentToScript(content).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, (words / NARRATION_WORDS_PER_MINUTE) * 60);
}

/** Seconds of format-specific engagement that count as meaningful, from the
 *  SAME clamped [90, 300] helper A7 uses:
 *   - text / visual: ~30% of the reading time of the displayed content
 *     (conservative for the scannable visual map);
 *   - audio: ~30% of the estimated full narration length. */
export function remedialEngagementThreshold(
  content: RemedialContent,
  format: RemedialModality,
): number {
  if (format === "audio") {
    return computeMeaningfulEngagementThreshold({
      modality: "audio",
      durationSec: estimatedNarrationSeconds(content),
    });
  }
  return computeMeaningfulEngagementThreshold({
    modality: "text",
    textLength: remedialDisplayTextLength(content),
  });
}

/** text / visual accumulate visible-tab exposure; audio trusts genuine spoken
 *  seconds (measured while speaking, not paused, tab visible). */
export function remedialEngagementSignal(format: RemedialModality): EngagementSignal {
  return format === "audio" ? "playback" : "exposure";
}

/** `studyPathId:format:contentVersion` — the dedup identity for one meaningful
 *  engagement. `contentVersion` is `study_paths.remedial_generated_at` (ISO). */
export function remedialEngagementKey(
  studyPathId: string,
  format: RemedialModality,
  contentVersion: string | null,
): string {
  return `${studyPathId}:${format}:${contentVersion ?? ""}`;
}

/* ----------------------------- accumulator ----------------------------- */

export type RemedialEngagementState = {
  /** the key currently being accumulated. */
  key: string | null;
  /** foreground-visible seconds accrued for `key` (exposure signal only). */
  exposureSeconds: number;
  /** keys already emitted this session — never emitted again. */
  emitted: Set<string>;
};

export function createRemedialEngagementState(): RemedialEngagementState {
  return { key: null, exposureSeconds: 0, emitted: new Set() };
}

export type RemedialEngagementTick = {
  studyPathId: string;
  format: RemedialModality;
  contentVersion: string | null;
  threshold: number;
  signal: EngagementSignal;
  /** `document.visibilityState === "visible"` — gates exposure accrual only. */
  visible: boolean;
  /** cumulative genuine spoken seconds for this narration (audio only). */
  playbackSeconds: number;
  deltaSeconds: number;
  /** keys already recorded server-side for THIS persisted content (reload /
   *  prior session) — never re-emit these. */
  alreadyPersisted: ReadonlySet<string>;
};

/**
 * Advances the accumulator one tick; returns the format to log a
 * `remedial_meaningful_engagement` for, or `null`. Mutates `state`.
 *
 * Same rules as `advanceEngagement`: a new key restarts exposure from 0 (so
 * switching tabs pauses/resets accumulation), a hidden tab never accrues
 * exposure, `"playback"` trusts the caller's spoken seconds, and each key
 * emits at most once — plus `alreadyPersisted` blocks anything a prior
 * session already recorded.
 */
export function advanceRemedialEngagement(
  state: RemedialEngagementState,
  tick: RemedialEngagementTick,
): RemedialModality | null {
  if (!tick.studyPathId || !tick.format) return null;
  const key = remedialEngagementKey(tick.studyPathId, tick.format, tick.contentVersion);

  if (state.key !== key) {
    state.key = key;
    state.exposureSeconds = 0;
  }
  if (state.emitted.has(key) || tick.alreadyPersisted.has(key)) return null;

  if (tick.signal === "exposure" && tick.visible && tick.deltaSeconds > 0) {
    state.exposureSeconds += tick.deltaSeconds;
  }

  const progress =
    tick.signal === "playback" ? Math.max(0, tick.playbackSeconds) : state.exposureSeconds;

  if (progress >= tick.threshold) {
    state.emitted.add(key);
    return tick.format;
  }
  return null;
}
