import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LessonModality } from "@/lib/lesson-shared";
import type { VarkCategory } from "@/lib/vark";
import {
  resolveEffectiveVarkCategory,
  resolveVarkContentRecommendation,
} from "@/lib/vark-content-recommendation";
import {
  buildModalityEvidence,
  computeAdaptiveModalityRecommendation,
  type AdaptiveModalityRecommendation,
} from "@/lib/adaptive-modality";

/**
 * Phase A7 — server-side adaptive modality recommendation for one topic.
 *
 * Reads ONLY the calling student's own data (RLS + explicit
 * `.eq("user_id", context.userId)` — the client-supplied topicId is the only
 * input; user_id is never trusted from the client) and returns just the tiny
 * final recommendation object. The student's raw interaction history never
 * crosses to the browser.
 *
 * If this throws or a query fails, the caller (topic.$topicId.tsx) falls back
 * to the client-side A4 VARK recommendation — a failure here can never break
 * the topic page or hide content.
 */

const inputSchema = z.object({ topicId: z.string().uuid() });

const MAX_ROWS = 2000; // generous safety cap; a real student has far fewer

export const getAdaptiveModalityRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AdaptiveModalityRecommendation> => {
    const { supabase, userId } = context;

    const [{ data: lessons }, { data: profile }, { data: outcomeRows }, { data: interactionRows }] =
      await Promise.all([
        supabase.from("lessons").select("modality").eq("topic_id", data.topicId),
        supabase
          .from("vark_profiles")
          .select("ml_predicted_category, predicted_category")
          .eq("user_id", userId)
          .maybeSingle(),
        // Explicit, deterministic ordering: most-recent first, id as a
        // stable tiebreak, so if a very heavy student ever hits MAX_ROWS the
        // cap keeps their RECENT history (the relevant part) rather than an
        // unspecified slice. buildModalityEvidence re-sorts ascending
        // internally, so the aggregation result itself is order-independent.
        supabase
          .from("learning_interactions")
          .select("topic_id, score_percent, created_at")
          .eq("user_id", userId)
          .eq("event_type", "official_quiz_completed")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(MAX_ROWS),
        supabase
          .from("learning_interactions")
          .select("topic_id, modality, created_at")
          .eq("user_id", userId)
          .in("event_type", ["modality_selected", "lesson_opened"])
          .not("modality", "is", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(MAX_ROWS),
      ]);

    const availableModalities = [
      ...new Set(
        (lessons ?? [])
          .map((l) => l.modality as LessonModality | null)
          .filter((m): m is LessonModality => m != null),
      ),
    ];

    // The DB CHECK constraint already restricts these columns to the four
    // VARK categories or null — narrow the generated `string | null` type.
    const effectiveVarkCategory = resolveEffectiveVarkCategory(
      profile
        ? {
            ml_predicted_category: profile.ml_predicted_category as VarkCategory | null,
            predicted_category: profile.predicted_category as VarkCategory | null,
          }
        : null,
    );

    const outcomes = (outcomeRows ?? [])
      .filter(
        (r): r is { topic_id: string; score_percent: number; created_at: string } =>
          typeof r.topic_id === "string" &&
          typeof r.score_percent === "number" &&
          typeof r.created_at === "string",
      )
      .map((r) => ({
        topic_id: r.topic_id,
        score_percent: r.score_percent,
        created_at: r.created_at,
      }));

    const interactions = (interactionRows ?? [])
      .filter(
        (r): r is { topic_id: string; modality: LessonModality; created_at: string } =>
          typeof r.topic_id === "string" &&
          typeof r.modality === "string" &&
          typeof r.created_at === "string",
      )
      .map((r) => ({
        topic_id: r.topic_id,
        modality: r.modality,
        created_at: r.created_at,
      }));

    const evidence = buildModalityEvidence(outcomes, interactions);
    const varkRecommendation = resolveVarkContentRecommendation(
      effectiveVarkCategory,
      availableModalities,
    );

    return computeAdaptiveModalityRecommendation({
      varkRecommendation,
      effectiveVarkCategory,
      availableModalities,
      evidence,
    });
  });
