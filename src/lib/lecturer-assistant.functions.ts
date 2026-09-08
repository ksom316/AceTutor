import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/course-chat.functions";
import {
  computeAssessmentCoverage,
  computeModuleCohorts,
  courseInsights,
  summariseCourseModules,
  type LecturerModuleAttempt,
  type ModuleCohort,
} from "@/lib/lecturer-analytics";
import type { PerfTopic } from "@/lib/quiz-performance";

/**
 * AI Lecturer Assistant — an interpretation layer over the deterministic
 * Phase 10 analytics.
 *
 * The lecturer asks a plain-language question about THEIR OWN course. This
 * server function:
 *   1. authenticates the caller and derives their course server-side
 *      (current_lecturer_course() — a client course id is never accepted);
 *   2. fetches only that course's authorized data (topics + the SECURITY
 *      DEFINER get_course_quiz_performance() rows + enrolled count);
 *   3. computes the SAME analytics the /lecturer/performance page shows, using
 *      the shared pure helpers in lecturer-analytics.ts / quiz-performance.ts —
 *      never a second performance calculation, never client-supplied numbers;
 *   4. serialises a compact, aggregate-only context (no names, emails or ids);
 *   5. sends it to the shared OpenRouter path (callAI) with a grounded system
 *      prompt and returns the answer.
 *
 * It is advisory only — it cannot change grades, quizzes, lessons, course
 * settings or Study Paths.
 */

const schema = z.object({
  question: z.string().trim().min(1).max(500),
});

export type LecturerAssistantResult = { answer: string };

export const LECTURER_ASSISTANT_ERRORS: Record<string, string> = {
  NOT_A_LECTURER: "Only a lecturer with an assigned course can use the assistant.",
  AI_FAILED: "The AI assistant couldn't respond right now. Please try again.",
};

export function lecturerAssistantErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return LECTURER_ASSISTANT_ERRORS[raw] ?? LECTURER_ASSISTANT_ERRORS.AI_FAILED;
}

/** One row from get_course_quiz_performance() — see 20260905120000_*.sql. */
type PerfRpcRow = {
  attempt_id: string;
  student: string;
  quiz_type: "module" | "general";
  topic_id: string | null;
  score: number | null;
  total: number | null;
  answered_count: number | null;
  started_at: string | null;
  finished_at: string | null;
};

const STATE_LABEL: Record<ModuleCohort["state"], string> = {
  "no-data": "not assessed",
  insufficient: "insufficient evidence",
  weak: "needs attention",
  strong: "strong",
};

/** Compact, aggregate-only serialisation of the course analytics. */
function serialiseContext(args: {
  courseTitle: string;
  courseSummary: string | null;
  cohorts: ModuleCohort[];
  coverage: ReturnType<typeof computeAssessmentCoverage>;
  summary: ReturnType<typeof summariseCourseModules>;
  insights: string[];
}): string {
  const { courseTitle, courseSummary, cohorts, coverage, summary, insights } = args;
  const lines: string[] = [];

  lines.push(`COURSE: ${courseTitle}`);
  if (courseSummary) lines.push(`SUMMARY: ${courseSummary.slice(0, 600)}`);

  lines.push("");
  lines.push("ASSESSMENT COVERAGE (of enrolled students):");
  lines.push(
    `- Meaningful evidence (>=1 sufficient attempt): ${coverage.meaningful}/${coverage.enrolled}`,
  );
  lines.push(`- Insufficient evidence only: ${coverage.insufficientOnly}/${coverage.enrolled}`);
  lines.push(`- Not assessed at all: ${coverage.notAssessed}/${coverage.enrolled}`);

  lines.push("");
  lines.push(
    summary.overall !== null
      ? `EVIDENCE-BASED COURSE AVERAGE (mean of assessed module averages, sufficient attempts only): ${summary.overall}%`
      : "EVIDENCE-BASED COURSE AVERAGE: not enough sufficient evidence to compute one yet",
  );

  lines.push("");
  lines.push("MODULES (in course order):");
  cohorts.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.topic.title}`);
    lines.push(`   state: ${STATE_LABEL[c.state]}`);
    lines.push(
      c.averageScore !== null
        ? `   cohort average: ${c.averageScore}%`
        : "   cohort average: n/a (no sufficient evidence)",
    );
    lines.push(
      `   students with sufficient evidence: ${c.assessedStudents}; with insufficient evidence: ${c.insufficientStudents}`,
    );
    if (c.trend.length >= 2) {
      lines.push(
        `   trend (mean of students' 1st, 2nd... sufficient attempts): ${c.trend.map((n) => `${n}%`).join(" -> ")}`,
      );
    }
    if (c.improvedStudents > 0 || c.declinedStudents > 0) {
      lines.push(
        `   since previous sufficient attempt: ${c.improvedStudents} improved, ${c.declinedStudents} declined`,
      );
    }
  });

  if (insights.length) {
    lines.push("");
    lines.push("DETERMINISTIC INSIGHTS (already computed from the above):");
    for (const s of insights) lines.push(`- ${s}`);
  }

  lines.push("");
  lines.push("DEFINITIONS:");
  lines.push(
    "- A 'sufficient' attempt is a finished quiz where the student answered at least 3 questions AND at least half of the quiz. ONLY sufficient attempts affect an average, a state or a trend.",
  );
  lines.push(
    "- 'insufficient evidence' means the student has answered some questions but not enough for a reliable assessment. This is NOT poor performance.",
  );
  lines.push(
    "- 'needs attention' = sufficiently-assessed average below 70%. 'strong' = 70% or above.",
  );
  lines.push("- 'not assessed' = no usable attempt for that module yet.");
  lines.push(
    "- Each module is assessed independently; course completion is a separate concept and is not in this data.",
  );

  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You are an AI teaching assistant for a university lecturer, working inside AceTutor's course " +
  "performance dashboard. You answer questions about ONE course — the lecturer's own — using the " +
  "structured ANALYTICS provided in the prompt.\n\n" +
  "Rules:\n" +
  "- The ANALYTICS are authoritative and were computed from real quiz attempts. Treat every number, " +
  "state and trend in them as fact. NEVER invent or estimate a score, student count, average, trend " +
  "or coverage figure that is not in the ANALYTICS.\n" +
  "- Always distinguish 'insufficient evidence' (not enough answered questions yet) from 'needs " +
  "attention' (genuinely lower performance). Never call a module weak, or say students are " +
  "struggling, when the evidence for it is only insufficient.\n" +
  "- If the ANALYTICS don't contain enough sufficient evidence to answer, say so plainly instead of " +
  "guessing. Match your confidence to the amount of evidence.\n" +
  "- You may interpret and compare modules, describe a trend as improving / declining / flat, and " +
  "suggest instructional actions — but frame actions as suggestions ('consider...', 'it may help " +
  "to...'), never as instructions or established facts.\n" +
  "- Do NOT claim causation. The data shows performance, not its cause. Never attribute results to " +
  "teaching methods, lesson quality, or students' character or effort.\n" +
  "- For general pedagogy questions (e.g. how to explain a concept to beginners) you may use your " +
  "own subject knowledge, but anything specific to THIS course's performance must come from the " +
  "ANALYTICS.\n" +
  "- Use supportive, professional language: 'needs attention', 'lower performance', 'insufficient " +
  "evidence', 'consider revisiting'. Never 'bad/weak/lazy/failed students'.\n" +
  "- You are advisory only. Do not claim to have changed, or offer to change, grades, quizzes, " +
  "lessons, course settings or Study Paths.\n" +
  "- Be concise: Markdown, short paragraphs or bullet points, no preamble.";

export const askLecturerAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<LecturerAssistantResult> => {
    const { supabase } = context;

    // Course derived server-side from the authenticated lecturer. A client
    // course id is never accepted.
    const { data: courseId } = await supabase.rpc("current_lecturer_course");
    if (!courseId) throw new Error("NOT_A_LECTURER");

    const [courseRes, topicsRes, perfRes, studentsRes] = await Promise.all([
      supabase.from("courses").select("title, summary").eq("id", courseId).maybeSingle(),
      supabase
        .from("topics")
        .select("id, title, order_index")
        .eq("course_id", courseId)
        .order("order_index"),
      supabase.rpc("get_course_quiz_performance"),
      supabase.rpc("get_course_students"),
    ]);

    const courseTitle = courseRes.data?.title ?? "This course";
    const courseSummary = (courseRes.data?.summary ?? "").trim() || null;
    const topics = (topicsRes.data ?? []) as PerfTopic[];
    const enrolled = (studentsRes.data ?? []).length;
    const rows = (perfRes.data ?? []) as unknown as PerfRpcRow[];

    // Module attempts only, reshaped to the shared PerfAttempt contract. General
    // course quizzes are course-wide, not module-scoped, and are excluded here.
    const moduleAttempts: LecturerModuleAttempt[] = rows
      .filter((r) => r.quiz_type === "module" && !!r.topic_id)
      .map((r) => ({
        id: r.attempt_id,
        topic_id: r.topic_id,
        score: r.score,
        total: r.total,
        finished_at: r.finished_at,
        answered_count: r.answered_count,
        started_at: r.started_at,
        student: r.student,
      }));

    const cohorts = computeModuleCohorts(topics, moduleAttempts);
    const coverage = computeAssessmentCoverage(enrolled, topics, moduleAttempts);
    const summary = summariseCourseModules(cohorts);
    const insights = courseInsights(cohorts, coverage);

    const contextBlock = serialiseContext({
      courseTitle,
      courseSummary,
      cohorts,
      coverage,
      summary,
      insights,
    });

    const user = `ANALYTICS (authoritative — the only source for this course's numbers):
${contextBlock}

LECTURER'S QUESTION:
${data.question}

Answer using the ANALYTICS above. If the evidence there isn't enough to answer, say what is missing rather than guessing.`;

    let answer = "";
    try {
      answer = await callAI(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        { maxTokens: 700 },
      );
    } catch (err) {
      console.error(
        `[askLecturerAssistant] AI call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error("AI_FAILED");
    }

    if (!answer.trim()) throw new Error("AI_FAILED");
    return { answer };
  });
