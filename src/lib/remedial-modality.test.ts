/**
 * R1 — recommended remedial modality resolution.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-modality.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lessonFormatToRemedial,
  lessonModalityToRemedial,
  resolveRecommendedRemedialModality,
} from "@/lib/remedial-modality";

const vark = (m: "text" | "video" | "audio" | "slides" | null) => ({
  adaptive: null,
  varkModality: m,
  lessonFormatPreference: null as string | null,
});

test("1. A7 adaptive audio -> recommended remedial modality audio", () => {
  const r = resolveRecommendedRemedialModality({
    adaptive: { modality: "audio", source: "adaptive" },
    varkModality: "text",
    lessonFormatPreference: "written",
  });
  assert.deepEqual(r, { modality: "audio", source: "adaptive" });
});

test("2. A7 adaptive text -> text", () => {
  const r = resolveRecommendedRemedialModality({
    adaptive: { modality: "text", source: "adaptive" },
    varkModality: "video",
    lessonFormatPreference: "audio",
  });
  assert.deepEqual(r, { modality: "text", source: "adaptive" });
});

test("3. A7 adaptive video -> visual", () => {
  const r = resolveRecommendedRemedialModality({
    adaptive: { modality: "video", source: "adaptive" },
    varkModality: null,
    lessonFormatPreference: null,
  });
  assert.deepEqual(r, { modality: "visual", source: "adaptive" });
});

test("4. A7 adaptive slides -> visual", () => {
  const r = resolveRecommendedRemedialModality({
    adaptive: { modality: "slides", source: "adaptive" },
    varkModality: null,
    lessonFormatPreference: null,
  });
  assert.deepEqual(r, { modality: "visual", source: "adaptive" });
});

test("5. insufficient A7 evidence (source 'vark') -> VARK fallback", () => {
  // A7 returned but did NOT override — its source is 'vark'. Step 1 is skipped.
  const r = resolveRecommendedRemedialModality({
    adaptive: { modality: "text", source: "vark" },
    varkModality: "audio",
    lessonFormatPreference: "written",
  });
  assert.deepEqual(r, { modality: "audio", source: "vark" });

  // and when A7 has no result at all (course-level path)
  assert.deepEqual(resolveRecommendedRemedialModality(vark("video")), {
    modality: "visual",
    source: "vark",
  });
});

test("6. no A7 / no VARK -> Learning Preferences (lesson_format) fallback", () => {
  assert.deepEqual(
    resolveRecommendedRemedialModality({
      adaptive: null,
      varkModality: null,
      lessonFormatPreference: "visual",
    }),
    { modality: "visual", source: "preference" },
  );
  assert.deepEqual(
    resolveRecommendedRemedialModality({
      adaptive: { modality: null, source: "vark" },
      varkModality: null,
      lessonFormatPreference: "audio",
    }),
    { modality: "audio", source: "preference" },
  );
});

test("7. no personalization at all -> text fallback", () => {
  assert.deepEqual(
    resolveRecommendedRemedialModality({
      adaptive: null,
      varkModality: null,
      lessonFormatPreference: null,
    }),
    { modality: "text", source: "default" },
  );
  // an unrecognised lesson_format value doesn't count as a preference
  assert.deepEqual(
    resolveRecommendedRemedialModality({
      adaptive: null,
      varkModality: null,
      lessonFormatPreference: "kinesthetic",
    }),
    { modality: "text", source: "default" },
  );
});

test("8. resolution is a pure read — nothing is mutated", () => {
  const input = {
    adaptive: { modality: "audio" as const, source: "adaptive" as const },
    varkModality: "video" as const,
    lessonFormatPreference: "written",
  };
  const snapshot = JSON.stringify(input);
  resolveRecommendedRemedialModality(input);
  resolveRecommendedRemedialModality(input);
  assert.equal(JSON.stringify(input), snapshot); // input untouched
  // no I/O surface: the module exports only pure functions
});

test("mapping helpers", () => {
  assert.equal(lessonModalityToRemedial("text"), "text");
  assert.equal(lessonModalityToRemedial("audio"), "audio");
  assert.equal(lessonModalityToRemedial("video"), "visual");
  assert.equal(lessonModalityToRemedial("slides"), "visual");
  assert.equal(lessonFormatToRemedial("written"), "text");
  assert.equal(lessonFormatToRemedial("visual"), "visual");
  assert.equal(lessonFormatToRemedial("audio"), "audio");
  assert.equal(lessonFormatToRemedial(null), null);
  assert.equal(lessonFormatToRemedial("something-else"), null);
});
