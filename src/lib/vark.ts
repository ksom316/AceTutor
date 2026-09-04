/**
 * VARK learner-profile foundation (Phase A1).
 *
 * Pure — no React, no Supabase, no AI. A short (14-question) practical
 * assessment: every question offers exactly one option per VARK dimension
 * (Visual / Auditory / Read-Write / Kinesthetic), and the student may select
 * ONE OR MORE options per question — this is what "allow mixed preferences"
 * means here: nothing forces a response into a single exclusive category, and
 * the result is always shown as a V/A/R/K score BREAKDOWN, never just a single
 * label.
 *
 * Scoring is deterministic and additive: each selected option contributes +1
 * to its dimension. The category with the highest total becomes the
 * `predicted_category` — explicitly a PROVISIONAL, assessment-derived result
 * (`prediction_source: "assessment"`). A later phase's ML classifier
 * (Random Forest / Gradient Boosting — NOT implemented here) would write
 * `prediction_source: "ml_model"` instead; nothing in this file claims to be
 * that model.
 *
 * This is a separate, additive concept from `learning_preferences` (explicit
 * self-reported "how would you like this presented" — src/routes/_authenticated/
 * onboarding.preferences.tsx). Together they form the two halves of the
 * student's "learner profile." Neither restricts access to any lesson format
 * or course content — see src/lib/course-chat.functions.ts's own comments on
 * the same non-gating principle for learning_preferences, which this follows.
 */

export type VarkCategory = "visual" | "auditory" | "read_write" | "kinesthetic";

export const VARK_CATEGORIES: readonly VarkCategory[] = [
  "visual",
  "auditory",
  "read_write",
  "kinesthetic",
] as const;

export const VARK_CATEGORY_LABEL: Record<VarkCategory, string> = {
  visual: "Visual",
  auditory: "Auditory",
  read_write: "Read/Write",
  kinesthetic: "Kinesthetic",
};

/** Deliberately phrased as a tendency, never an exclusive ability — a student
 *  can and does learn through every modality; this only names which one
 *  tends to click fastest for them. */
export const VARK_CATEGORY_DESCRIPTION: Record<VarkCategory, string> = {
  visual: "Ideas tend to click fastest through diagrams, charts, and images.",
  auditory: "Ideas tend to click fastest through listening and talking things through.",
  read_write: "Ideas tend to click fastest through reading and writing notes.",
  kinesthetic: "Ideas tend to click fastest through hands-on practice and real examples.",
};

export type VarkOption = { dimension: VarkCategory; label: string };
export type VarkQuestion = { id: string; prompt: string; options: VarkOption[] };

/** questionId -> the dimension(s) the student selected for it (1 or more). */
export type VarkResponses = Record<string, VarkCategory[]>;

export type VarkScores = Record<VarkCategory, number>;

/**
 * 14 short, practical, positively-framed study/learning scenarios. Every
 * question's options are in a fixed V/A/R/K order and map 1:1 to a dimension —
 * deterministic and never re-derived from option text.
 */
export const VARK_QUESTIONS: VarkQuestion[] = [
  {
    id: "q1",
    prompt: "When you're learning something brand new, what helps you understand it fastest?",
    options: [
      { dimension: "visual", label: "A diagram or picture that shows how it all fits together" },
      { dimension: "auditory", label: "Someone explaining it out loud, or talking it through" },
      { dimension: "read_write", label: "A clear written explanation or set of notes to read" },
      { dimension: "kinesthetic", label: "Trying it myself and learning by doing" },
    ],
  },
  {
    id: "q2",
    prompt: "You need to find an unfamiliar place on campus. What do you reach for?",
    options: [
      { dimension: "visual", label: "A map" },
      { dimension: "auditory", label: "Someone telling me the directions out loud" },
      { dimension: "read_write", label: "A written list of turns and street names" },
      { dimension: "kinesthetic", label: "Just start walking and adjust as I go" },
    ],
  },
  {
    id: "q3",
    prompt: "How do you prefer to revise for a test?",
    options: [
      { dimension: "visual", label: "Diagrams, charts, or mind maps" },
      { dimension: "auditory", label: "Talking it through out loud, or listening to a recap" },
      { dimension: "read_write", label: "Rewriting notes and summaries" },
      { dimension: "kinesthetic", label: "Working through practice questions" },
    ],
  },
  {
    id: "q4",
    prompt: "You're assembling something new (furniture, a gadget). Where do you start?",
    options: [
      { dimension: "visual", label: "The picture diagrams in the instructions" },
      { dimension: "auditory", label: "Having someone talk me through the steps" },
      { dimension: "read_write", label: "Reading the instruction manual carefully" },
      { dimension: "kinesthetic", label: "Just start building and figure it out" },
    ],
  },
  {
    id: "q5",
    prompt: "A lecturer is explaining a tricky topic. What helps most?",
    options: [
      { dimension: "visual", label: "Slides with diagrams and visuals" },
      { dimension: "auditory", label: "Explaining it aloud with spoken examples" },
      { dimension: "read_write", label: "A detailed handout I can read" },
      { dimension: "kinesthetic", label: "Working through a live example together" },
    ],
  },
  {
    id: "q6",
    prompt: "You're learning a new app or piece of software. What's your go-to?",
    options: [
      { dimension: "visual", label: "A screen-recording video tutorial" },
      { dimension: "auditory", label: "Someone walking me through it verbally" },
      { dimension: "read_write", label: "Reading the documentation" },
      { dimension: "kinesthetic", label: "Clicking around and trying things myself" },
    ],
  },
  {
    id: "q7",
    prompt: "How do you best remember a new code or number?",
    options: [
      { dimension: "visual", label: "Picture the shape/pattern of the digits" },
      { dimension: "auditory", label: "Repeat it out loud a few times" },
      { dimension: "read_write", label: "Write it down" },
      { dimension: "kinesthetic", label: "Type or dial it out a few times" },
    ],
  },
  {
    id: "q8",
    prompt: "What kind of feedback on your work helps you improve most?",
    options: [
      { dimension: "visual", label: "Marked-up or highlighted diagrams/documents" },
      { dimension: "auditory", label: "A conversation talking through what to change" },
      { dimension: "read_write", label: "Detailed written comments" },
      { dimension: "kinesthetic", label: "A chance to redo it a different way" },
    ],
  },
  {
    id: "q9",
    prompt: "Choosing revision material for a module — what do you pick first?",
    options: [
      { dimension: "visual", label: "An infographic or short video" },
      { dimension: "auditory", label: "A podcast-style audio recap" },
      { dimension: "read_write", label: "A textbook chapter or article" },
      { dimension: "kinesthetic", label: "A practice quiz or problem set" },
    ],
  },
  {
    id: "q10",
    prompt: "You understand a topic well and need to explain it to a friend. How?",
    options: [
      { dimension: "visual", label: "Draw it out" },
      { dimension: "auditory", label: "Just talk them through it" },
      { dimension: "read_write", label: "Write it down step by step" },
      { dimension: "kinesthetic", label: "Show them by actually doing it" },
    ],
  },
  {
    id: "q11",
    prompt: "Preparing for a group presentation, what do you do first?",
    options: [
      { dimension: "visual", label: "Build slides with visuals" },
      { dimension: "auditory", label: "Rehearse my part out loud" },
      { dimension: "read_write", label: "Write out a script" },
      { dimension: "kinesthetic", label: "Do a full practice run-through" },
    ],
  },
  {
    id: "q12",
    prompt: "Learning a new sport or physical skill, what helps most?",
    options: [
      { dimension: "visual", label: "Watching video of the correct technique" },
      { dimension: "auditory", label: "A coach's spoken instructions" },
      { dimension: "read_write", label: "A written strategy guide" },
      { dimension: "kinesthetic", label: "Just getting out there and practicing" },
    ],
  },
  {
    id: "q13",
    prompt: "You're stuck on a hard problem. What do you try first?",
    options: [
      { dimension: "visual", label: "Sketch it out or draw a diagram" },
      { dimension: "auditory", label: "Talk it through with someone" },
      { dimension: "read_write", label: "Write out the steps, or re-read the material" },
      { dimension: "kinesthetic", label: "Try a few different approaches hands-on" },
    ],
  },
  {
    id: "q14",
    prompt: "Ideally, how would a course introduce a brand-new topic to you?",
    options: [
      { dimension: "visual", label: "Video lessons with visuals" },
      { dimension: "auditory", label: "An audio lecture or discussion" },
      { dimension: "read_write", label: "A written lesson I can read" },
      { dimension: "kinesthetic", label: "An interactive exercise or simulation" },
    ],
  },
];

/** Every question answered with at least one selection. */
export function isVarkAssessmentComplete(
  responses: VarkResponses,
  questions: VarkQuestion[] = VARK_QUESTIONS,
): boolean {
  return questions.every((q) => (responses[q.id]?.length ?? 0) > 0);
}

/** +1 to a dimension for every question where the student selected it. */
export function computeVarkScores(responses: VarkResponses): VarkScores {
  const scores: VarkScores = { visual: 0, auditory: 0, read_write: 0, kinesthetic: 0 };
  for (const dims of Object.values(responses)) {
    for (const d of dims) {
      if (d === "visual" || d === "auditory" || d === "read_write" || d === "kinesthetic") {
        scores[d] += 1;
      }
    }
  }
  return scores;
}

/** Fixed, deterministic tie-break order — arbitrary but never random, applied
 *  only when two or more categories share the top score. Documented here so
 *  it's the ONE place this rule lives. */
export const VARK_TIE_BREAK_ORDER: readonly VarkCategory[] = VARK_CATEGORIES;

export type VarkPrimaryResult = {
  /** null only when there is no signal at all (every score is 0). */
  category: VarkCategory | null;
  /** true when 2+ categories share the top score — `category` is still a
   *  deterministic pick (VARK_TIE_BREAK_ORDER), but the UI should say so. */
  tied: boolean;
  /** All 4 categories, highest score first; ties broken by VARK_TIE_BREAK_ORDER
   *  (Array.prototype.sort is stable, so equal scores keep that order). */
  ranked: { category: VarkCategory; score: number }[];
};

export function derivePrimaryVarkCategory(scores: VarkScores): VarkPrimaryResult {
  const ranked = VARK_TIE_BREAK_ORDER.map((category) => ({
    category,
    score: scores[category],
  })).sort((a, b) => b.score - a.score);
  const total = ranked.reduce((s, r) => s + r.score, 0);
  if (total === 0) return { category: null, tied: false, ranked };
  const top = ranked[0].score;
  const tied = ranked.filter((r) => r.score === top).length > 1;
  return { category: ranked[0].category, tied, ranked };
}

/** Each category's share of the total, 0–100, for the score-breakdown UI.
 *  All zero when there is no signal yet, rather than dividing by zero. */
export function varkScorePercentages(scores: VarkScores): Record<VarkCategory, number> {
  const total = VARK_CATEGORIES.reduce((s, c) => s + scores[c], 0);
  const pct: Record<VarkCategory, number> = {
    visual: 0,
    auditory: 0,
    read_write: 0,
    kinesthetic: 0,
  };
  if (total === 0) return pct;
  for (const c of VARK_CATEGORIES) pct[c] = Math.round((scores[c] / total) * 100);
  return pct;
}

/* ---- shared DB-row shape (reusable across the hook, routes, and later phases) ---- */

export type VarkPredictionSource = "assessment" | "ml_model";

/** Mirrors public.vark_profiles exactly (snake_case, matching the DB), the
 *  same convention this codebase uses for AppNotification / PerfAttempt. */
export type VarkProfileRow = {
  user_id: string;
  responses: VarkResponses | null;
  visual_score: number;
  auditory_score: number;
  read_write_score: number;
  kinesthetic_score: number;
  predicted_category: VarkCategory | null;
  prediction_source: VarkPredictionSource;
  prediction_confidence: number | null;
  model_version: string | null;
  assessment_completed_at: string | null;
  updated_at: string;
};

export type VarkAssessmentStatus = "not-started" | "completed";

export function varkAssessmentStatus(profile: VarkProfileRow | null): VarkAssessmentStatus {
  return profile?.assessment_completed_at ? "completed" : "not-started";
}

/** `profile.*_score` -> the plain VarkScores shape scoring/breakdown helpers
 *  expect, so callers never have to hand-pick the 4 fields themselves. */
export function scoresFromProfile(profile: VarkProfileRow): VarkScores {
  return {
    visual: profile.visual_score,
    auditory: profile.auditory_score,
    read_write: profile.read_write_score,
    kinesthetic: profile.kinesthetic_score,
  };
}
