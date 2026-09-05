/**
 * R3 — pure, deterministic transformation of the SAME persisted
 * `RemedialContent` into a small visual-learning-map model.
 *
 * It only re-organises the strings already in `RemedialContent` — it invents
 * no facts, examples, weak concepts, quiz answers, or relationships. In
 * particular it NEVER pairs an individual key point with an individual weak
 * concept: `RemedialContent` doesn't carry that link, so the model keeps
 * "focus concepts" and "key ideas" as two separate flat lists, connected only
 * at the learning-flow level (concepts → ideas → example → practice).
 *
 * Not persisted — always derived from `remedial_content`.
 *
 * Pure — no React, no Supabase, no `window`.
 */

import type { RemedialContent } from "@/lib/remedial-content";

export type RemedialVisualNode = {
  /** Stable within one model (index-based), for React keys / aria wiring. */
  id: string;
  label: string;
};

export type RemedialVisualModel = {
  title: string;
  /** The unifying idea of the lesson — the map's root. This is the content
   *  title, NOT a synthesised concept. */
  centralConcept: string;
  /** The lesson summary, shown as the map's framing caption. */
  summary: string;
  /** `weakConcepts` as prominent focus nodes (>= 1 — schema-guaranteed). */
  conceptNodes: RemedialVisualNode[];
  /** `keyPoints` as compact idea nodes (>= 1 — schema-guaranteed). */
  keyPointNodes: RemedialVisualNode[];
  /** `workedExample` verbatim, or null when the content has none. */
  example: string | null;
  /** `practicePrompt` verbatim, or null when the content has none. */
  practicePrompt: string | null;
};

function toNodes(prefix: string, values: string[]): RemedialVisualNode[] {
  return values
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((label, i) => ({ id: `${prefix}-${i}`, label }));
}

export function remedialContentToVisualModel(content: RemedialContent): RemedialVisualModel {
  const example = content.workedExample?.trim() || null;
  const practicePrompt = content.practicePrompt?.trim() || null;

  return {
    title: content.title.trim(),
    centralConcept: content.title.trim(),
    summary: content.summary.trim(),
    conceptNodes: toNodes("concept", content.weakConcepts),
    keyPointNodes: toNodes("key", content.keyPoints),
    example,
    practicePrompt,
  };
}
