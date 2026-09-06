/**
 * R5 — Concept-Aware Visual Remediation.
 *
 * A strict, bounded discriminated union describing ONE visual structure that
 * fits the weak CS concept being remediated (a sorting sequence, an OSI-style
 * hierarchy, a normalization comparison, an indexed array, a linked list, …).
 *
 * The spec is produced by the SAME single AI call that writes the remedial
 * lesson (see remedial.functions.ts) and persisted inside `remedial_content`
 * — no image APIs, no second AI call, no new table.
 *
 * AI output is UNTRUSTED. `parseRemedialVisualSpec` validates the type, the
 * required fields, per-string lengths and node/step/row counts, checks
 * cross-field integrity (table row widths, linked-structure node references),
 * and returns `null` on anything malformed. A `null` result — or an explicit
 * `concept-map` — falls back to the R3 concept map. A bad visual can never
 * break remedial generation or the Study Path.
 *
 * Pure — no React, no network, no `window`.
 */

import { z } from "zod";

export const REMEDIAL_VISUAL_TYPES = [
  "sequence",
  "process",
  "hierarchy",
  "comparison",
  "table",
  "array",
  "linked-structure",
  "concept-map",
] as const;

export type RemedialVisualType = (typeof REMEDIAL_VISUAL_TYPES)[number];

/** Hard caps — an AI response exceeding any of these is rejected, not truncated. */
export const REMEDIAL_VISUAL_LIMITS = {
  title: 120,
  label: 160,
  detail: 400,
  point: 200,
  cellValue: 40,
  nodeId: 48,
  linkLabel: 60,
  maxSteps: 12,
  maxLevels: 10,
  minComparisonItems: 2,
  maxComparisonItems: 4,
  maxComparisonPoints: 6,
  maxColumns: 6,
  maxRows: 12,
  maxCells: 24,
  minNodes: 2,
  maxNodes: 12,
  maxLinks: 24,
} as const;

const L = REMEDIAL_VISUAL_LIMITS;

const title = z.string().trim().min(1).max(L.title);
const label = z.string().trim().min(1).max(L.label);
const detail = z.string().trim().min(1).max(L.detail);
const point = z.string().trim().min(1).max(L.point);

const sequenceStep = z.object({
  label,
  /** optional snapshot of the structure at this stage, e.g. "[1, 5, 3] → [1, 3, 5]". */
  state: detail.optional(),
});

const processStep = z.object({ label, detail: detail.optional() });

const sequenceSchema = z.object({
  type: z.literal("sequence"),
  title,
  steps: z.array(sequenceStep).min(2).max(L.maxSteps),
});

const processSchema = z.object({
  type: z.literal("process"),
  title,
  steps: z.array(processStep).min(2).max(L.maxSteps),
});

const hierarchySchema = z.object({
  type: z.literal("hierarchy"),
  title,
  /** ordered top → bottom (layer 1 first). */
  levels: z
    .array(z.object({ label, detail: detail.optional() }))
    .min(2)
    .max(L.maxLevels),
});

const comparisonSchema = z.object({
  type: z.literal("comparison"),
  title,
  items: z
    .array(z.object({ name: label, points: z.array(point).min(1).max(L.maxComparisonPoints) }))
    .min(L.minComparisonItems)
    .max(L.maxComparisonItems),
});

const tableSchema = z.object({
  type: z.literal("table"),
  title,
  columns: z.array(label).min(1).max(L.maxColumns),
  rows: z
    .array(z.array(z.string().trim().max(L.point)).min(1).max(L.maxColumns))
    .min(1)
    .max(L.maxRows),
});

const arraySchema = z.object({
  type: z.literal("array"),
  title,
  cells: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(L.cellValue),
        highlight: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(L.maxCells),
  caption: detail.optional(),
});

const linkedStructureSchema = z.object({
  type: z.literal("linked-structure"),
  title,
  nodes: z
    .array(z.object({ id: z.string().trim().min(1).max(L.nodeId), label }))
    .min(L.minNodes)
    .max(L.maxNodes),
  links: z
    .array(
      z.object({
        from: z.string().trim().min(1).max(L.nodeId),
        to: z.string().trim().min(1).max(L.nodeId),
        label: z.string().trim().min(1).max(L.linkLabel).optional(),
      }),
    )
    .max(L.maxLinks)
    .optional()
    .default([]),
});

const conceptMapSchema = z.object({
  type: z.literal("concept-map"),
  title: title.optional(),
});

export const remedialVisualSpecSchema = z.discriminatedUnion("type", [
  sequenceSchema,
  processSchema,
  hierarchySchema,
  comparisonSchema,
  tableSchema,
  arraySchema,
  linkedStructureSchema,
  conceptMapSchema,
]);

export type RemedialVisualSpec = z.infer<typeof remedialVisualSpecSchema>;
export type RemedialSequenceSpec = z.infer<typeof sequenceSchema>;
export type RemedialProcessSpec = z.infer<typeof processSchema>;
export type RemedialHierarchySpec = z.infer<typeof hierarchySchema>;
export type RemedialComparisonSpec = z.infer<typeof comparisonSchema>;
export type RemedialTableSpec = z.infer<typeof tableSchema>;
export type RemedialArraySpec = z.infer<typeof arraySchema>;
export type RemedialLinkedStructureSpec = z.infer<typeof linkedStructureSchema>;

/**
 * Validate an untrusted visual spec (from the AI reply, or a persisted row).
 * Returns the typed spec, or `null` — the caller then renders the R3 concept
 * map. Never throws.
 */
export function parseRemedialVisualSpec(raw: unknown): RemedialVisualSpec | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const res = remedialVisualSpecSchema.safeParse(raw);
  if (!res.success) return null;
  const spec = res.data;

  if (spec.type === "table") {
    const width = spec.columns.length;
    if (spec.rows.some((row) => row.length !== width)) return null;
  }

  if (spec.type === "linked-structure") {
    const ids = new Set(spec.nodes.map((n) => n.id));
    if (ids.size !== spec.nodes.length) return null; // duplicate node ids
    if (spec.links.some((lnk) => !ids.has(lnk.from) || !ids.has(lnk.to))) return null;
  }

  return spec;
}

/** True when this spec should render as the R3 concept map (explicit fallback). */
export function isConceptMapSpec(spec: RemedialVisualSpec | null): boolean {
  return spec == null || spec.type === "concept-map";
}

/** The compact JSON-shape hint embedded in the generation prompt. Kept next to
 *  the schema so the two never drift. */
export const REMEDIAL_VISUAL_PROMPT_SHAPES = [
  `sequence:         { "type": "sequence", "title": string, "steps": [{ "label": string, "state"?: string }] }   // ordered stages, e.g. sorting passes`,
  `process:          { "type": "process", "title": string, "steps": [{ "label": string, "detail"?: string }] }   // steps performed in order`,
  `hierarchy:        { "type": "hierarchy", "title": string, "levels": [{ "label": string, "detail"?: string }] } // top→bottom layers, e.g. OSI model`,
  `comparison:       { "type": "comparison", "title": string, "items": [{ "name": string, "points": string[] }] } // 2–4 concepts side by side`,
  `table:            { "type": "table", "title": string, "columns": string[], "rows": string[][] }               // every row has columns.length cells`,
  `array:            { "type": "array", "title": string, "cells": [{ "value": string, "highlight"?: boolean }], "caption"?: string }`,
  `linked-structure: { "type": "linked-structure", "title": string, "nodes": [{ "id": string, "label": string }], "links": [{ "from": id, "to": id, "label"?: string }] }`,
  `concept-map:      { "type": "concept-map" }                                                                    // use when no specialised structure fits`,
].join("\n");
