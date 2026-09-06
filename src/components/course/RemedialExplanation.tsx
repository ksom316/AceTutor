import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { remedialContentToScript, type RemedialContent } from "@/lib/remedial-content";
import {
  REMEDIAL_MODALITIES,
  REMEDIAL_MODALITY_LABEL,
  type RemedialModality,
} from "@/lib/remedial-modality";
import { useRemedialLesson } from "@/hooks/use-remedial-lesson";
import { useRemedialTracking } from "@/hooks/use-remedial-tracking";
import { useRemedialVideo } from "@/hooks/use-remedial-video";
import type { ParsedStudyPath } from "@/hooks/use-study-path";
import { RemedialAudioPlayer } from "@/components/course/RemedialAudioPlayer";
import { RemedialVisualView } from "@/components/course/RemedialVisualSpec";
import { RemedialVideoCard } from "@/components/course/RemedialVideoCard";
import { remedialContentToVisualModel } from "@/lib/remedial-visual";
import { parseRemedialVisualSpec } from "@/lib/remedial-visual-spec";

/* ------------------------------------------------------------------ *
 * RemedialContentView — the format-agnostic remedial lesson, rendered as
 * TEXT for R1. R2 will speak `content` (see remedialContentToScript); R3 will
 * turn `weakConcepts` / `keyPoints` into a diagram. Nothing about generation
 * is coupled to this component.
 * ------------------------------------------------------------------ */
export function RemedialContentView({ content }: { content: RemedialContent }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-xl">{content.title}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {content.weakConcepts.map((c) => (
            <Badge key={c} variant="secondary" className="font-normal">
              {c}
            </Badge>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{content.summary}</p>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Explanation
        </p>
        <div className="prose-lesson mt-1.5 max-w-none break-words text-foreground">
          <ReactMarkdown>{content.explanation}</ReactMarkdown>
        </div>
      </div>

      {content.workedExample && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Worked example
          </p>
          <div className="prose-lesson mt-1.5 max-w-none break-words rounded-lg bg-muted/60 p-4 text-foreground">
            <ReactMarkdown>{content.workedExample}</ReactMarkdown>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Key points
        </p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {content.keyPoints.map((k, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{k}</span>
            </li>
          ))}
        </ul>
      </div>

      {content.practicePrompt && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Try this
          </p>
          <p className="mt-1.5 text-sm text-foreground">{content.practicePrompt}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * RemedialExplanationPanel — the entry point on the Study Path page.
 * ------------------------------------------------------------------ */
export function RemedialExplanationPanel({ studyPath }: { studyPath: ParsedStudyPath }) {
  const remedial = useRemedialLesson(studyPath.id);

  // The saved remedial content (from the Study Path row), or the one just
  // generated this session.
  const content: RemedialContent | null =
    remedial.generateResult?.content ?? studyPath.remedial?.content ?? null;

  const recommended: RemedialModality =
    remedial.recommendation?.modality ?? studyPath.remedial?.modality ?? "text";

  const [format, setFormat] = useState<RemedialModality | null>(null);
  const activeFormat: RemedialModality = format ?? recommended;

  const recommendedLabel = REMEDIAL_MODALITY_LABEL[recommended];
  const hasContent = !!content;

  // Every format renders the SAME RemedialContent — no format-specific lesson,
  // no extra AI. Both derivations are deterministic + memoised, and change only
  // when the content is regenerated.
  const script = useMemo(() => (content ? remedialContentToScript(content) : ""), [content]);
  const visualModel = useMemo(
    () => (content ? remedialContentToVisualModel(content) : null),
    [content],
  );
  // R5 — the concept-fitted visual, re-validated from the saved lesson
  // (untrusted). null / "concept-map" → the R3 map. Deterministic on revisit.
  const visualSpec = useMemo(
    () => (content ? parseRemedialVisualSpec(content.visual) : null),
    [content],
  );
  // Remounts <RemedialAudioPlayer> (→ stops any narration) when the content changes.
  const audioKey =
    remedial.generateResult?.generatedAt ?? studyPath.remedial?.generatedAt ?? "audio";

  // R4 tracking — the truthful content version, and genuine audio listening
  // seconds fed up from <RemedialAudioPlayer>. All fire-and-forget; nothing
  // here can break the reader / narration / Study Path, and nothing feeds A7.
  const contentVersion =
    remedial.generateResult?.generatedAt ?? studyPath.remedial?.generatedAt ?? null;
  const [audioSpokenSeconds, setAudioSpokenSeconds] = useState(0);
  useEffect(() => {
    setAudioSpokenSeconds(0);
  }, [activeFormat, audioKey]);

  // R6 — an additional embedded remedial video (course video first, then a
  // validated YouTube result). Cached on the Study Path; only searched once the
  // student has generated their explanation. A failure here shows no card and
  // never affects Text/Audio/Visual.
  const video = useRemedialVideo(studyPath.id, { enabled: hasContent });

  const tracking = useRemedialTracking({
    enabled: hasContent,
    studyPathId: studyPath.id,
    content,
    contentVersion,
    activeFormat,
    recommendedFormat: remedial.recommendation?.modality ?? studyPath.remedial?.modality ?? null,
    recommendationSource: remedial.recommendation?.source ?? null,
    audioSpokenSeconds,
  });

  const generateLabel = useMemo(() => {
    if (remedial.generating) return "Generating explanation…";
    if (remedial.generateFailed) return "Try again";
    return hasContent ? "Regenerate explanation" : "Generate explanation";
  }, [remedial.generating, remedial.generateFailed, hasContent]);

  const regenerateButton = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={remedial.generating}
        onClick={() => remedial.generate(true)}
      >
        {remedial.generating ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        Regenerate explanation
      </Button>
    </div>
  );

  return (
    <section
      aria-label="Personalized explanation"
      className="rounded-2xl border border-primary/25 bg-primary/5 p-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl">Personalized explanation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A short, targeted explanation of the weak areas from your quiz — not a summary of the
            whole {studyPath.topic_id ? "module" : "course"}.
          </p>

          {/* Recommended format + toggle */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recommended for you: {recommendedLabel}
            </span>
            <div className="inline-flex rounded-full border border-border bg-background p-0.5">
              {REMEDIAL_MODALITIES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={activeFormat === m}
                  onClick={() => {
                    // R4: a real toggle click that CHANGES the format. Clicking
                    // the already-active tab logs nothing.
                    if (m !== activeFormat) tracking.logFormatSelection(m);
                    setFormat(m);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    activeFormat === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {REMEDIAL_MODALITY_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Format body */}
          <div className="mt-4">
            {!hasContent || !content ? (
              // Nothing generated yet — the SAME content serves every format.
              <div className="space-y-3">
                {activeFormat === "audio" && (
                  <p className="text-sm text-muted-foreground">
                    Generate the personalized explanation first, then you can listen to it here.
                  </p>
                )}
                {activeFormat === "visual" && (
                  <p className="text-sm text-muted-foreground">
                    Generate the personalized explanation first, then you can view the visual
                    learning map.
                  </p>
                )}
                {remedial.generateFailed && (
                  <p className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {remedial.generateErrorMessage ??
                        "That didn't work. Your Study Path is unaffected — try again."}
                    </span>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={remedial.generating} onClick={() => remedial.generate(false)}>
                    {remedial.generating ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-4 w-4" />
                    )}
                    {generateLabel}
                  </Button>
                  {activeFormat !== "text" && (
                    <button
                      type="button"
                      onClick={() => setFormat("text")}
                      className="text-sm font-semibold text-primary underline underline-offset-2"
                    >
                      Switch to text
                    </button>
                  )}
                </div>
              </div>
            ) : activeFormat === "audio" ? (
              <div className="space-y-4">
                <RemedialAudioPlayer
                  key={audioKey}
                  script={script}
                  onSpokenProgress={setAudioSpokenSeconds}
                />
                {regenerateButton}
              </div>
            ) : activeFormat === "visual" && visualModel ? (
              <div className="space-y-4">
                <RemedialVisualView spec={visualSpec} fallbackModel={visualModel} />
                {regenerateButton}
              </div>
            ) : (
              <div className="space-y-4">
                <RemedialContentView content={content} />
                {regenerateButton}
              </div>
            )}
          </div>

          {/* R6 — additional embedded video resource, for every format. */}
          {hasContent && (
            <RemedialVideoCard
              recommendation={video.recommendation}
              searchUnavailable={video.searchUnavailable}
              loading={video.loading}
              onRefresh={video.refresh}
              refreshing={video.refreshing}
            />
          )}
        </div>
      </div>
    </section>
  );
}
