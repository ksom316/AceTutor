import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Info, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fadeUp } from "@/lib/motion";
import {
  getRemedialIntelligenceEvaluation,
  remedialEvaluationErrorMessage,
} from "@/lib/remedial-intelligence-evaluation.functions";
import type {
  RemedialEvidenceState,
  RemedialIntelligenceFormat,
} from "@/lib/remedial-intelligence";
import type {
  FormatTally,
  RemedialIntelligenceEvaluation,
} from "@/lib/remedial-intelligence-evaluation";
import {
  evidenceStateLabel,
  followRateSentence,
  formatEffectivenessSentence,
  observedImprovementSentence,
  REMEDIAL_CAUSATION_NOTE,
} from "@/lib/remedial-evaluation-copy";

export const Route = createFileRoute("/lecturer/remedial-evaluation")({
  component: RemedialEvaluationPage,
});

const FORMAT_LABEL: Record<RemedialIntelligenceFormat, string> = {
  text: "Text",
  audio: "Audio",
  visual: "Visual",
  video: "Video",
};

const SOURCE_LABEL: Record<string, string> = {
  history: "Personal remedial history",
  adaptive: "Recent learning activity",
  vark: "Learning preferences",
  preference: "Chosen format",
  default: "Default format",
};

const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const rate = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

function EvidenceBadge({ state }: { state: RemedialEvidenceState }) {
  const variant = state === "sufficient" ? "default" : "secondary";
  return (
    <Badge variant={variant} className="font-normal">
      {evidenceStateLabel(state)}
    </Badge>
  );
}

function CausationNote() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {REMEDIAL_CAUSATION_NOTE}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl tabular-nums">{value}</p>
    </div>
  );
}

function Bar({ value, total }: { value: number; total: number }) {
  return (
    <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full bg-primary/70"
        style={{ width: total > 0 ? `${Math.round((value / total) * 100)}%` : "0%" }}
      />
    </span>
  );
}

function FormatTallyList({ tally }: { tally: FormatTally[] }) {
  if (tally.length === 0) return <p className="text-sm text-muted-foreground">None yet</p>;
  const total = tally.reduce((a, t) => a + t.count, 0);
  return (
    <ul className="space-y-1.5">
      {tally.map((t) => (
        <li key={t.format} className="flex items-center gap-3 text-sm">
          <span className="w-16 shrink-0 text-muted-foreground">{FORMAT_LABEL[t.format]}</span>
          <Bar value={t.count} total={total} />
          <span className="w-8 shrink-0 text-right tabular-nums">{t.count}</span>
        </li>
      ))}
    </ul>
  );
}

function SkeletonCard() {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-5 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function RemedialEvaluationPage() {
  const run = useServerFn(getRemedialIntelligenceEvaluation);
  const query = useQuery({
    queryKey: ["remedial-intelligence-evaluation"],
    queryFn: () => run(),
    staleTime: 60_000,
    retry: false,
  });

  const data = query.data as RemedialIntelligenceEvaluation | undefined;

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-5xl px-4 py-10"
    >
      <div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" /> Lecturer
        </p>
        <h1 className="mt-1 font-display text-4xl">Remedial Intelligence Evaluation</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Whether the personal remedial recommendations are producing useful evidence for your
          course. Every figure is an observational aggregate — no individual student data is shown.
        </p>
      </div>

      {query.isLoading ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : query.isError ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {remedialEvaluationErrorMessage(query.error)}
        </p>
      ) : data ? (
        <div className="mt-8 space-y-6">
          <p className="text-xs text-muted-foreground">
            Generated {new Date(data.generatedAt).toLocaleString()} · a metric needs at least{" "}
            {data.overview.minimumObservations} before/after observations to read as a trend
          </p>

          <CausationNote />

          {data.overview.evidenceState === "none" &&
            data.overview.meaningfulRemedialEngagements === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-card p-5 text-center">
                <p className="text-sm font-medium">No remedial data yet</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Students need to open a remedial explanation on a Study Path and then complete an
                  official module quiz before this evaluation can show anything. The sections below
                  will fill in as that happens.
                </p>
              </div>
            )}

          {/* 1 — Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1 · Remedial Intelligence Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Study Paths analysed"
                  value={data.overview.studyPathsWithRemedialContent}
                />
                <Stat
                  label="Meaningful engagements"
                  value={data.overview.meaningfulRemedialEngagements}
                />
                <Stat
                  label="Linked quiz outcomes"
                  value={data.overview.linkedOfficialQuizOutcomes}
                />
                <Stat
                  label="History recommendations"
                  value={data.overview.historyRecommendations}
                />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Overall evidence:</span>
                <EvidenceBadge state={data.overview.evidenceState} />
              </div>
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                {data.disclaimer}
              </p>
            </CardContent>
          </Card>

          {/* 2 — Recommendation source analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">2 · Recommendation Source Analysis</CardTitle>
              <p className="text-xs text-muted-foreground">
                A recommendation is &ldquo;followed&rdquo; only when the student meaningfully
                engages with the recommended format.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 text-right font-medium">Recommendations</th>
                    <th className="pb-2 text-right font-medium">Followed</th>
                    <th className="pb-2 text-right font-medium">Follow rate</th>
                    <th className="pb-2 text-right font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 tabular-nums">
                  {data.recommendationSourcePerformance.map((s) => (
                    <tr key={s.source}>
                      <td className="py-2 pr-2 text-muted-foreground">
                        {SOURCE_LABEL[s.source] ?? s.source}
                      </td>
                      <td className="py-2 text-right">{s.recommendationsIssued}</td>
                      <td className="py-2 text-right">{s.recommendationsFollowed}</td>
                      <td className="py-2 text-right">{rate(s.followRate)}</td>
                      <td className="py-2 text-right">
                        <EvidenceBadge state={s.evidenceState} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.recommendationSourcePerformance
                .filter((s) => s.source === "history" && s.recommendationsIssued > 0)
                .map((s) => (
                  <p key={s.source} className="mt-3 text-xs text-muted-foreground">
                    Personal history: {followRateSentence(s)}
                  </p>
                ))}
            </CardContent>
          </Card>

          {/* 3 — Format effectiveness */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">3 · Format Effectiveness</CardTitle>
              <p className="text-xs text-muted-foreground">
                &ldquo;Observed improvement&rdquo; compares a later same-module quiz score with the
                baseline attempt for students who completed that remedial format. It describes what
                happened, not what the format caused.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Format</th>
                      <th className="pb-2 text-right font-medium">Before/after obs.</th>
                      <th className="pb-2 text-right font-medium">Avg baseline</th>
                      <th className="pb-2 text-right font-medium">Avg after</th>
                      <th className="pb-2 text-right font-medium">Observed improvement (pts)</th>
                      <th className="pb-2 text-right font-medium">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70 tabular-nums">
                    {data.formatEffectiveness.map((f) => (
                      <tr key={f.format}>
                        <td className="py-2 pr-2 text-muted-foreground">
                          {FORMAT_LABEL[f.format]}
                        </td>
                        <td className="py-2 text-right">{f.linkedQuizOutcomes}</td>
                        <td className="py-2 text-right">{pct(f.averageBaselineScore)}</td>
                        <td className="py-2 text-right">{pct(f.averageSubsequentScore)}</td>
                        <td className="py-2 text-right">
                          {f.observedImprovement == null
                            ? "—"
                            : `${f.observedImprovement > 0 ? "+" : ""}${f.observedImprovement}`}
                        </td>
                        <td className="py-2 text-right">
                          <EvidenceBadge state={f.evidenceState} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {data.formatEffectiveness
                  .filter((f) => f.linkedQuizOutcomes > 0 || f.evidenceState === "unavailable")
                  .map((f) => (
                    <li key={f.format}>{formatEffectivenessSentence(f)}</li>
                  ))}
              </ul>

              <CausationNote />
            </CardContent>
          </Card>

          {/* 4 — R8 personal history learning */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">4 · R8 Personal History Learning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="History recommendations"
                  value={data.historyLearning.recommendationCount}
                />
                <Stat
                  label="Students receiving them"
                  value={data.historyLearning.studentsWithHistoryRecommendation}
                />
                <Stat
                  label="Currently eligible"
                  value={data.historyLearning.currentlyEligibleStudents}
                />
                <Stat
                  label="Confidence (med / high)"
                  value={`${data.historyLearning.currentConfidenceDistribution.medium} / ${data.historyLearning.currentConfidenceDistribution.high}`}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium">Formats recommended by history</p>
                  <FormatTallyList tally={data.historyLearning.formatsRecommended} />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Current preferred formats (would-be recommendations)
                  </p>
                  <FormatTallyList tally={data.historyLearning.currentPreferredFormats} />
                </div>
              </div>

              <div className="rounded-xl border border-border p-3">
                <p className="text-sm font-medium">Outcomes after history-based recommendations</p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {observedImprovementSentence(
                    data.historyLearning.outcomesAfterHistoryRecommendations.observedImprovement,
                    "history-based remediation",
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {
                      data.historyLearning.outcomesAfterHistoryRecommendations
                        .observationsWithOutcome
                    }{" "}
                    before/after observation
                    {data.historyLearning.outcomesAfterHistoryRecommendations
                      .observationsWithOutcome === 1
                      ? ""
                      : "s"}
                  </span>
                  <span>
                    baseline{" "}
                    {pct(
                      data.historyLearning.outcomesAfterHistoryRecommendations.averageBaselineScore,
                    )}{" "}
                    → after{" "}
                    {pct(
                      data.historyLearning.outcomesAfterHistoryRecommendations
                        .averageSubsequentScore,
                    )}
                  </span>
                  <EvidenceBadge
                    state={data.historyLearning.outcomesAfterHistoryRecommendations.evidenceState}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                {data.video.message}
              </div>
            </CardContent>
          </Card>

          {/* 5 — Limitations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">5 · Limitations</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {data.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </motion.main>
  );
}
