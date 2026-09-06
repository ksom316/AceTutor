import { ExternalLink, GraduationCap, Loader2, RefreshCw, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildYouTubeEmbedUrl,
  formatVideoDuration,
  watchUrl,
  YOUTUBE_ID_RE,
  type RemedialVideoRecommendation,
} from "@/lib/remedial-video";

/**
 * R6 — the "Recommended video" section on the Study Path.
 *
 * The video plays embedded (privacy-enhanced youtube-nocookie, no autoplay,
 * fullscreen allowed). The embed URL is built ONLY from a validated 11-char id
 * — never from database/AI HTML. An invalid id, or no recommendation, renders a
 * calm empty state; nothing here can break Text/Audio/Visual remediation.
 */
export function RemedialVideoCard({
  recommendation,
  searchUnavailable,
  loading,
  onRefresh,
  refreshing,
}: {
  recommendation: RemedialVideoRecommendation | null;
  searchUnavailable: boolean;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (loading) {
    return (
      <section aria-label="Recommended video" className="mt-6 border-t border-border pt-5">
        <h3 className="font-display text-lg">Recommended video</h3>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Finding a relevant video…
        </div>
      </section>
    );
  }

  const validId = recommendation && YOUTUBE_ID_RE.test(recommendation.videoId);

  if (!recommendation || !validId) {
    return (
      <section aria-label="Recommended video" className="mt-6 border-t border-border pt-5">
        <h3 className="font-display text-lg">Recommended video</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {searchUnavailable
            ? "No video recommendation is available right now. Your text, audio and visual explanations are unaffected."
            : "We didn't find a video that clearly matches your weak areas. Your text, audio and visual explanations cover them."}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-2 disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Look again
        </button>
      </section>
    );
  }

  const isCourse = recommendation.source === "course";
  const duration = formatVideoDuration(recommendation.durationSeconds);
  const embedUrl = buildYouTubeEmbedUrl(recommendation.videoId);

  return (
    <section aria-label="Recommended video" className="mt-6 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg">Recommended video</h3>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Suggest another
        </Button>
      </div>

      <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-sm">
        <iframe
          src={embedUrl}
          title={`Recommended video: ${recommendation.title}`}
          className="h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
        />
      </div>

      <div className="mt-3 space-y-2">
        <p className="font-medium text-foreground">{recommendation.title}</p>
        {(recommendation.channelTitle || duration) && (
          <p className="text-sm text-muted-foreground">
            {[recommendation.channelTitle, duration].filter(Boolean).join(" · ")}
          </p>
        )}

        <div
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium " +
            (isCourse
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-muted/60 text-muted-foreground")
          }
        >
          {isCourse ? (
            <>
              <GraduationCap className="h-3.5 w-3.5" aria-hidden />
              Course material
            </>
          ) : (
            <>
              <Youtube className="h-3.5 w-3.5" aria-hidden />
              YouTube recommendation
            </>
          )}
        </div>
        {!isCourse && (
          <p className="text-xs text-muted-foreground">
            An external result AceTutor found — not reviewed or endorsed by your lecturer.
          </p>
        )}

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why AceTutor recommends this
          </p>
          <p className="mt-1 text-sm text-foreground">{recommendation.reason}</p>
        </div>

        <a
          href={watchUrl(recommendation.videoId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Open on YouTube <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
    </section>
  );
}
