import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { studyPathContentSchema } from "@/lib/study-path.functions";
import { loadOwnStudyPath } from "@/lib/remedial.functions";
import {
  parseRemedialVideoRecommendation,
  remedialVideoRecommendationSchema,
  type RemedialVideoState,
} from "@/lib/remedial-video";
import { courseVideoCandidates, pickBestVideo } from "@/lib/remedial-video-ranking";
import {
  buildVideoSearchQuery,
  searchYouTubeVideos,
  youtubeApiConfigured,
} from "@/lib/remedial-video-search";

/**
 * R6 — the recommended remedial VIDEO for a Study Path.
 *
 * Priority: a relevant course/lecturer video for the same topic → a validated
 * real YouTube Data API result → nothing. Cached on the Study Path row; a
 * search only runs on first request or an explicit refresh. Failure here NEVER
 * affects Text/Audio/Visual remediation — the caller just shows no card.
 *
 * Security: `studyPathId` is the only meaningful client input. The row loads
 * through the RLS-scoped client with an explicit `user_id` re-check; course,
 * topic and weak concepts are all derived server-side. The caller must be an
 * authenticated ESTABLISHED student. The YouTube API key is server-only.
 */

export const REMEDIAL_VIDEO_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to see a recommended video.",
  NOT_AN_ESTABLISHED_STUDENT: "Only enrolled students get remedial video recommendations.",
  STUDY_PATH_NOT_FOUND: "We couldn't find that Study Path.",
  STUDY_PATH_NOT_OWNED: "That Study Path isn't yours.",
  STUDY_PATH_INVALID: "That Study Path's content can't be read.",
  SAVE_FAILED: "The recommendation was found but couldn't be saved.",
};
const CODES = new Set(Object.keys(REMEDIAL_VIDEO_ERRORS));

export function remedialVideoErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return CODES.has(raw) ? REMEDIAL_VIDEO_ERRORS[raw] : "";
}

async function requireEstablishedStudent(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .from("user_roles")
    .select("role, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.role !== "student" || data.status !== "established") {
    throw new Error("NOT_AN_ESTABLISHED_STUDENT");
  }
}

export type RemedialVideoResult = {
  status: "existing" | "created";
  /** the recommendation, or null when there is genuinely no suitable video. */
  recommendation: RemedialVideoState;
  /** true when a YouTube search could not run (no key / quota / upstream) AND
   *  no course video was found — the UI shows a calm "no video" state. */
  searchUnavailable: boolean;
  generatedAt: string | null;
};

const input = z.object({
  studyPathId: z.string().uuid(),
  refresh: z.boolean().optional(),
});

export const getRemedialVideoRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }): Promise<RemedialVideoResult> => {
    const { supabase, userId } = context;
    await requireEstablishedStudent(supabase, userId);

    const { row } = await loadOwnStudyPath(supabase, userId, data.studyPathId);

    // --- cache: reuse unless an explicit refresh was asked for ---
    if (!data.refresh && row.remedial_video_generated_at) {
      return {
        status: "existing",
        recommendation: parseRemedialVideoRecommendation(row.remedial_video),
        searchUnavailable: false,
        generatedAt: row.remedial_video_generated_at,
      };
    }

    const parsedContent = studyPathContentSchema.safeParse(row.content);
    if (!parsedContent.success) throw new Error("STUDY_PATH_INVALID");
    const weakConcepts = parsedContent.data.weakAreas.map((a) => a.title);

    // --- context (server-derived) ---
    let topicTitle = parsedContent.data.title;
    let lessons: {
      modality: string;
      title: string;
      body_md: string | null;
      media_url: string | null;
      duration_sec: number | null;
    }[] = [];

    if (row.topic_id) {
      const [{ data: topic }, { data: topicLessons }] = await Promise.all([
        supabase.from("topics").select("title, course_id").eq("id", row.topic_id).maybeSingle(),
        supabase
          .from("lessons")
          .select("modality, title, body_md, media_url, duration_sec")
          .eq("topic_id", row.topic_id),
      ]);
      if (topic?.title) topicTitle = topic.title;
      lessons = (topicLessons ?? []) as typeof lessons;
    } else {
      const [{ data: course }, { data: courseLessons }] = await Promise.all([
        supabase.from("courses").select("title").eq("id", row.course_id).maybeSingle(),
        supabase
          .from("lessons")
          .select("modality, title, body_md, media_url, duration_sec, topics!inner(course_id)")
          .eq("topics.course_id", row.course_id),
      ]);
      if (course?.title) topicTitle = course.title;
      lessons = (courseLessons ?? []) as unknown as typeof lessons;
    }

    // --- 1. course / lecturer video first ---
    let recommendation: RemedialVideoState = pickBestVideo({
      candidates: courseVideoCandidates(lessons),
      topicTitle,
      weakConcepts,
      source: "course",
    });

    // --- 2. external YouTube fallback (real results only) ---
    let searchUnavailable = false;
    if (!recommendation) {
      if (!youtubeApiConfigured()) {
        searchUnavailable = true;
      } else {
        const candidates = await searchYouTubeVideos(
          buildVideoSearchQuery({ topicTitle, weakConcepts }),
        );
        if (candidates.length === 0) {
          searchUnavailable = true;
        } else {
          recommendation = pickBestVideo({
            candidates,
            topicTitle,
            weakConcepts,
            source: "youtube",
          });
        }
      }
    }

    // --- validate + stamp, then persist (recommendation may be null) ---
    if (recommendation) {
      recommendation = { ...recommendation, recommendedAt: new Date().toISOString() };
      const check = remedialVideoRecommendationSchema.safeParse(recommendation);
      recommendation = check.success ? check.data : null;
    }

    const { error: saveErr } = await supabase.rpc("save_study_path_remedial_video", {
      _study_path_id: row.id,
      _video: (recommendation ??
        null) as Database["public"]["Tables"]["study_paths"]["Row"]["remedial_video"],
    });
    if (saveErr) {
      const code = (saveErr.message || "").trim();
      throw new Error(CODES.has(code) ? code : "SAVE_FAILED");
    }

    return {
      status: "created",
      recommendation,
      searchUnavailable: searchUnavailable && !recommendation,
      generatedAt: new Date().toISOString(),
    };
  });
