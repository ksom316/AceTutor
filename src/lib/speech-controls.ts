/**
 * R2 — pure derivation of the audio player's control states from the speech
 * hook's state. Keeps the button enable/disable rules (and their intent)
 * testable without a DOM.
 *
 * Pure — no React, no `window`.
 */

export type SpeechStatus = {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
};

export type SpeechControls = {
  /** Play a fresh narration from the start. Disabled once a narration is
   *  running (paused counts as running — Resume/Restart handle that). */
  canPlay: boolean;
  /** Only while actively speaking (not already paused). */
  canPause: boolean;
  /** Only while paused. */
  canResume: boolean;
  /** Cancel + start over — only meaningful once a narration exists. */
  canRestart: boolean;
  /** Cancel + return to idle — disabled when already idle. */
  canStop: boolean;
  /** Short status word for the control area. */
  statusLabel: "Not supported" | "Ready" | "Speaking…" | "Paused";
};

export function resolveSpeechControls(state: SpeechStatus): SpeechControls {
  const { supported, speaking, paused } = state;
  const idle = !speaking && !paused;
  if (!supported) {
    return {
      canPlay: false,
      canPause: false,
      canResume: false,
      canRestart: false,
      canStop: false,
      statusLabel: "Not supported",
    };
  }
  return {
    canPlay: idle,
    canPause: speaking && !paused,
    canResume: paused,
    canRestart: !idle,
    canStop: !idle,
    statusLabel: paused ? "Paused" : speaking ? "Speaking…" : "Ready",
  };
}
