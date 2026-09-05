import { useCallback, useEffect, useRef, useState } from "react";

/**
 * R2 — a small wrapper around the browser Web Speech API for narrating one
 * block of text (the remedial explanation script). No audio files, no network,
 * no paid TTS.
 *
 * Lifecycle guarantees:
 *  - `speechSynthesis.cancel()` runs before every new utterance, so repeated
 *    Play clicks / a restart can never produce overlapping voices.
 *  - narration is cancelled when `text` changes (a new remedial lesson) and on
 *    unmount (tab switch away from Audio, navigation, page change).
 *  - never speaks on its own — `play()` must be called explicitly.
 *
 * SSR-safe: support detection runs in an effect, so the server render and the
 * first client render agree (`supported: false`) before the client confirms.
 */
export function useSpeechSynthesis(text: string) {
  // null = not yet determined (SSR / first render), so the UI shows neither the
  // player nor the "unsupported" message until the client has checked.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  const textRef = useRef(text);
  textRef.current = text;
  const restartTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof window.speechSynthesis !== "undefined" &&
        typeof window.SpeechSynthesisUtterance === "function",
    );
  }, []);

  const stop = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }, []);

  const play = useCallback(() => {
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
    if (typeof window.SpeechSynthesisUtterance !== "function") return;
    const value = textRef.current.trim();
    if (!value) return;

    // Cancel anything in flight FIRST — no overlapping utterances.
    window.speechSynthesis.cancel();

    const utterance = new window.SpeechSynthesisUtterance(value);
    utterance.lang = "en-US";
    // Lightweight voice pick: a plain English voice if one is trivially
    // available, otherwise the browser default. No selection UI, no gender
    // assumptions. getVoices() can be empty until "voiceschanged" fires — that
    // is fine, we just fall back to the default.
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    const englishVoice = voices.find((v) => /^en(-|_|$)/i.test(v.lang));
    if (englishVoice) utterance.voice = englishVoice;

    utterance.onstart = () => {
      setSpeaking(true);
      setPaused(false);
    };
    utterance.onend = () => {
      setSpeaking(false);
      setPaused(false);
    };
    utterance.onerror = () => {
      setSpeaking(false);
      setPaused(false);
    };
    utterance.onpause = () => setPaused(true);
    utterance.onresume = () => setPaused(false);

    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
    setPaused(false);
  }, []);

  const pause = useCallback(() => {
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
    if (!window.speechSynthesis.speaking || window.speechSynthesis.paused) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
    if (!window.speechSynthesis.paused) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }, []);

  const restart = useCallback(() => {
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
    window.speechSynthesis.cancel();
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    // Some engines drop a speak() issued in the same tick as cancel(). The
    // timer is cleared by stop() (so it can't fire after unmount).
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      play();
    }, 60);
  }, [play]);

  // Cancel narration when the lesson text changes (a new / regenerated
  // RemedialContent), and on unmount.
  useEffect(() => {
    return () => stop();
  }, [text, stop]);

  // Chrome silently pauses utterances longer than ~15s while it thinks the tab
  // is idle. Nudge it while we believe narration is running.
  useEffect(() => {
    if (!supported || !speaking || paused) return;
    const id = window.setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 10_000);
    return () => window.clearInterval(id);
  }, [supported, speaking, paused]);

  return { supported, speaking, paused, play, pause, resume, stop, restart };
}
