/**
 * R8.2 — pure resolver that layers the R8.1 personal remedial-history signal
 * on top of the existing A7 / VARK / Learning-Preferences / default chain.
 * Only medium/high confidence overrides; everything else preserves existing
 * behaviour exactly. No DB / AI / React / writes.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-recommendation.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveRemedialRecommendation } from "@/lib/remedial-recommendation";
import { resolveRecommendedRemedialModality } from "@/lib/remedial-modality";
import type { RemedialAdaptationRecommendation } from "@/lib/remedial-adaptation";

const adaptation = (
  over: Partial<RemedialAdaptationRecommendation>,
): RemedialAdaptationRecommendation => ({
  preferredFormat: "visual",
  leaningFormat: "visual",
  confidence: "high",
  reason:
    "Visual remediation has previously been associated with improvement in your completed study paths.",
  perFormat: [],
  totalObservations: 8,
  ...over,
});

const base = {
  remedialAdaptation: null as RemedialAdaptationRecommendation | null,
  adaptiveRecommendation: null as {
    modality: "text" | "video" | "audio" | "slides" | null;
    source: "vark" | "adaptive";
  } | null,
  varkRecommendation: null as "text" | "video" | "audio" | "slides" | null,
  preferredModality: null as string | null,
};

/* ------------------------- overrides (priority 1) ----------------------- */

test("high-confidence history overrides an A7 adaptive recommendation", () => {
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({ preferredFormat: "visual", confidence: "high" }),
    adaptiveRecommendation: { modality: "audio", source: "adaptive" },
  });
  assert.equal(out.modality, "visual");
  assert.equal(out.source, "history");
  assert.equal(out.personalHistory.applied, true);
  assert.equal(out.personalHistory.considered, true);
  assert.equal(out.personalHistory.replacedSource, "adaptive");
  assert.match(out.personalHistory.reason!, /associated with improvement/);
});

test("medium-confidence history overrides VARK", () => {
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({ preferredFormat: "audio", confidence: "medium" }),
    varkRecommendation: "text",
  });
  assert.equal(out.modality, "audio");
  assert.equal(out.source, "history");
  assert.equal(out.personalHistory.replacedSource, "vark");
});

test("history overrides a Learning Preference", () => {
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({ preferredFormat: "visual", confidence: "high" }),
    preferredModality: "audio",
  });
  assert.equal(out.modality, "visual");
  assert.equal(out.source, "history");
  assert.equal(out.personalHistory.replacedSource, "preference");
});

/* ---------------------- low / none never override ---------------------- */

test("low-confidence history NEVER overrides — existing behaviour preserved", () => {
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({ preferredFormat: "visual", confidence: "low" }),
    adaptiveRecommendation: { modality: "audio", source: "adaptive" },
  });
  assert.equal(out.modality, "audio");
  assert.equal(out.source, "adaptive");
  assert.equal(out.personalHistory.applied, false);
  assert.equal(out.personalHistory.considered, false);
  assert.equal(out.personalHistory.confidence, "low");
  // R8.1 reason still surfaced for UI, even though it did not apply
  assert.ok(out.personalHistory.reason);
});

test("none-confidence history does not override and carries no format", () => {
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({
      preferredFormat: null,
      leaningFormat: null,
      confidence: "none",
    }),
    varkRecommendation: "video",
  });
  assert.equal(out.source, "vark");
  assert.equal(out.modality, "visual"); // video -> visual, via the existing resolver
  assert.equal(out.personalHistory.considered, false);
});

test("no remedialAdaptation input == the existing resolver, byte for byte", () => {
  const inputs = [
    { adaptiveRecommendation: { modality: "audio" as const, source: "adaptive" as const } },
    { varkRecommendation: "slides" as const },
    { preferredModality: "written" },
    {},
  ];
  for (const extra of inputs) {
    const merged = { ...base, ...extra };
    const out = resolveRemedialRecommendation({ ...merged, remedialAdaptation: null });
    const existing = resolveRecommendedRemedialModality({
      adaptive: merged.adaptiveRecommendation,
      varkModality: merged.varkRecommendation,
      lessonFormatPreference: merged.preferredModality,
    });
    assert.equal(out.modality, existing.modality);
    assert.equal(out.source, existing.source);
    assert.equal(out.personalHistory.applied, false);
    assert.equal(out.personalHistory.reason, null);
  }
});

/* --------------------------- availability gate ------------------------ */

test("history does not override when its format is unavailable", () => {
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({ preferredFormat: "audio", confidence: "high" }),
    varkRecommendation: "text",
    availableModalities: ["text", "visual"],
  });
  assert.equal(out.modality, "text");
  assert.equal(out.source, "vark");
  assert.equal(out.personalHistory.considered, true); // a real signal existed
  assert.equal(out.personalHistory.applied, false); // but it wasn't available
});

test("empty / omitted availableModalities allows the override", () => {
  for (const availableModalities of [undefined, [] as const]) {
    const out = resolveRemedialRecommendation({
      ...base,
      remedialAdaptation: adaptation({ preferredFormat: "visual", confidence: "high" }),
      varkRecommendation: "text",
      availableModalities,
    });
    assert.equal(out.source, "history");
    assert.equal(out.modality, "visual");
  }
});

/* -------------------------- existing chain intact -------------------- */

test("priority 2>3>4>5 still delegated to the existing resolver", () => {
  // adaptive beats vark
  assert.equal(
    resolveRemedialRecommendation({
      ...base,
      adaptiveRecommendation: { modality: "audio", source: "adaptive" },
      varkRecommendation: "text",
    }).source,
    "adaptive",
  );
  // vark beats preference
  assert.equal(
    resolveRemedialRecommendation({
      ...base,
      varkRecommendation: "video",
      preferredModality: "audio",
    }).source,
    "vark",
  );
  // preference beats default
  assert.equal(
    resolveRemedialRecommendation({ ...base, preferredModality: "audio" }).source,
    "preference",
  );
  // default fallback
  assert.deepEqual(
    (() => {
      const o = resolveRemedialRecommendation({ ...base });
      return [o.modality, o.source];
    })(),
    ["text", "default"],
  );
});

test("an adaptive result that is only a VARK pass-through does NOT let history through the back door", () => {
  // adaptive.source === "vark" means A7 did not override; existing resolver
  // falls to varkModality. History still only applies on medium/high.
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({ preferredFormat: "visual", confidence: "low" }),
    adaptiveRecommendation: { modality: "text", source: "vark" },
    varkRecommendation: "audio",
  });
  assert.equal(out.source, "vark");
  assert.equal(out.modality, "audio");
});

/* ------------------------------ safety ------------------------------- */

test("a stray 'video' preferredFormat is never used (not a remedial modality)", () => {
  const out = resolveRemedialRecommendation({
    ...base,
    remedialAdaptation: adaptation({ preferredFormat: "video" as never, confidence: "high" }),
    varkRecommendation: "text",
  });
  assert.equal(out.source, "vark");
  assert.equal(out.personalHistory.considered, false);
});

test("pure + deterministic: same input, identical output; input not mutated", () => {
  const input = {
    ...base,
    remedialAdaptation: adaptation({ confidence: "high" }),
    adaptiveRecommendation: { modality: "audio" as const, source: "adaptive" as const },
    availableModalities: ["text", "audio", "visual"] as const,
  };
  const snap = JSON.stringify(input);
  const a = resolveRemedialRecommendation(input);
  const b = resolveRemedialRecommendation(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snap);
});

/* ---------------------------- guardrails ---------------------------- */

const SRC = readFileSync(
  fileURLToPath(new URL("./remedial-recommendation.ts", import.meta.url)),
  "utf8",
);
const CODE = SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

test("R8.2 source: pure — no Supabase / React / API / writes", () => {
  assert.doesNotMatch(CODE, /@\/integrations\/supabase|from ["']react["']|useState|useEffect/i);
  assert.doesNotMatch(
    CODE,
    /fetch\(|gemini|generativelanguage|anthropic|openai|\.rpc\(|createServerFn/i,
  );
  assert.doesNotMatch(CODE, /\binsert\(|\bupsert\(|\bupdate\(|supabase\./i);
});

test("R8.2 source: reuses the existing resolver + R8.1, does not re-implement or touch A7", () => {
  assert.match(CODE, /resolveRecommendedRemedialModality[\s\S]*?from "@\/lib\/remedial-modality"/);
  assert.match(CODE, /from "@\/lib\/remedial-adaptation"/);
  // never re-declares the existing resolver, never imports the A7 modules
  assert.doesNotMatch(CODE, /function\s+resolveRecommendedRemedialModality/);
  assert.doesNotMatch(
    CODE,
    /adaptive-modality|vark-inference|learning-preferences|mastery|grade_quiz/,
  );
});
