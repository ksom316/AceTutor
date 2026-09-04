import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  computeVarkScores,
  derivePrimaryVarkCategory,
  varkAssessmentStatus,
  type VarkProfileRow,
  type VarkResponses,
} from "@/lib/vark";

const VARK_PROFILE_KEY = "vark-profile";

const SELECT_COLUMNS =
  "user_id, responses, visual_score, auditory_score, read_write_score, kinesthetic_score, predicted_category, prediction_source, prediction_confidence, model_version, assessment_completed_at, updated_at";

/**
 * The signed-in student's VARK profile — the other half of the "learner
 * profile" alongside Learning Preferences (which has no shared hook yet; see
 * onboarding.preferences.tsx). One React Query cache entry
 * (`["vark-profile", userId]`), reused by both the assessment route and any
 * later phase (Mastery-aware recommendations, ML re-prediction, …) that needs
 * to read the current VARK scores/category without re-querying Supabase.
 *
 * Writes go through `submit`, which computes scores/category from the raw
 * responses with the SAME pure functions the UI uses to render them (never a
 * second scoring implementation), then upserts the one row for this user
 * (identical "current state, one row per user" shape as learning_preferences).
 * `prediction_source` is always written as "assessment" here — a later ML
 * phase is the only thing that would ever write "ml_model".
 */
export function useVarkProfile(options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = !!user && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: [VARK_PROFILE_KEY, user?.id],
    enabled,
    queryFn: async (): Promise<VarkProfileRow | null> => {
      const { data, error } = await supabase
        .from("vark_profiles")
        .select(SELECT_COLUMNS)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as VarkProfileRow | null;
    },
  });

  const submit = useMutation({
    mutationFn: async (responses: VarkResponses) => {
      if (!user) throw new Error("Sign in required");
      const scores = computeVarkScores(responses);
      const primary = derivePrimaryVarkCategory(scores);
      const { error } = await supabase.from("vark_profiles").upsert(
        {
          user_id: user.id,
          responses,
          visual_score: scores.visual,
          auditory_score: scores.auditory,
          read_write_score: scores.read_write,
          kinesthetic_score: scores.kinesthetic,
          predicted_category: primary.category,
          prediction_source: "assessment",
          assessment_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      return { scores, primary };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [VARK_PROFILE_KEY] });
    },
  });

  return {
    profile: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    status: varkAssessmentStatus(query.data ?? null),
    submit: (responses: VarkResponses) => submit.mutateAsync(responses),
    submitting: submit.isPending,
  };
}
