import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/course-chat.functions";

/**
 * AI analysis of a lecturer's course quiz performance.
 *
 * The lecturer's browser has already aggregated the numbers from
 * get_course_quiz_performance() — a SECURITY DEFINER function scoped to
 * current_lecturer_course() — so the client can only ever hold its own course's
 * data. This server fn re-checks the caller is a lecturer, then forwards ONLY
 * the small aggregated payload below to the shared OpenRouter path (callAI).
 * No raw attempt rows, emails, VARK, timestamps or ids are sent — just quiz and
 * student averages the lecturer already sees on the page.
 */

const quizStat = z.object({
  title: z.string().max(160),
  type: z.enum(["module", "general"]),
  attempts: z.number().int().min(0),
  completed: z.number().int().min(0),
  avg: z.number().min(0).max(100).nullable(),
});

const studentStat = z.object({
  name: z.string().max(120),
  completed: z.number().int().min(0),
  avg: z.number().min(0).max(100).nullable(),
});

const weekPoint = z.object({
  label: z.string().max(24),
  avg: z.number().min(0).max(100),
  completed: z.number().int().min(0),
  inProgress: z.number().int().min(0),
});

const schema = z.object({
  courseTitle: z.string().min(1).max(200),
  totals: z.object({
    enrolled: z.number().int().min(0),
    studentsAssessed: z.number().int().min(0),
    totalAttempts: z.number().int().min(0),
    completed: z.number().int().min(0),
    inProgress: z.number().int().min(0),
    averageScore: z.number().min(0).max(100).nullable(),
  }),
  quizzes: z.array(quizStat).max(50),
  struggling: z.array(studentStat).max(8),
  strong: z.array(studentStat).max(8),
  trend: z.array(weekPoint).max(16),
});

export type PerformanceAnalysisInput = z.infer<typeof schema>;
export type PerformanceAnalysisResult = { analysis: string };

export const PERF_ANALYSIS_ERRORS: Record<string, string> = {
  NOT_A_LECTURER: "Only a lecturer can run this analysis.",
  NO_DATA: "There are no completed quiz attempts to analyse yet.",
  AI_ANALYSIS_FAILED:
    "AceTutor couldn't analyse the performance data right now. Please try again in a moment.",
};

/** Map a thrown server error to a friendly message; never leak raw errors. */
export function perfAnalysisErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return PERF_ANALYSIS_ERRORS[raw] ?? PERF_ANALYSIS_ERRORS.AI_ANALYSIS_FAILED;
}

export const analyseCoursePerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<PerformanceAnalysisResult> => {
    const { supabase } = context;

    // The course is derived server-side and never trusted from the client.
    const { data: lecturerCourseId } = await supabase.rpc("current_lecturer_course");
    if (!lecturerCourseId) throw new Error("NOT_A_LECTURER");

    if (data.totals.completed === 0) throw new Error("NO_DATA");

    const lines: string[] = [];
    lines.push(`COURSE: ${data.courseTitle}`);
    lines.push(
      `OVERALL: ${data.totals.studentsAssessed}/${data.totals.enrolled} enrolled students have ` +
        `attempted a quiz. ${data.totals.totalAttempts} attempts — ${data.totals.completed} completed, ` +
        `${data.totals.inProgress} started but not finished. Average score across completed ` +
        `attempts: ${data.totals.averageScore ?? "n/a"}%.`,
    );

    if (data.quizzes.length) {
      lines.push("\nPER-QUIZ (module and general course quizzes):");
      for (const q of data.quizzes) {
        lines.push(
          `- "${q.title}" (${q.type}): average ${q.avg ?? "n/a"}%, ` +
            `${q.completed}/${q.attempts} attempts completed`,
        );
      }
    }

    if (data.trend.length) {
      lines.push("\nWEEKLY TREND (completed-attempt average, then attempt volume):");
      for (const w of data.trend) {
        lines.push(
          `- ${w.label}: avg ${w.avg}%, ${w.completed} completed, ${w.inProgress} unfinished`,
        );
      }
    }

    if (data.struggling.length) {
      lines.push("\nLOWEST-SCORING STUDENTS:");
      for (const s of data.struggling) {
        lines.push(`- ${s.name}: avg ${s.avg ?? "n/a"}% over ${s.completed} completed attempt(s)`);
      }
    }

    if (data.strong.length) {
      lines.push("\nHIGHEST-SCORING STUDENTS:");
      for (const s of data.strong) {
        lines.push(`- ${s.name}: avg ${s.avg ?? "n/a"}% over ${s.completed} completed attempt(s)`);
      }
    }

    const system =
      "You are an assistant for a university lecturer, embedded in their course quiz-performance " +
      "dashboard. You are given ONLY aggregated performance data for the lecturer's own course. " +
      "Produce a short, practical analysis the lecturer can act on this week. Never invent " +
      "students, quizzes, scores or trends beyond what is provided, and do not speculate about " +
      "causes you cannot see. Be direct and specific; refer to quizzes and students by the names given.";

    const user = `${lines.join("\n")}

Write a concise analysis using these Markdown sections. Omit any section that has nothing useful.

### Where students are struggling
Quizzes/topics with low averages or many unfinished attempts, and which students to follow up with.

### Where students are doing well
Quizzes/topics and students that are strong.

### Trend
What the weekly numbers show — improving, declining, flat, or too little data to tell.

### Suggested teaching actions
2–5 concrete actions (re-teach or revise a topic, run a revision session, targeted support for named students, encourage students to finish started attempts, ...).

### Suggested follow-up assessment
One or two follow-up quizzes or revision checkpoints to set, and roughly when.

Keep it tight: short bullet points, no preamble, and do not just restate the raw numbers.`;

    let analysis = "";
    try {
      analysis = await callAI(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { maxTokens: 900 },
      );
    } catch (err) {
      console.error(
        `[analyseCoursePerformance] AI call failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new Error("AI_ANALYSIS_FAILED");
    }

    if (!analysis.trim()) throw new Error("AI_ANALYSIS_FAILED");
    return { analysis };
  });
