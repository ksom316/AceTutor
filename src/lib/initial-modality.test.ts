/**
 * Phase A7 final UX — tests for `resolveInitialModality` (the initial-tab
 * priority) plus static checks on topic.$topicId.tsx that the analytics and
 * manual-choice wiring are correct.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/initial-modality.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveInitialModality, type InitialModalityInput } from "@/lib/initial-modality";
import { buildRecommendationContext } from "@/lib/learning-interactions";
import type { LessonModality } from "@/lib/lesson-shared";

const ALL: LessonModality[] = ["text", "video", "audio", "slides"];

function input(over: Partial<InitialModalityInput>): InitialModalityInput {
  return {
    manualPick: null,
    adaptiveOverrideModality: null,
    varkModality: null,
    preferredModality: null,
    availableModalities: ALL,
    ...over,
  };
}

/* ------------------------ resolveInitialModality ------------------------ */

test("1. Visual VARK + insufficient A7 evidence -> initial Video", () => {
  assert.equal(
    resolveInitialModality(input({ varkModality: "video", adaptiveOverrideModality: null })),
    "video",
  );
});

test("2. Visual VARK + adaptive Audio override -> initial Audio", () => {
  assert.equal(
    resolveInitialModality(input({ varkModality: "video", adaptiveOverrideModality: "audio" })),
    "audio",
  );
});

test("3. Visual VARK + adaptive Text override -> initial Text", () => {
  assert.equal(
    resolveInitialModality(input({ varkModality: "video", adaptiveOverrideModality: "text" })),
    "text",
  );
});

test("5. no A7 evidence -> VARK stays the cold-start initial modality", () => {
  // adaptiveOverrideModality null == A7 produced no genuine override
  assert.equal(resolveInitialModality(input({ varkModality: "video" })), "video");
});

test("6. unavailable adaptive modality -> next valid candidate (VARK)", () => {
  assert.equal(
    resolveInitialModality(
      input({
        adaptiveOverrideModality: "audio", // not in this topic
        varkModality: "video",
        availableModalities: ["text", "video"],
      }),
    ),
    "video",
  );
});

test("6b. neither adaptive nor VARK available -> Learning Preferences, then first", () => {
  assert.equal(
    resolveInitialModality(
      input({
        adaptiveOverrideModality: "audio",
        varkModality: "audio",
        preferredModality: "text",
        availableModalities: ["text", "slides"],
      }),
    ),
    "text",
  );
  assert.equal(
    resolveInitialModality(
      input({
        adaptiveOverrideModality: "audio",
        varkModality: "audio",
        preferredModality: "video",
        availableModalities: ["text", "slides"],
      }),
    ),
    "text", // preferred also unavailable -> first available
  );
});

test("7. a manual pick always wins, whatever the recommendations say", () => {
  const base = input({
    manualPick: "text",
    adaptiveOverrideModality: "audio",
    varkModality: "video",
    preferredModality: "slides",
  });
  assert.equal(resolveInitialModality(base), "text");
  // ... and again after the recommendation "updates" (re-render / refetch)
  assert.equal(resolveInitialModality({ ...base, adaptiveOverrideModality: "slides" }), "text");
});

test("priority order: adaptive override > VARK > preferences > first", () => {
  assert.equal(
    resolveInitialModality(
      input({
        adaptiveOverrideModality: "audio",
        varkModality: "video",
        preferredModality: "text",
      }),
    ),
    "audio",
  );
  assert.equal(
    resolveInitialModality(input({ varkModality: "video", preferredModality: "text" })),
    "video",
  );
  assert.equal(resolveInitialModality(input({ preferredModality: "text" })), "text");
  assert.equal(
    resolveInitialModality(input({ availableModalities: ["slides", "audio"] })),
    "slides",
  );
});

test("empty topic -> undefined (never initialises to a nonexistent modality)", () => {
  assert.equal(resolveInitialModality(input({ availableModalities: [] })), undefined);
  assert.equal(
    resolveInitialModality(input({ adaptiveOverrideModality: "video", availableModalities: [] })),
    undefined,
  );
});

/* --------- 11 / 12: recommendation context during an override ---------- */

test("11/12. adaptive override keeps recommendation_source and the real VARK category", () => {
  const ctx = buildRecommendationContext({
    recommendedModality: "audio", // the DISPLAYED (adaptive) recommendation
    recommendationSource: "adaptive",
    effectiveCategory: "visual", // student is still Visual
    actualModality: "audio",
  });
  assert.equal(ctx.recommended_modality, "audio");
  assert.equal(ctx.recommendation_source, "adaptive");
  assert.equal(ctx.effective_vark_category, "visual");
  assert.equal(ctx.recommendation_matched, true);
});

/* ------------- static checks on the topic page wiring ------------- */

const routeSrc = readFileSync(
  fileURLToPath(new URL("../routes/_authenticated/topic.$topicId.tsx", import.meta.url)),
  "utf8",
);
const helperSrc = readFileSync(
  fileURLToPath(new URL("./initial-modality.ts", import.meta.url)),
  "utf8",
);

test("4. neither the initial-modality helper nor the topic page writes VARK profile fields", () => {
  assert.doesNotMatch(helperSrc, /supabase|vark_profiles/);
  // the page only READS the VARK profile (via useVarkProfile) — never writes it
  assert.doesNotMatch(routeSrc, /from\("vark_profiles"\)/);
  assert.doesNotMatch(routeSrc, /vark_profiles[\s\S]{0,120}\.(update|upsert|insert)\(/);
});

test("8. modality_selected is keyed off the manual `picked`, not the auto initial", () => {
  // the logging guard requires a manual pick
  assert.match(routeSrc, /if \(!user \|\| !picked[\s\S]{0,400}event_type: "modality_selected"/);
  // it logs `picked`, never `activeModality`
  assert.match(routeSrc, /event_type: "modality_selected",[\s\S]{0,160}modality: picked,/);
  assert.doesNotMatch(
    routeSrc,
    /event_type: "modality_selected",[\s\S]{0,160}modality: activeModality,/,
  );
});

test("9. a tab click is the only thing that sets a manual pick", () => {
  assert.match(routeSrc, /onClick=\{\(\) => setPicked\(k\)\}/);
  const setPickedCalls = routeSrc.match(/setPicked\(/g) ?? [];
  assert.equal(setPickedCalls.length, 1, "setPicked is called from exactly one place (the tab)");
});

test("10. the meaningful-engagement hook watches activeModality (auto initial included)", () => {
  assert.match(routeSrc, /useMeaningfulEngagement\(\{[\s\S]{0,400}activeModality,/);
});

test("initial tab is frozen once and only a manual pick can move it afterwards", () => {
  assert.match(routeSrc, /frozenInitialRef/);
  assert.match(routeSrc, /resolveInitialModality\(/);
  // the frozen value / manual pick are what activeModality returns — not a
  // fresh recompute off the live recommendation every render
  assert.match(routeSrc, /if \(picked && availableModalities\.includes\(picked\)\) return picked;/);
});
