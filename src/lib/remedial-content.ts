/**
 * R1 — the structured remedial lesson contract + defensive parsing.
 *
 * ONE underlying lesson object, reusable across formats: R1 renders it as text;
 * R2 will speak the same `explanation` via browser SpeechSynthesis; R3 will
 * turn the same `weakConcepts` / `keyPoints` into a diagram. Generation is
 * never coupled to the text UI — see RemedialContentView.
 *
 * Pure — no React, no Supabase, no AI client.
 */

import { z } from "zod";
import { REMEDIAL_MODALITIES, type RemedialModality } from "@/lib/remedial-modality";

export const remedialContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  /** The specific weaknesses this lesson teaches — from the Study Path. */
  weakConcepts: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  summary: z.string().trim().min(1).max(1500),
  explanation: z.string().trim().min(1).max(8000),
  workedExample: z.string().trim().min(1).max(5000).optional(),
  keyPoints: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  practicePrompt: z.string().trim().min(1).max(1500).optional(),
});

export type RemedialContent = z.infer<typeof remedialContentSchema>;

export const persistedRemedialSchema = z.object({
  content: remedialContentSchema,
  modality: z.enum(REMEDIAL_MODALITIES as unknown as [RemedialModality, ...RemedialModality[]]),
  generatedAt: z.string(),
});

export type PersistedRemedial = z.infer<typeof persistedRemedialSchema>;

/* ---- defensive JSON extraction + validation (mirrors parseStudyPath) ---- */

function extractJsonObject(raw: string): string {
  const s = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}

/**
 * Parse a model reply into a validated RemedialContent, or null if nothing
 * usable survives. `fallbackConcepts` (the Study Path weak-area titles) seed
 * `weakConcepts` when the model omits or mangles them.
 */
export function parseRemedialContent(
  raw: string,
  fallbackConcepts: string[],
  fallbackTitle = "Personalized explanation",
): RemedialContent | null {
  if (!raw || !raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];

  const cleanConcepts = asStringArray(obj.weakConcepts ?? obj.weak_concepts);
  const weakConcepts = (cleanConcepts.length > 0 ? cleanConcepts : fallbackConcepts)
    .map((s) => s.trim())
    .slice(0, 10);

  const keyPoints = asStringArray(obj.keyPoints ?? obj.key_points)
    .map((s) => s.trim())
    .slice(0, 12);

  const candidate = {
    title:
      typeof obj.title === "string" && obj.title.trim()
        ? obj.title.trim().slice(0, 160)
        : fallbackTitle,
    weakConcepts,
    summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
    explanation: typeof obj.explanation === "string" ? obj.explanation.trim() : "",
    workedExample:
      typeof (obj.workedExample ?? obj.worked_example) === "string"
        ? String(obj.workedExample ?? obj.worked_example).trim() || undefined
        : undefined,
    keyPoints,
    practicePrompt:
      typeof (obj.practicePrompt ?? obj.practice_prompt) === "string"
        ? String(obj.practicePrompt ?? obj.practice_prompt).trim() || undefined
        : undefined,
  };

  const result = remedialContentSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** The spoken/subtitle script for R2 (audio). Kept here so the source of truth
 *  for "what the lesson says" is format-independent. */
export function remedialContentToScript(content: RemedialContent): string {
  const parts = [
    content.title,
    content.summary,
    content.explanation,
    content.workedExample ? `Worked example. ${content.workedExample}` : null,
    content.keyPoints.length ? `Key points. ${content.keyPoints.join(". ")}.` : null,
    content.practicePrompt ? `Practice. ${content.practicePrompt}` : null,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.join("\n\n");
}
