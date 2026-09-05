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
 */
export function RemedialAudioPlayer({ script }: { script: string }) {
  const speech = useSpeechSynthesis(script);

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
