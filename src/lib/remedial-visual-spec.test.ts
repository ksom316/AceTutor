/**
 * R5 — concept-fitted visual spec: validation, limits, cross-field integrity,
 * and safe fallback. Plus structural checks on the renderer / panel / prompt
 * and proof that R4 thresholds and A7 are untouched.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-visual-spec.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isConceptMapSpec,
  parseRemedialVisualSpec,
  REMEDIAL_VISUAL_LIMITS as L,
  REMEDIAL_VISUAL_TYPES,
  type RemedialArraySpec,
  type RemedialHierarchySpec,
  type RemedialLinkedStructureSpec,
  type RemedialSequenceSpec,
} from "@/lib/remedial-visual-spec";
import { parseRemedialContent, remedialContentSchema } from "@/lib/remedial-content";

/* ---------------- 1. every supported type validates ---------------- */

const VALID: Record<string, unknown> = {
  sequence: {
    type: "sequence",
    title: "Bubble sort passes",
    steps: [
      { label: "Start", state: "[5, 1, 4, 2]" },
      { label: "Pass 1", state: "[1, 4, 2, 5]" },
      { label: "Pass 2", state: "[1, 2, 4, 5]" },
    ],
  },
  process: {
    type: "process",
    title: "SDLC",
    steps: [
      { label: "Requirements", detail: "Gather and agree scope" },
      { label: "Design" },
      { label: "Implementation" },
    ],
  },
  hierarchy: {
    type: "hierarchy",
    title: "OSI model (top down)",
    levels: [{ label: "Application" }, { label: "Transport" }, { label: "Network" }],
  },
  comparison: {
    type: "comparison",
    title: "1NF vs 2NF",
    items: [
      { name: "1NF", points: ["Atomic values", "No repeating groups"] },
      { name: "2NF", points: ["1NF + no partial dependency"] },
    ],
  },
  table: {
    type: "table",
    title: "Before / after decomposition",
    columns: ["Table", "Attributes"],
    rows: [
      ["R", "A, B, C"],
      ["R1", "A, B"],
      ["R2", "A, C"],
    ],
  },
  array: {
    type: "array",
    title: "Indexed array",
    cells: [{ value: "10" }, { value: "20", highlight: true }, { value: "30" }],
    caption: "index 1 is the search hit",
  },
  "linked-structure": {
    type: "linked-structure",
    title: "Singly linked list",
    nodes: [
      { id: "a", label: "head: 10" },
      { id: "b", label: "20" },
      { id: "c", label: "tail: 30" },
    ],
    links: [
      { from: "a", to: "b", label: "next" },
      { from: "b", to: "c", label: "next" },
    ],
  },
  "concept-map": { type: "concept-map" },
};

test("1. every supported visual type round-trips through the validator", () => {
  for (const type of REMEDIAL_VISUAL_TYPES) {
    const parsed = parseRemedialVisualSpec(VALID[type]);
    assert.ok(parsed, `${type} should validate`);
    assert.equal(parsed.type, type);
  }
});

test("REMEDIAL_VISUAL_TYPES has exactly the 8 documented types", () => {
  assert.deepEqual([...REMEDIAL_VISUAL_TYPES].sort(), [
    "array",
    "comparison",
    "concept-map",
    "hierarchy",
    "linked-structure",
    "process",
    "sequence",
    "table",
  ]);
});

/* ---------------- 2. malformed / missing -> null (fallback) ---------------- */

test("2. malformed AI visual data -> null (renderer falls back to R3)", () => {
  for (const bad of [
    null,
    undefined,
    "sequence",
    42,
    [],
    {},
    { type: "pie-chart", title: "x" }, // unknown discriminator
    { type: "sequence" }, // missing steps
    { type: "sequence", title: "x", steps: [{ label: "only one" }] }, // < 2
    { type: "table", title: "x", columns: ["A", "B"], rows: [["1"]] }, // row width != columns
    { type: "hierarchy", title: "x", levels: [] },
    { type: "array", title: "x", cells: [] },
    { type: "comparison", title: "x", items: [{ name: "only", points: ["p"] }] }, // < 2 items
  ]) {
    assert.equal(parseRemedialVisualSpec(bad), null, `${JSON.stringify(bad)} should reject`);
  }
});

test("3. missing visual -> null -> isConceptMapSpec(null) is true", () => {
  assert.equal(parseRemedialVisualSpec(undefined), null);
  assert.equal(isConceptMapSpec(null), true);
  assert.equal(isConceptMapSpec(parseRemedialVisualSpec({ type: "concept-map" })), true);
  assert.equal(isConceptMapSpec(parseRemedialVisualSpec(VALID.sequence)), false);
});

/* ---------------- 4. old persisted RemedialContent compatibility ---------------- */

const BASE_CONTENT = {
  title: "T",
  weakConcepts: ["c"],
  summary: "the summary",
  explanation: "the explanation body".padEnd(40, "."),
  keyPoints: ["one", "two"],
};

test("4. a pre-R5 RemedialContent (no visual field) still parses", () => {
  const res = remedialContentSchema.safeParse(BASE_CONTENT);
  assert.ok(res.success);
  assert.equal(res.data.visual, undefined);
});

test("4b. a persisted content with a MALFORMED visual still parses — visual dropped", () => {
  const res = remedialContentSchema.safeParse({
    ...BASE_CONTENT,
    visual: { type: "sequence", steps: "nope" },
  });
  assert.ok(res.success, "the lesson must survive a bad visual");
  assert.equal(res.data.visual, undefined);
});

test("4c. a persisted content with a VALID visual keeps it", () => {
  const res = remedialContentSchema.safeParse({ ...BASE_CONTENT, visual: VALID.hierarchy });
  assert.ok(res.success);
  assert.equal(res.data.visual?.type, "hierarchy");
});

test("4d. parseRemedialContent extracts a valid visual and ignores a bad one", () => {
  const good = parseRemedialContent(JSON.stringify({ ...BASE_CONTENT, visual: VALID.array }), [
    "c",
  ]);
  assert.equal(good?.visual?.type, "array");

  const bad = parseRemedialContent(
    JSON.stringify({ ...BASE_CONTENT, visual: { type: "array", title: "x", cells: [] } }),
    ["c"],
  );
  assert.ok(bad);
  assert.equal(bad.visual, undefined); // lesson still generated, visual dropped
});

/* ---------------- 5. array indexing model ---------------- */

test("5. array cells keep their order and highlight flags (index = position)", () => {
  const spec = parseRemedialVisualSpec(VALID.array) as RemedialArraySpec | null;
  assert.ok(spec);
  assert.equal(spec.type, "array");
  assert.deepEqual(
    spec.cells.map((c) => c.value),
    ["10", "20", "30"],
  );
  assert.deepEqual(
    spec.cells.map((c, i) => (c.highlight ? i : null)).filter((x) => x !== null),
    [1],
  );
});

/* ---------------- 6. sorting sequence ordering ---------------- */

test("6. sequence steps preserve authoring order (sorting progression)", () => {
  const spec = parseRemedialVisualSpec(VALID.sequence) as RemedialSequenceSpec | null;
  assert.ok(spec);
  assert.deepEqual(
    spec.steps.map((s) => s.label),
    ["Start", "Pass 1", "Pass 2"],
  );
  assert.deepEqual(
    spec.steps.map((s) => s.state),
    ["[5, 1, 4, 2]", "[1, 4, 2, 5]", "[1, 2, 4, 5]"],
  );
});

/* ---------------- 7. hierarchy ordering ---------------- */

test("7. hierarchy levels preserve top-to-bottom order", () => {
  const spec = parseRemedialVisualSpec(VALID.hierarchy) as RemedialHierarchySpec | null;
  assert.ok(spec);
  assert.deepEqual(
    spec.levels.map((l) => l.label),
    ["Application", "Transport", "Network"],
  );
});

/* ---------------- 8. table validation ---------------- */

test("8. table rejects ragged rows and over-long tables", () => {
  assert.equal(
    parseRemedialVisualSpec({
      type: "table",
      title: "x",
      columns: ["A", "B", "C"],
      rows: [
        ["1", "2", "3"],
        ["4", "5"],
      ],
    }),
    null,
  );
  assert.equal(
    parseRemedialVisualSpec({
      type: "table",
      title: "x",
      columns: ["A"],
      rows: Array.from({ length: L.maxRows + 1 }, () => ["v"]),
    }),
    null,
  );
  // a well-formed table with matching widths is fine
  assert.ok(
    parseRemedialVisualSpec({
      type: "table",
      title: "x",
      columns: ["A", "B"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    }),
  );
});

/* ---------------- 9. linked-structure validation ---------------- */

test("9. linked-structure rejects dangling links and duplicate node ids", () => {
  assert.equal(
    parseRemedialVisualSpec({
      type: "linked-structure",
      title: "x",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      links: [{ from: "a", to: "ghost" }],
    }),
    null,
  );
  assert.equal(
    parseRemedialVisualSpec({
      type: "linked-structure",
      title: "x",
      nodes: [
        { id: "a", label: "A" },
        { id: "a", label: "dup" },
      ],
    }),
    null,
  );
  // links are optional — a node-only structure is valid
  const nodesOnly = parseRemedialVisualSpec({
    type: "linked-structure",
    title: "x",
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  }) as RemedialLinkedStructureSpec | null;
  assert.ok(nodesOnly);
  assert.deepEqual(nodesOnly.links, []);
});

/* ---------------- 10. max limits / oversized response rejection ---------------- */

test("10. oversized AI responses are rejected, not truncated", () => {
  assert.equal(
    parseRemedialVisualSpec({
      type: "sequence",
      title: "x",
      steps: Array.from({ length: L.maxSteps + 1 }, (_, i) => ({ label: `s${i}` })),
    }),
    null,
  );
  assert.equal(
    parseRemedialVisualSpec({
      type: "linked-structure",
      title: "x",
      nodes: Array.from({ length: L.maxNodes + 1 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })),
    }),
    null,
  );
  assert.equal(
    parseRemedialVisualSpec({
      type: "array",
      title: "x",
      cells: Array.from({ length: L.maxCells + 1 }, () => ({ value: "1" })),
    }),
    null,
  );
  assert.equal(
    parseRemedialVisualSpec({
      type: "sequence",
      title: "x".repeat(L.title + 1),
      steps: [{ label: "a" }, { label: "b" }],
    }),
    null,
  );
  assert.equal(
    parseRemedialVisualSpec({
      type: "process",
      title: "x",
      steps: [{ label: "ok" }, { label: "y".repeat(L.label + 1) }],
    }),
    null,
  );
});

/* ---------------- structural: renderer / panel / prompt ---------------- */

const specViewSrc = readFileSync(
  fileURLToPath(new URL("../components/course/RemedialVisualSpec.tsx", import.meta.url)),
  "utf8",
);
const panelSrc = readFileSync(
  fileURLToPath(new URL("../components/course/RecoveryRoadmap.tsx", import.meta.url)),
  "utf8",
);
const fnSrc = readFileSync(
  fileURLToPath(new URL("./remedial.functions.ts", import.meta.url)),
  "utf8",
);
const engagementSrc = readFileSync(
  fileURLToPath(new URL("./remedial-engagement.ts", import.meta.url)),
  "utf8",
);

test("11. the renderer has a branch for every specialised type + a concept-map fallback", () => {
  for (const type of REMEDIAL_VISUAL_TYPES) {
    if (type === "concept-map") continue;
    assert.match(specViewSrc, new RegExp(`case "${type}":`));
  }
  // concept-map / null / unknown -> the R3 component
  assert.match(
    specViewSrc,
    /if \(isConceptMapSpec\(spec\)\) return <RemedialVisual model=\{fallbackModel\} \/>/,
  );
  assert.match(specViewSrc, /default:\s*\n\s*return <RemedialVisual model=\{fallbackModel\} \/>/);
});

test("12. wide content scrolls in its own container (no page overflow)", () => {
  assert.match(specViewSrc, /overflow-x-auto[\s\S]{0,80}<table/);
  assert.match(specViewSrc, /overflow-x-auto[\s\S]{0,200}cells\.map/);
});

test("13. array highlight is not colour-only (ring + bold + sr-only marker)", () => {
  assert.match(specViewSrc, /sr-only">highlighted: /);
  assert.match(specViewSrc, /cell\.highlight\s*\?[\s\S]{0,120}(font-bold|ring-)/);
});

test("14. table + linked-structure use semantic elements", () => {
  assert.match(specViewSrc, /<th[^>]*scope="col"/);
  assert.match(specViewSrc, /<ol[\s\S]{0,40}role="list"/);
});

test("15. panel validates the persisted visual (untrusted) and passes a fallback model", () => {
  assert.match(panelSrc, /parseRemedialVisualSpec\(content\.visual\)/);
  assert.match(
    panelSrc,
    /<RemedialVisualView spec=\{visualSpec\} fallbackModel=\{visualModel\} \/>/,
  );
});

test("16. the generation prompt asks for the visual in ONE call — no second AI call", () => {
  assert.match(fnSrc, /REMEDIAL_VISUAL_PROMPT_SHAPES/);
  assert.match(fnSrc, /never invent technical relationships|only content the material supports/i);
  // still exactly one generator, one attempt helper (json + plain retry of the SAME call)
  assert.equal((fnSrc.match(/async function runRemedialGeneration/g) ?? []).length, 1);
  assert.doesNotMatch(
    fnSrc,
    /generateVisual|runVisualGeneration|second AI|callAI\([\s\S]{0,40}visual/i,
  );
});

/* ---------------- R4 / A7 isolation ---------------- */

test("17. R4 visual meaningful-engagement threshold does NOT depend on the visual spec", () => {
  // the threshold reads text-length fields only — never `content.visual`
  assert.match(engagementSrc, /remedialDisplayTextLength/);
  assert.doesNotMatch(engagementSrc, /\.visual\b|RemedialVisualSpec|visualSpec/);
  // text and visual still share the reading-time threshold
  assert.match(
    engagementSrc,
    /modality: "text",\s*textLength: remedialDisplayTextLength\(content\)/,
  );
});

test("18. R5 introduces no new R4 event types and touches no A7 code", () => {
  assert.doesNotMatch(
    specViewSrc,
    /remedial_format_selected|remedial_meaningful_engagement|logRemedialInteraction/,
  );
  assert.doesNotMatch(fnSrc, /remedial_format_selected|remedial_meaningful_engagement/);
  // no adaptive/vark/reward writes anywhere in the new spec module
  const specSrc = readFileSync(
    fileURLToPath(new URL("./remedial-visual-spec.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(
    specSrc,
    /adaptive|buildModalityEvidence|vark|learning_interactions|supabase/i,
  );
});
