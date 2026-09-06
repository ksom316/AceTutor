/**
 * R6 — deterministic, conservative relevance scoring for remedial video
 * candidates (course lessons first, then real YouTube results).
 *
 * No AI is required to choose a video: a keyword-overlap scorer decides.
 * "Relevant" means the candidate's own text visibly covers the weak concepts
 * and topic the Study Path identified — popularity is never a factor, and a
 * course video is only preferred when it clears the SAME evidence bar.
 *
 * Pure — no React, no network, no `window`.
 */

import {
  extractYouTubeId,
  type RemedialVideoRecommendation,
  type RemedialVideoSource,
} from "@/lib/remedial-video";

const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have in into is it its of on or that the to " +
    "with your you this these those what which how why when where introduction overview basics " +
    "video tutorial explained lesson lecture part full course module topic concept concepts"
  )
    .split(" ")
    .filter(Boolean),
);

/** Significant lowercased terms (letters/digits, length ≥ 3, not a stopword). */
export function significantTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
}

/** The concept vocabulary a candidate is scored against. */
export function conceptVocabulary(input: { topicTitle: string; weakConcepts: string[] }): string[] {
  const terms = new Set<string>();
  for (const t of significantTerms(input.topicTitle)) terms.add(t);
  for (const c of input.weakConcepts) for (const t of significantTerms(c)) terms.add(t);
  return [...terms];
}

/**
 * Fraction (0–1) of the concept vocabulary that appears in the candidate text,
 * with a small bonus for covering a distinct weak-concept PHRASE. Deterministic.
 */
export function scoreVideoRelevance(input: {
  candidateText: string;
  topicTitle: string;
  weakConcepts: string[];
}): number {
  const vocab = conceptVocabulary({
    topicTitle: input.topicTitle,
    weakConcepts: input.weakConcepts,
  });
  if (vocab.length === 0) return 0;

  const haystack = new Set(significantTerms(input.candidateText));
  if (haystack.size === 0) return 0;

  const matched = vocab.filter((t) => haystack.has(t)).length;
  const base = matched / vocab.length;

  // reward a candidate that covers a whole weak-concept's key terms, not just
  // scattered topic words.
  let phraseBonus = 0;
  for (const concept of input.weakConcepts) {
    const cTerms = significantTerms(concept);
    if (cTerms.length > 0 && cTerms.every((t) => haystack.has(t))) {
      phraseBonus = 0.15;
      break;
    }
  }
  return Math.min(1, base + phraseBonus);
}

export type VideoCandidate = {
  videoId: string;
  title: string;
  channelTitle?: string;
  durationSeconds?: number;
  /** provider description / lesson body — extra text for scoring only. */
  description?: string;
  /** provider says the video may be embedded off-site. Course lessons are
   *  always embeddable (the lecturer chose the embed URL). */
  embeddable?: boolean;
};

/** Minimum relevance for a video to be recommended at all — conservative. */
export const REMEDIAL_VIDEO_MIN_RELEVANCE = 0.34;
/** Course videos must clear the same bar (no free pass) but are preferred on ties. */
export const REMEDIAL_VIDEO_COURSE_MIN_RELEVANCE = 0.34;
/** Below this many seconds a "video" is almost certainly not a lesson; above
 *  the upper bound it is a stream/playlist artefact. Only applied when a real
 *  duration is present — never fabricated. */
export const REMEDIAL_VIDEO_MIN_SECONDS = 60;
export const REMEDIAL_VIDEO_MAX_SECONDS = 3 * 60 * 60;

function durationAcceptable(seconds: number | undefined): boolean {
  if (seconds == null) return true; // unknown — don't penalise
  return seconds >= REMEDIAL_VIDEO_MIN_SECONDS && seconds <= REMEDIAL_VIDEO_MAX_SECONDS;
}

function matchedConceptLabel(input: {
  candidateText: string;
  weakConcepts: string[];
}): string | null {
  const haystack = new Set(significantTerms(input.candidateText));
  for (const concept of input.weakConcepts) {
    const cTerms = significantTerms(concept);
    if (cTerms.length > 0 && cTerms.some((t) => haystack.has(t))) return concept;
  }
  return null;
}

/**
 * Rank a candidate list and return the single best recommendation, or null.
 * `source` labels where the candidates came from; the relevance bar and the
 * "why" copy differ slightly but the scoring is identical.
 */
export function pickBestVideo(input: {
  candidates: readonly VideoCandidate[];
  topicTitle: string;
  weakConcepts: string[];
  source: RemedialVideoSource;
  minRelevance?: number;
}): RemedialVideoRecommendation | null {
  const min =
    input.minRelevance ??
    (input.source === "course"
      ? REMEDIAL_VIDEO_COURSE_MIN_RELEVANCE
      : REMEDIAL_VIDEO_MIN_RELEVANCE);

  const scored = input.candidates
    .filter((c) => /^[A-Za-z0-9_-]{11}$/.test(c.videoId))
    .filter((c) => c.embeddable !== false)
    .filter((c) => typeof c.title === "string" && c.title.trim().length > 0)
    .filter((c) => durationAcceptable(c.durationSeconds))
    .map((c, i) => ({
      c,
      i,
      score: scoreVideoRelevance({
        candidateText: `${c.title} ${c.description ?? ""}`,
        topicTitle: input.topicTitle,
        weakConcepts: input.weakConcepts,
      }),
    }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const best = scored[0];
  if (!best) return null;

  const concept = matchedConceptLabel({
    candidateText: `${best.c.title} ${best.c.description ?? ""}`,
    weakConcepts: input.weakConcepts,
  });
  const reason =
    input.source === "course"
      ? `This ${input.topicTitle} course video covers ${
          concept ? `“${concept}”` : "material"
        }, one of the weak areas identified from your quiz.`
      : `This covers ${
          concept ? `“${concept}”` : "the weak concepts"
        }, one of the areas identified from your quiz. It's an external YouTube result, not lecturer-provided.`;

  return {
    videoId: best.c.videoId,
    title: best.c.title.trim().slice(0, 200),
    channelTitle: best.c.channelTitle?.trim().slice(0, 120) || undefined,
    durationSeconds: best.c.durationSeconds,
    source: input.source,
    reason: reason.slice(0, 400),
  };
}

/** Build course-lesson candidates: only YouTube-embedded video lessons, id
 *  extracted with the shared parser (a non-YouTube media_url is skipped). */
export function courseVideoCandidates(
  lessons: readonly {
    modality: string;
    title: string;
    body_md: string | null;
    media_url: string | null;
    duration_sec: number | null;
  }[],
): VideoCandidate[] {
  const out: VideoCandidate[] = [];
  for (const l of lessons) {
    if (l.modality !== "video" || !l.media_url) continue;
    const id = extractYouTubeId(l.media_url);
    if (!id) continue;
    out.push({
      videoId: id,
      title: l.title,
      description: l.body_md ?? "",
      durationSeconds: l.duration_sec ?? undefined,
      embeddable: true,
    });
  }
  return out;
}
