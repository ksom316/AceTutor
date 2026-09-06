import { supabase } from "@/integrations/supabase/client";
import type { RemedialModality, RemedialModalitySource } from "@/lib/remedial-modality";

/**
 * R4 — fire-and-forget writer for remedial-intervention evidence.
 *
 * The DB function `log_remedial_interaction` (SECURITY DEFINER) is the sole
 * authority: it re-checks Study Path ownership, derives topic/course and the
 * content version from the row (never the client), constrains the event type
 * and format, and dedups `remedial_meaningful_engagement` via a partial unique
 * index. `remedial_*` events are also blocked from direct client inserts by the
 * RLS insert policy, exactly like `official_quiz_completed`.
 *
 * NEVER throws — §9: a tracking failure must never stop narration, block a tab
 * switch, or break the Study Path.
 */
export async function logRemedialInteraction(input: {
  studyPathId: string;
  eventType: "remedial_format_selected" | "remedial_meaningful_engagement";
  format: RemedialModality;
  recommendedFormat: RemedialModality | null;
  // R8.3 — 'history' joins the existing sources once the personal remedial
  // history engine drives the recommendation. The RPC + CHECK constraint
  // accept it (20260915120000). A7 still only ever writes 'vark' / 'adaptive'.
  recommendationSource: RemedialModalitySource | "history" | null;
}): Promise<void> {
  try {
    const { error } = await supabase.rpc("log_remedial_interaction", {
      _study_path_id: input.studyPathId,
      _event_type: input.eventType,
      _remedial_format: input.format,
      _recommended_format: input.recommendedFormat,
      _recommendation_source: input.recommendationSource,
    });
    if (error) {
      console.error(`[logRemedialInteraction] ${input.eventType} failed: ${error.message}`);
    }
  } catch (e) {
    console.error(
      `[logRemedialInteraction] ${input.eventType} threw: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}
