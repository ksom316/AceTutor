/**
 * Phase A7 evidence-quality — content-length-aware "meaningful engagement"
 * threshold + the pure accumulator behind `useMeaningfulEngagement`.
 *
 * Pure: no React, no DOM, no Supabase. The hook is a thin wrapper that feeds
 * `document.visibilityState` / verified media playback into `advanceEngagement`
 * once a second.
 *
 * A `meaningful_engagement` event means the student was *meaningfully exposed
 * to* (or, for verifiable native media, actually played) a modality's content
 * for a defensible minimum slice of its estimated full length. It is NOT a
 * claim that the lesson was completed, fully read, fully watched, or fully
 * listened to.
 */

import type { LessonModality } from "@/lib/lesson-shared";

/** Bounded proportional thresholds: whatever the content length, the qualifying
 *  time never drops below MIN or exceeds MAX. */
export const MEANINGFUL_ENGAGEMENT_MIN_SECONDS = 90;
export const MEANINGFUL_ENGAGEMENT_MAX_SECONDS = 300;

/**
 * Assumed silent on-screen reading speed, in characters per minute.
 *
 * ≈200 words/minute × ≈5.5 characters/word (including the trailing space).
 * 200 wpm is deliberately at the low end of the commonly cited adult range
 * (Brysbaert 2019 puts non-fiction silent reading near 238 wpm) — a slower
 * assumed rate yields a LONGER estimated reading time and therefore a
 * *higher*, more conservative engagement threshold.
 */
export const READING_CHARS_PER_MINUTE = 1100;

/** The qualifying slice: ~30% of the content's estimated full length. Well
 *  short of completion, but far more than an accidental tab click. */
export const ENGAGEMENT_FRACTION = 0.3;

export type EngagementThresholdInput =
  | { modality: "text"; textLength: number }
  | { modality: "video" | "audio" | "slides"; durationSec: number | null };

function clampSeconds(seconds: number): number {
  return Math.min(
    MEANINGFUL_ENGAGEMENT_MAX_SECONDS,
    Math.max(MEANINGFUL_ENGAGEMENT_MIN_SECONDS, Math.round(seconds)),
  );
}

/**
 * The seconds of engagement/exposure that qualify one modality of one topic as
 * real study evidence, scaled to the actual content and clamped to
 * [MIN, MAX].
 *
 * - **text**: estimate reading duration from the real character count at
 *   {@link READING_CHARS_PER_MINUTE}, then take {@link ENGAGEMENT_FRACTION} of
 *   it. A tiny lesson lands on the 90s floor; a ~10k-character lesson is a few
 *   minutes; anything longer is capped at 300s.
 * - **video / audio**: {@link ENGAGEMENT_FRACTION} of a reliable
 *   `duration_sec`, clamped. A 5-minute clip → 90s; 10-minute → 180s;
 *   ≥~16.7-minute → the 300s cap.
 * - **slides**: same proportional rule when a duration is set; otherwise there
 *   is no reliable length or page count, so fall back to the conservative 90s
 *   floor. Slide *completion* is never estimated.
 * - **missing / non-positive duration**: the 90s floor.
 */
export function computeMeaningfulEngagementThreshold(input: EngagementThresholdInput): number {
  if (input.modality === "text") {
    const chars = Math.max(0, input.textLength);
    const estimatedReadingSeconds = (chars / READING_CHARS_PER_MINUTE) * 60;
    return clampSeconds(estimatedReadingSeconds * ENGAGEMENT_FRACTION);
  }

  const duration = input.durationSec;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return MEANINGFUL_ENGAGEMENT_MIN_SECONDS;
  }
  return clampSeconds(duration * ENGAGEMENT_FRACTION);
}

/**
 * How a modality's engagement is measured:
 * - `"playback"` — verified play time from native `<video>`/`<audio>`
 *   elements (only when EVERY lesson in the modality is direct/uploaded media,
 *   so nothing is left unmeasured). Not tab-gated: background audio is still
 *   genuine listening.
 * - `"exposure"` — content actively visible in the foreground tab. Used for
 *   text, slides, and any provider/iframe media whose playback can't be read
 *   without a provider SDK. Never labelled "watch time" / "listen time".
 */
export type EngagementSignal = "exposure" | "playback";

export type EngagementPlan = { threshold: number; signal: EngagementSignal };

/**
 * Resolves the threshold + which signal to measure for the currently active
 * modality of a topic, from its lessons' real content metadata.
 */
export function resolveEngagementPlan(input: {
  modality: LessonModality;
  /** Summed `body_md` length across the modality's text lessons. */
  totalTextLength: number;
  /** Summed `duration_sec` across the modality's media lessons, or null when
   *  none is known. */
  totalDurationSec: number | null;
  /** True only when every lesson in this modality is native/direct media whose
   *  `<video>`/`<audio>` playback time can be read directly. */
  playbackVerifiable: boolean;
}): EngagementPlan {
  const threshold =
    input.modality === "text"
      ? computeMeaningfulEngagementThreshold({
          modality: "text",
          textLength: input.totalTextLength,
        })
      : computeMeaningfulEngagementThreshold({
          modality: input.modality,
          durationSec: input.totalDurationSec,
        });

  const signal: EngagementSignal =
    (input.modality === "video" || input.modality === "audio") && input.playbackVerifiable
      ? "playback"
      : "exposure";

  return { threshold, signal };
}

/* ----------------------------- accumulator ----------------------------- */

export type EngagementState = {
  /** `${topicId}:${modality}` currently being accumulated. */
  key: string | null;
  /** Foreground-visible seconds accrued for `key` (exposure signal only). */
  exposureSeconds: number;
  /** Keys that have already emitted a `meaningful_engagement` this page visit —
   *  never emitted again. */
  emitted: Set<string>;
};

export function createEngagementState(): EngagementState {
  return { key: null, exposureSeconds: 0, emitted: new Set() };
}

export type EngagementTick = {
  topicId: string;
  modality: LessonModality | null;
  threshold: number;
  signal: EngagementSignal;
  /** `document.visibilityState === "visible"` — gates exposure accrual only. */
  visible: boolean;
  /** Cumulative verified playback seconds for the active modality's native
   *  media. Consulted only when `signal === "playback"`. */
  playbackSeconds: number;
  /** Wall-clock seconds since the previous tick (normally 1). */
  deltaSeconds: number;
};

/**
 * Advances the accumulator by one tick and returns the modality to emit a
 * `meaningful_engagement` event for, or `null`. Mutates `state`.
 *
 * - Switching modality (a new `key`) restarts exposure accrual from 0.
 * - A hidden tab never accrues exposure.
 * - `"playback"` mode ignores exposure entirely and trusts the caller's
 *   verified `playbackSeconds`.
 * - Each `key` emits at most once per page visit.
 */
export function advanceEngagement(
  state: EngagementState,
  tick: EngagementTick,
): LessonModality | null {
  if (!tick.topicId || !tick.modality) return null;
  const key = `${tick.topicId}:${tick.modality}`;

  if (state.key !== key) {
    state.key = key;
    state.exposureSeconds = 0;
  }
  if (state.emitted.has(key)) return null;

  if (tick.signal === "exposure" && tick.visible && tick.deltaSeconds > 0) {
    state.exposureSeconds += tick.deltaSeconds;
  }

  const progress =
    tick.signal === "playback" ? Math.max(0, tick.playbackSeconds) : state.exposureSeconds;

  if (progress >= tick.threshold) {
    state.emitted.add(key);
    return tick.modality;
  }
  return null;
}
