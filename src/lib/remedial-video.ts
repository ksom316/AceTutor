/**
 * R6 — Embedded Video Remedial Recommendations.
 *
 * A strict typed model for ONE recommended remedial video shown inside the
 * Study Path. We only ever store a canonical YouTube video id (11 chars) plus
 * validated metadata — never iframe HTML, never an arbitrary embed URL, never
 * a non-YouTube host.
 *
 * Priority the server applies:
 *   1. a course/lecturer video for the same topic that is genuinely relevant
 *      to the weak concepts  (source: "course")
 *   2. otherwise a validated real YouTube Data API result  (source: "youtube")
 *   3. otherwise nothing — no card, never a fabricated link.
 *
 * Video is an ADDITIONAL resource. It does not replace Text/Audio/Visual and
 * does not touch VARK / A7 / Learning Preferences / Mastery / grading.
 *
 * Pure — no React, no network, no `window`.
 */

import { z } from "zod";

/** YouTube video ids are exactly 11 chars of [A-Za-z0-9_-]. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const REMEDIAL_VIDEO_SOURCES = ["course", "youtube"] as const;
export type RemedialVideoSource = (typeof REMEDIAL_VIDEO_SOURCES)[number];

export const remedialVideoRecommendationSchema = z.object({
  videoId: z.string().regex(YOUTUBE_ID_RE),
  title: z.string().trim().min(1).max(200),
  channelTitle: z.string().trim().min(1).max(120).optional(),
  /** 1 s … 24 h. Never fabricated — only set when the provider reports it. */
  durationSeconds: z.number().int().min(1).max(86_400).optional(),
  source: z.enum(REMEDIAL_VIDEO_SOURCES),
  reason: z.string().trim().min(1).max(400),
  /** ISO timestamp the recommendation was chosen — cache/version marker. */
  recommendedAt: z.string().optional(),
});

export type RemedialVideoRecommendation = z.infer<typeof remedialVideoRecommendationSchema>;

/** What a persisted `study_paths.remedial_video` resolves to:
 *  - a recommendation, or
 *  - `null` meaning "we searched and found nothing suitable" (still cached, so
 *    the Study Path does not re-search on every render). */
export type RemedialVideoState = RemedialVideoRecommendation | null;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

/**
 * Extract a canonical 11-char video id from a YouTube URL (watch, embed,
 * short, nocookie) or a bare id. Returns null for any other host or shape —
 * this is the gate that stops arbitrary domains / embed URLs entering the app.
 */
export function extractYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (YOUTUBE_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  // youtu.be/<id>
  if (url.hostname.toLowerCase() === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YOUTUBE_ID_RE.test(id) ? id : null;
  }

  // youtube.com/watch?v=<id>
  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID_RE.test(v)) return v;

  // youtube.com/embed/<id> | /shorts/<id> | /live/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
    return YOUTUBE_ID_RE.test(parts[1]) ? parts[1] : null;
  }
  return null;
}

/**
 * The ONLY way an embed URL is built: from a validated id, always
 * privacy-enhanced, no autoplay. Throws on a bad id so a caller can never
 * accidentally embed unvalidated input.
 */
export function buildYouTubeEmbedUrl(videoId: string): string {
  if (!YOUTUBE_ID_RE.test(videoId)) {
    throw new Error("INVALID_YOUTUBE_ID");
  }
  // rel=0 keeps "related" videos to the same channel; modestbranding trims the
  // YouTube chrome. Playback is user-initiated — no auto-start parameter.
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
}

export function watchUrl(videoId: string): string {
  if (!YOUTUBE_ID_RE.test(videoId)) throw new Error("INVALID_YOUTUBE_ID");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Parse an untrusted persisted / provider value into a recommendation, or null. */
export function parseRemedialVideoRecommendation(raw: unknown): RemedialVideoRecommendation | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const res = remedialVideoRecommendationSchema.safeParse(raw);
  return res.success ? res.data : null;
}

/** Human-readable "MM:SS" / "H:MM:SS" for a duration, or null. */
export function formatVideoDuration(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Parse an ISO-8601 duration ("PT1H2M10S") to seconds. Returns null when
 *  absent or unparseable — never guesses. */
export function parseIso8601Duration(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== "string") return null;
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (!m) return null;
  const [, d, h, min, s] = m;
  const total =
    Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total : null;
}
