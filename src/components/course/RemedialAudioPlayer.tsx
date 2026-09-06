import { useEffect, useRef } from "react";
import { Pause, Play, RotateCcw, Square, StepForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { resolveSpeechControls } from "@/lib/speech-controls";

/**
 * R2 — narrates the already-generated remedial explanation with the browser's
 * Web Speech API. `script` MUST be `remedialContentToScript(remedialContent)` —
 * there is no audio-specific lesson or prompt.
 *
 * All speech logic lives in `useSpeechSynthesis`; this component only maps its
 * state to labelled, correctly-disabled controls. Unmounting it (switching to
 * Text/Visual, navigating away) stops narration.
 *
 * R4 (tracking only): `onSpokenProgress` reports the cumulative GENUINE spoken
 * seconds for this narration — counted only while actually speaking, not
 * paused, and the tab is visible. It never affects playback or R2 behaviour.
 */
export function RemedialAudioPlayer({
  script,
  onSpokenProgress,
}: {
  script: string;
  onSpokenProgress?: (spokenSeconds: number) => void;
}) {
  const speech = useSpeechSynthesis(script);

  const spokenRef = useRef(0);
  const onSpokenRef = useRef(onSpokenProgress);
  onSpokenRef.current = onSpokenProgress;
  const speakingRef = useRef(speech.speaking);
  speakingRef.current = speech.speaking;
  const pausedRef = useRef(speech.paused);
  pausedRef.current = speech.paused;

  useEffect(() => {
    if (speech.supported !== true) return;
    const id = window.setInterval(() => {
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      if (speakingRef.current && !pausedRef.current && visible) {
        spokenRef.current += 1;
        onSpokenRef.current?.(spokenRef.current);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [speech.supported]);

  // null = the client hasn't checked support yet (SSR / first paint).
  if (speech.supported === null) {
    return <div className="h-[92px] animate-pulse rounded-lg border border-border bg-muted/40" />;
  }
  if (speech.supported === false) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Audio narration is not supported in this browser. You can still study the text explanation.
      </p>
    );
  }

  const controls = resolveSpeechControls({
    supported: true,
    speaking: speech.speaking,
    paused: speech.paused,
  });

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-sm font-medium">Listen to your personalized explanation</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={speech.play}
          disabled={!controls.canPlay}
          aria-label="Play narration"
        >
          <Play className="mr-1.5 h-3.5 w-3.5" /> Play
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={speech.pause}
          disabled={!controls.canPause}
          aria-label="Pause narration"
        >
          <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={speech.resume}
          disabled={!controls.canResume}
          aria-label="Resume narration"
        >
          <StepForward className="mr-1.5 h-3.5 w-3.5" /> Resume
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={speech.restart}
          disabled={!controls.canRestart}
          aria-label="Restart narration from the beginning"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restart
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={speech.stop}
          disabled={!controls.canStop}
          aria-label="Stop narration"
        >
          <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        {controls.statusLabel} · Narrated by your browser&apos;s built-in voice.
      </p>
    </div>
  );
}
