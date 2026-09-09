import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  computeVarkScores,
  derivePrimaryVarkCategory,
  varkAssessmentStatus,
  type VarkProfileRow,
  type VarkResponses,
} from "@/lib/vark";
import { predictVarkMlCategory } from "@/lib/vark-inference.functions";

const VARK_PROFILE_KEY = "vark-profile";

const SELECT_COLUMNS =
  "user_id, responses, visual_score, auditory_score, read_write_score, kinesthetic_score, predicted_category, prediction_source, prediction_confidence, model_version, assessment_completed_at, onboarding_skipped_at, ml_predicted_category, ml_prediction_confidence, ml_class_probabilities, ml_model_version, ml_predicted_at, updated_at";

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
 * `prediction_source` is always written as "assessment" here — only
 * `predictVarkMlCategory` (Phase A3) ever writes the separate ml_* fields.
 *
 * After the questionnaire upsert succeeds, `submit` best-effort calls the
 * real ML model (predictVarkMlCategory) with the just-computed scores. That
 * call is never allowed to fail the mutation — the questionnaire result is
 * already saved by the time it runs — so a failure is caught, toasted as a
 * non-blocking notice, and swallowed. The questionnaire upsert also clears
 * any previous ml_* prediction up front, so a retake never shows a stale ML
 * result computed from the OLD scores while the new inference is pending or
 * if it fails.
 */
export function useVarkProfile(options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = !!user && (options?.enabled ?? true);
  const runPredictMl = useServerFn(predictVarkMlCategory);

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
          // Clear any previous ML result up front — a retake must never show
          // a stale prediction computed from the scores being replaced right
          // now, whether or not the fresh inference call below succeeds.
          ml_predicted_category: null,
          ml_prediction_confidence: null,
          ml_class_probabilities: null,
          ml_model_version: null,
          ml_predicted_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;

      try {
        const mlResult = await runPredictMl({
          data: {
            visual_score: scores.visual,
            auditory_score: scores.auditory,
            read_write_score: scores.read_write,
            kinesthetic_score: scores.kinesthetic,
          },
        });
        if (!mlResult.ok) {
          toast.message("ML classification unavailable", { description: mlResult.reason });
        }
      } catch (mlErr) {
        // Best-effort only — the questionnaire result above is already
        // saved, so an ML failure here is surfaced but never re-thrown.
        console.error(
          `[useVarkProfile] ML inference failed: ${mlErr instanceof Error ? mlErr.message : String(mlErr)}`,
        );
        toast.message("ML classification unavailable", {
          description:
            "The ML classifier couldn't be reached — your assessment result was still saved.",
        });
      }

      return { scores, primary };
    },
    onSuccess: () => {
      // Returned so mutateAsync awaits the refetch too — by the time
      // onSubmit's `await submit(responses)` resolves, `profile` (including
      // any fresh ml_* fields) is already up to date, not just invalidated.
      return qc.invalidateQueries({ queryKey: [VARK_PROFILE_KEY] });
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
