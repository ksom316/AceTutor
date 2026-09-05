import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAuthorizedStudent } from "@/lib/vark-student-auth";

/**
 * Phase A3 — sends the four VARK assessment scores to the ACTUAL trained
 * scikit-learn model (ml/vark/, model_version "vark-assessment-a2.1-v1") and
 * persists its prediction separately from the questionnaire-derived result.
 *
 * The model itself cannot run in this app's own server functions (see
 * ml/vark/service/README.md for why) — it is deployed as its own small,
 * separate Vercel project, and this function calls it over HTTPS with a
 * shared secret, the same "server calls an external HTTPS API with a secret"
 * shape already used for OpenRouter (course-chat.functions.ts). The browser
 * never sees the model artifact, the inference URL, or the secret.
 *
 * Never throws on an inference failure — the caller (useVarkProfile's submit
 * mutation) must be able to treat this as "best-effort, after the real save
 * already succeeded." Returns { ok: false } instead so the assessment save is
 * never put at risk by a flaky or misconfigured inference endpoint.
 */

const scoreSchema = z.number().int().min(0).max(14);

const inputSchema = z.object({
  visual_score: scoreSchema,
  auditory_score: scoreSchema,
  read_write_score: scoreSchema,
  kinesthetic_score: scoreSchema,
});

export type VarkMlInferenceInput = z.infer<typeof inputSchema>;

type VarkCategory = "visual" | "auditory" | "read_write" | "kinesthetic";

export type VarkMlInferenceResult =
  | {
      ok: true;
      predicted_category: VarkCategory;
      confidence: number;
      class_probabilities: Record<string, number>;
      model_version: string | null;
      model_type: string | null;
    }
  | { ok: false; reason: string };

const VALID_CATEGORIES = new Set(["visual", "auditory", "read_write", "kinesthetic"]);

/**
 * VARK_INFERENCE_URL is documented (.env.example, ml/vark/service/README.md)
 * as "the endpoint, e.g. https://<project>.vercel.app/api/predict" — but a
 * project's dashboard shows the bare deployment URL first, before the "point
 * it at /api/predict" step, so misconfiguring it as just the bare origin is
 * an easy, previously-silent mistake (every request 404s, which surfaced
 * identically to "ML classification unavailable" as any other inference
 * failure — no distinct symptom to notice). Normalized here so the correct
 * endpoint is always hit regardless of which form was configured.
 */
function resolveInferenceEndpoint(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/predict") ? trimmed : `${trimmed}/api/predict`;
}

export const predictVarkMlCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<VarkMlInferenceResult> => {
    const { supabase, userId } = context;

    const roleRes = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    // TEMPORARY diagnostic — safe: logs only the role string and a Postgrest
    // error code, never a user id, token, or row contents. Remove once A3's
    // main-app integration is confirmed working end-to-end in production.
    console.info(
      `[predictVarkMlCategory] role lookup: role=${roleRes.data?.role ?? "none"} error=${roleRes.error?.code ?? "none"}`,
    );
    if (!isAuthorizedStudent(roleRes)) {
      throw new Error("NOT_A_STUDENT");
    }

    const rawInferenceUrl = process.env.VARK_INFERENCE_URL;
    const inferenceSecret = process.env.VARK_INFERENCE_SECRET;
    if (!rawInferenceUrl || !inferenceSecret) {
      console.error(
        `[predictVarkMlCategory] VARK_INFERENCE_URL configured=${Boolean(rawInferenceUrl)} VARK_INFERENCE_SECRET configured=${Boolean(inferenceSecret)} — skipping ML inference.`,
      );
      return { ok: false, reason: "ML inference is not configured." };
    }
    const inferenceUrl = resolveInferenceEndpoint(rawInferenceUrl);
    // TEMPORARY diagnostic — safe: the endpoint URL is not secret (the
    // X-Inference-Secret header is what actually protects it); never logs
    // the secret itself.
    console.info(`[predictVarkMlCategory] calling inference endpoint: ${inferenceUrl}`);

    let result: VarkMlInferenceResult;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(inferenceUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Inference-Secret": inferenceSecret,
          },
          body: JSON.stringify(data),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      // TEMPORARY diagnostic — safe: HTTP status only.
      console.info(`[predictVarkMlCategory] inference fetch status: ${res.status}`);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`(${res.status}) ${text.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        predicted_category?: unknown;
        confidence?: unknown;
        class_probabilities?: unknown;
        model_version?: unknown;
        model_type?: unknown;
      };

      if (
        typeof json.predicted_category !== "string" ||
        !VALID_CATEGORIES.has(json.predicted_category) ||
        typeof json.confidence !== "number" ||
        typeof json.class_probabilities !== "object" ||
        json.class_probabilities === null
      ) {
        // TEMPORARY diagnostic — safe: which specific check failed, plus the
        // response's own top-level key names (not values) so a shape drift
        // is visible without logging any prediction content.
        console.error(
          `[predictVarkMlCategory] response validation failed — keys received: [${Object.keys(json).join(", ")}]`,
        );
        throw new Error("Inference response did not match the expected shape.");
      }

      result = {
        ok: true,
        predicted_category: json.predicted_category as VarkCategory,
        confidence: json.confidence,
        class_probabilities: json.class_probabilities as Record<string, number>,
        model_version: typeof json.model_version === "string" ? json.model_version : null,
        model_type: typeof json.model_type === "string" ? json.model_type : null,
      };
    } catch (err) {
      // Never a fabricated fallback prediction — a failure here just means
      // no ML result gets persisted this time; the questionnaire result
      // (already saved before this function is even called) is untouched.
      console.error(
        `[predictVarkMlCategory] inference call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, reason: "The ML classifier is temporarily unavailable." };
    }

    const { data: updatedRows, error: upsertError } = await supabase
      .from("vark_profiles")
      .update({
        ml_predicted_category: result.predicted_category,
        ml_prediction_confidence: result.confidence,
        ml_class_probabilities: result.class_probabilities,
        ml_model_version: result.model_version,
        ml_predicted_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      // Requesting the row back (rather than a bare update) is what makes a
      // silent 0-row update visible below — RLS or a missing row would
      // otherwise report no error at all while writing nothing.
      .select("user_id");

    if (upsertError) {
      // TEMPORARY diagnostic — safe: Postgrest error code/details/hint never
      // include row contents or secrets, and are exactly what distinguishes
      // "column does not exist" (unapplied migration) from an RLS denial
      // from any other failure.
      console.error(
        `[predictVarkMlCategory] failed to persist ML result: code=${upsertError.code ?? "none"} message=${upsertError.message} details=${upsertError.details ?? "none"} hint=${upsertError.hint ?? "none"}`,
      );
      return { ok: false, reason: "Couldn't save the ML classification." };
    }
    if (!updatedRows || updatedRows.length === 0) {
      // No Postgrest error, but nothing matched — either RLS silently
      // excluded the row or it doesn't exist yet for this user.
      console.error(
        `[predictVarkMlCategory] ML result update matched 0 rows for this user — RLS or missing vark_profiles row.`,
      );
      return { ok: false, reason: "Couldn't save the ML classification." };
    }

    console.info(
      `[predictVarkMlCategory] model_type=${result.model_type ?? "unknown"} model_version=${result.model_version ?? "unknown"} predicted_category=${result.predicted_category}`,
    );

    return result;
  });
