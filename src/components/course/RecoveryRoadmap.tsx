import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { remedialContentToScript, type RemedialContent } from "@/lib/remedial-content";
import {
  REMEDIAL_MODALITIES,
  REMEDIAL_MODALITY_LABEL,
  type RemedialModality,
} from "@/lib/remedial-modality";
import { remedialRecommendationExplanation } from "@/lib/remedial-recommendation-copy";
import { remedialContentToVisualModel, type RemedialVisualModel } from "@/lib/remedial-visual";
import { parseRemedialVisualSpec, type RemedialVisualSpec } from "@/lib/remedial-visual-spec";
import { useRemedialLesson } from "@/hooks/use-remedial-lesson";
import { useRemedialTracking } from "@/hooks/use-remedial-tracking";
import { useRemedialVideo } from "@/hooks/use-remedial-video";
import type { ParsedStudyPath } from "@/hooks/use-study-path";
import type { WeakArea } from "@/lib/study-path.functions";
import { GuidedReader, type ReaderSection } from "@/components/course/GuidedReader";
import { RemedialAudioPlayer } from "@/components/course/RemedialAudioPlayer";
import { RemedialVisualView } from "@/components/course/RemedialVisualSpec";
import { RemedialVideoCard } from "@/components/course/RemedialVideoCard";

/* ------------------------------------------------------------------ *
 * RecoveryRoadmap — the ONE learning area on the Study Path page.
 *
 * Personalization decides HOW the roadmap is delivered (the Text / Audio /
 * Visual selector, driven by the R8.2 recommendation); the roadmap decides
 * WHAT is learned (one step per weak concept, from the ONE saved
 * `RemedialContent` — there is no second lesson). Every renderer is
 * deterministic and reuses the existing R1–R6 components: no AI call, no
 * server write, no browser storage. R4 tracking, the recommendation and the
 * R6 video card are wired exactly as the old panel wired them.
 * ------------------------------------------------------------------ */

function SelfCheckItem({ question, answer }: { question: string; answer: string }) {
  return (
    <li className="rounded-lg border border-border p-3">
      <p className="text-sm">{question}</p>
      <Collapsible className="mt-2">
        <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          <span className="group-data-[state=open]:hidden">Show answer</span>
          <span className="hidden group-data-[state=open]:inline">Hide answer</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-lg bg-success/10 p-2.5 text-sm text-foreground">
          {answer}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function ConceptSelfCheck({ area }: { area: WeakArea | null }) {
  if (!area || area.practice.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Quick self-check
      </p>
      <ul className="mt-2 space-y-2">
        {area.practice.map((item, i) => (
          <SelfCheckItem key={i} question={item.question} answer={item.answer} />
        ))}
      </ul>
    </div>
  );
}

/** The Study Path weak area that carries the self-check for a given concept —
 *  matched by title, then falling back to position. Both lists come from the
 *  same generation, so they normally line up. */
function selfCheckArea(
  concept: string,
  index: number,
  areas: readonly WeakArea[],
): WeakArea | null {
  const key = concept.trim().toLowerCase();
  return areas.find((a) => a.title.trim().toLowerCase() === key) ?? areas[index] ?? null;
}

/** One roadmap step: a single weak concept, rendered in the selected format
 *  from the SAME `RemedialContent`. */
function RoadmapConceptStep({
  concept,
  index,
  total,
  content,
  activeFormat,
  audioKey,
  script,
  visualModel,
  visualSpec,
  selfCheck,
  onAudioProgress,
}: {
  concept: string;
  index: number;
  total: number;
  content: RemedialContent;
  activeFormat: RemedialModality;
  audioKey: string;
  script: string;
  visualModel: RemedialVisualModel | null;
  visualSpec: RemedialVisualSpec | null;
  selfCheck: WeakArea | null;
  onAudioProgress: (spokenSeconds: number) => void;
}) {
  const isFirst = index === 0;
  const isLast = index === total - 1;

  if (activeFormat === "audio") {
    return (
      <div className="space-y-4">
        <RemedialAudioPlayer key={audioKey} script={script} onSpokenProgress={onAudioProgress} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transcript
          </p>
          <div className="prose-lesson mt-1.5 max-w-none break-words text-foreground">
            <ReactMarkdown>{content.explanation}</ReactMarkdown>
          </div>
          {content.workedExample && (
            <div className="prose-lesson mt-3 max-w-none break-words rounded-lg bg-muted/60 p-4 text-foreground">
              <ReactMarkdown>{content.workedExample}</ReactMarkdown>
            </div>
          )}
        </div>
        <ConceptSelfCheck area={selfCheck} />
      </div>
    );
  }

  if (activeFormat === "visual") {
    return (
      <div className="space-y-4">
        {visualModel ? (
          <RemedialVisualView spec={visualSpec} fallbackModel={visualModel} />
        ) : (
          <p className="text-sm text-muted-foreground">
            A visual map isn&apos;t available for this roadmap.
          </p>
        )}
        <ConceptSelfCheck area={selfCheck} />
      </div>
    );
  }

  // Text
  return (
    <div className="space-y-5">
      {isFirst ? (
        <>
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
        </>
      ) : (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          The full explanation and worked example are on step 1. This step is your practice for{" "}
          <span className="font-medium text-foreground">{concept}</span>.
        </p>
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

      <ConceptSelfCheck area={selfCheck} />

      {isLast && content.practicePrompt && (
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

export function RecoveryRoadmap({
  studyPath,
  completion,
}: {
  studyPath: ParsedStudyPath;
  /** The completion-step actions (Retake / Mark complete / Remove), built by
   *  the page so quiz + navigation + Mastery wording stay in one place. */
  completion: ReactNode;
}) {
  const remedial = useRemedialLesson(studyPath.id);

  // The saved roadmap content (from the Study Path row) or the one just built.
  const content: RemedialContent | null =
    remedial.generateResult?.content ?? studyPath.remedial?.content ?? null;

  const recommended: RemedialModality =
    remedial.recommendation?.modality ?? studyPath.remedial?.modality ?? "text";

  const [format, setFormat] = useState<RemedialModality | null>(null);
  const activeFormat: RemedialModality = format ?? recommended;
  const recommendedLabel = REMEDIAL_MODALITY_LABEL[recommended];
  const hasContent = !!content;

  // Observational "why this format" line, keyed on the R8.2 source. Read-only.
  const recExplanation = remedial.recommendation
    ? remedialRecommendationExplanation(remedial.recommendation.source, recommended)
    : null;

  // Deterministic, memoised derivations of the SAME content — no extra AI.
  const script = useMemo(() => (content ? remedialContentToScript(content) : ""), [content]);
  const visualModel = useMemo(
    () => (content ? remedialContentToVisualModel(content) : null),
    [content],
  );
  const visualSpec = useMemo(
    () => (content ? parseRemedialVisualSpec(content.visual) : null),
    [content],
  );

  const contentVersion =
    remedial.generateResult?.generatedAt ?? studyPath.remedial?.generatedAt ?? null;
  // Remounts <RemedialAudioPlayer> (→ stops narration) when the roadmap is rebuilt.
  const audioKey =
    remedial.generateResult?.generatedAt ?? studyPath.remedial?.generatedAt ?? "audio";
  const [audioSpokenSeconds, setAudioSpokenSeconds] = useState(0);
  useEffect(() => {
    setAudioSpokenSeconds(0);
  }, [activeFormat, audioKey]);

  // R4 tracking — fire-and-forget, fed the recommended format + source. Nothing
  // here can break the roadmap and nothing feeds A7.
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

  // R6 — an additional embedded video, once the roadmap exists.
  const video = useRemedialVideo(studyPath.id, { enabled: hasContent });

  const areas = studyPath.content.weakAreas;
  const concepts = content ? content.weakConcepts : [];

  const formatSelector = (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          {recExplanation?.badge ?? "Recommended for you"}: {recommendedLabel}
        </span>
        <div className="inline-flex rounded-full border border-border bg-background p-0.5">
          {REMEDIAL_MODALITIES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={activeFormat === m}
              aria-label={
                m === recommended
                  ? `${REMEDIAL_MODALITY_LABEL[m]} delivery (recommended for you)`
                  : `${REMEDIAL_MODALITY_LABEL[m]} delivery`
              }
              onClick={() => {
                // R4: a real toggle click that CHANGES the delivery format.
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
              {m === recommended && <span aria-hidden> ✓</span>}
            </button>
          ))}
        </div>
      </div>
      {recExplanation && <p className="text-xs text-muted-foreground">{recExplanation.detail}</p>}
      <p className="text-xs text-muted-foreground/80">
        Personalization decides how your roadmap is delivered — the concepts you review are the same
        in every format.
      </p>
    </div>
  );

  // --- The roadmap needs its content generated once (cached on the Study Path). ---
  if (!hasContent || !content) {
    return (
      <section
        aria-label="Your Recovery Roadmap"
        className="rounded-2xl border border-primary/25 bg-primary/5 p-6"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl">Your Recovery Roadmap</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              AceTutor turns the concepts you missed on the quiz into a short, step-by-step review —
              one step per weak concept, delivered in your recommended format. Build it once; it is
              saved to this Study Path.
            </p>
            {formatSelector}
            <div className="mt-4 space-y-3">
              {remedial.generateFailed && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {remedial.generateErrorMessage ??
                      "We couldn't build your roadmap just now. Your Study Path is safe — try again in a moment."}
                  </span>
                </p>
              )}
              <Button disabled={remedial.generating} onClick={() => remedial.generate(false)}>
                {remedial.generating ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                {remedial.generating
                  ? "Building your roadmap…"
                  : remedial.generateFailed
                    ? "Try again"
                    : "Build my Recovery Roadmap"}
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const regenerateButton = (
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
      Regenerate roadmap
    </Button>
  );

  const sections: ReaderSection[] = [
    ...concepts.map(
      (concept, i): ReaderSection => ({
        key: `concept-${i}`,
        heading: concept,
        body: (
          <RoadmapConceptStep
            concept={concept}
            index={i}
            total={concepts.length}
            content={content}
            activeFormat={activeFormat}
            audioKey={audioKey}
            script={script}
            visualModel={visualModel}
            visualSpec={visualSpec}
            selfCheck={selfCheckArea(concept, i, areas)}
            onAudioProgress={setAudioSpokenSeconds}
          />
        ),
      }),
    ),
    {
      key: "roadmap-complete",
      heading: "Recovery Roadmap Complete",
      body: (
        <div className="space-y-4">
          {content.keyPoints.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Key takeaways
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
          )}
          {completion}
        </div>
      ),
    },
  ];

  return (
    <section
      aria-label="Your Recovery Roadmap"
      className="rounded-2xl border border-primary/25 bg-primary/5 p-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl">Your Recovery Roadmap</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Step through the {concepts.length} concept{concepts.length === 1 ? "" : "s"} from your
            quiz mistakes one at a time — this is the review, there is no separate lesson — then
            retake the official quiz.
          </p>
          {formatSelector}

          <div className="mt-4">
            <GuidedReader
              sections={sections}
              resetKey={`${studyPath.id}:${audioKey}`}
              ariaLabel="Recovery Roadmap — one concept at a time"
              stepWord="Step"
            />
          </div>
          <div className="mt-3">{regenerateButton}</div>

          {/* R6 — additional embedded video resource for the roadmap. */}
          <RemedialVideoCard
            recommendation={video.recommendation}
            searchUnavailable={video.searchUnavailable}
            loading={video.loading}
            onRefresh={video.refresh}
            refreshing={video.refreshing}
          />
        </div>
      </div>
    </section>
  );
}
