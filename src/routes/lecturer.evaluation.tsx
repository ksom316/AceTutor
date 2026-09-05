import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Download, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fadeUp } from "@/lib/motion";
import { VARK_CATEGORY_LABEL, type VarkCategory } from "@/lib/vark";
import { getModelEvaluation, evaluationErrorMessage } from "@/lib/model-evaluation.functions";
import type { DefenseSummary } from "@/lib/model-evaluation";

export const Route = createFileRoute("/lecturer/evaluation")({
  component: EvaluationPage,
});

const f3 = (n: number) => n.toFixed(3);
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="min-w-0 text-muted-foreground">
        {label}
        {hint && <span className="ml-1 text-xs text-muted-foreground/70">({hint})</span>}
      </span>
      <span className="shrink-0 font-medium tabular-nums">{value}</span>
    </div>
  );
}

function Distribution({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  return (
    <ul className="space-y-1.5">
      {Object.entries(data).map(([k, v]) => (
        <li key={k} className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 capitalize text-muted-foreground">
            {k.replace("_", "/")}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary/70"
              style={{ width: total ? `${Math.round((v / total) * 100)}%` : "0%" }}
            />
          </span>
          <span className="w-8 shrink-0 text-right tabular-nums">{v}</span>
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

function EvaluationPage() {
  const run = useServerFn(getModelEvaluation);
  const query = useQuery({
    queryKey: ["model-evaluation"],
    queryFn: () => run(),
    staleTime: 60_000,
    retry: false,
  });

  const summary = query.data as DefenseSummary | undefined;

  const download = useMemo(() => {
    if (!summary || typeof window === "undefined") return null;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    return URL.createObjectURL(blob);
  }, [summary]);

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-5xl px-4 py-10"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Gauge className="h-4 w-4" /> Lecturer
          </p>
          <h1 className="mt-1 font-display text-4xl">Model &amp; Adaptation Evaluation</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Offline ML experiment results, deployed-model metadata, and privacy-safe aggregates of
            live AceTutor usage — kept strictly separate. No individual student data is shown.
          </p>
        </div>
        {download && summary && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a
              href={download}
              download={`acetutor-evaluation-${summary.generatedAt.slice(0, 10)}.json`}
            >
              <Download className="mr-1.5 h-4 w-4" /> Download JSON
            </a>
          </Button>
        )}
      </div>

      {query.isLoading ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : query.isError ? (
        <p className="mt-8 text-sm text-muted-foreground">{evaluationErrorMessage(query.error)}</p>
      ) : summary ? (
        <div className="mt-8 space-y-6">
          <p className="text-xs text-muted-foreground">
            Generated {new Date(summary.generatedAt).toLocaleString()}
          </p>

          {/* 1. Deployed VARK Model */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1 · Deployed VARK Model</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Model" value={summary.deployedModel.modelType} />
              <Row label="Version" value={summary.deployedModel.modelVersion} />
              <Row label="Input features" value={summary.deployedModel.featureNames.join(", ")} />
              <Row
                label="Deployment status"
                value={<Badge variant="secondary">{summary.deployedModel.deploymentStatus}</Badge>}
              />
              <Row
                label="Live ML prediction coverage"
                value={pct(summary.live.vark.mlCoveragePercent)}
                hint={`${summary.live.vark.withMlPrediction}/${summary.live.vark.completedAssessments} completed assessments`}
              />
              <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                {summary.deployedModel.syntheticDisclaimer}
              </p>
            </CardContent>
          </Card>

          {/* 2. Offline Model Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">2 · Offline Model Comparison</CardTitle>
              <p className="text-xs text-muted-foreground">
                {summary.offline.featureNames.length}-feature set ·{" "}
                {summary.offline.trainingDataSource} data · n={summary.offline.datasetSize} (
                {summary.offline.reportedMetricsComputedOn.replace(/_/g, " ")})
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Metric</th>
                    <th className="pb-2 text-right font-medium">Random Forest</th>
                    <th className="pb-2 text-right font-medium">
                      Gradient Boosting
                      {summary.offline.winner === "gradient_boosting" && (
                        <Badge className="ml-1.5">winner</Badge>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 tabular-nums">
                  {(
                    [
                      ["Test accuracy", "accuracy"],
                      ["Macro precision", "macroPrecision"],
                      ["Macro recall", "macroRecall"],
                      ["Macro F1", "macroF1"],
                      ["CV accuracy (mean)", "cvAccuracyMean"],
                      ["CV accuracy (std)", "cvAccuracyStd"],
                      ["CV macro F1 (mean)", "cvMacroF1Mean"],
                      ["CV macro F1 (std)", "cvMacroF1Std"],
                    ] as const
                  ).map(([label, key]) => (
                    <tr key={key}>
                      <td className="py-1.5 pr-2 text-muted-foreground">{label}</td>
                      <td className="py-1.5 text-right">
                        {f3(summary.offline.models.randomForest[key])}
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        {f3(summary.offline.models.gradientBoosting[key])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                Selection: {summary.offline.selectionMetric} (then{" "}
                {summary.offline.selectionSecondaryMetric}). Winner:{" "}
                <span className="font-medium">{summary.offline.winner.replace("_", " ")}</span>,
                deployed as {summary.deployedModel.modelVersion}.
              </p>
              {summary.offline.priorExperiment8Feature && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Prior 8-feature experiment (
                  {summary.offline.priorExperiment8Feature.deploymentStatus}):{" "}
                  {summary.offline.priorExperiment8Feature.winner.replace("_", " ")} ≈{" "}
                  {f3(summary.offline.priorExperiment8Feature.randomForest.accuracy)} accuracy on
                  synthetic data — adds simulated engagement signals AceTutor does not collect, so
                  it is not deployable and not the deployed feature set.
                </p>
              )}
            </CardContent>
          </Card>

          {/* 3. Live VARK Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">3 · Live VARK Usage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Assessments", summary.live.vark.completedAssessments],
                  ["With ML prediction", summary.live.vark.withMlPrediction],
                  ["ML coverage", pct(summary.live.vark.mlCoveragePercent)],
                  ["Avg confidence", pct(summary.live.vark.averageMlConfidencePercent)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 font-display text-2xl tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">ML predicted category distribution</p>
                <Distribution
                  data={Object.fromEntries(
                    Object.entries(summary.live.vark.mlCategoryDistribution).map(([k, v]) => [
                      VARK_CATEGORY_LABEL[k as VarkCategory] ?? k,
                      v,
                    ]),
                  )}
                />
              </div>
              <Row
                label="Model versions observed"
                value={summary.live.vark.modelVersionsObserved.join(", ") || "—"}
              />
              <p className="text-xs text-muted-foreground">
                Average confidence is the mean of per-student model probabilities — it is not the
                model&apos;s accuracy.
              </p>
            </CardContent>
          </Card>

          {/* 4. Adaptive Recommendation Evidence */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">4 · Adaptive Recommendation Evidence (A7)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Meaningful engagements", summary.live.adaptation.totalMeaningfulEngagements],
                  ["Official quiz outcomes", summary.live.adaptation.totalOfficialOutcomes],
                  ["Adaptation units", summary.live.adaptation.adaptationUnits],
                  ["Evaluable units", summary.live.adaptation.evaluableUnits],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 font-display text-2xl tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              <Row
                label="Recommendation source (logged events)"
                value={`VARK ${summary.live.adaptation.loggedRecommendationSourceCounts.vark} · adaptive ${summary.live.adaptation.loggedRecommendationSourceCounts.adaptive}`}
              />
              <Row
                label="Reconstructed decisions"
                value={`VARK ${summary.live.adaptation.reconstruction.sourceCounts.vark} · adaptive ${summary.live.adaptation.reconstruction.sourceCounts.adaptive}`}
              />
              <Row
                label="Adaptive override rate (of evaluable units)"
                value={pct(summary.live.adaptation.reconstruction.adaptiveOverrideRatePercent)}
              />

              <div>
                <p className="mb-2 text-sm font-medium">Current decision reason codes</p>
                <Distribution data={summary.live.adaptation.reconstruction.reasonCodeCounts} />
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Meaningful engagements by modality</p>
                <Distribution data={summary.live.adaptation.meaningfulEngagementsByModality} />
              </div>

              <div>
                <p className="mb-1 text-sm font-medium">
                  Average official-quiz score after study, by modality
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  {summary.live.adaptation.outcomeAssociationDisclaimer}
                </p>
                <ul className="space-y-1 text-sm">
                  {summary.live.adaptation.outcomeAssociationByModality.map((a) => (
                    <li key={a.modality} className="flex items-center justify-between gap-3">
                      <span className="capitalize text-muted-foreground">{a.modality}</span>
                      <span className="tabular-nums">
                        {a.averageScorePercent == null ? "—" : `${a.averageScorePercent}%`}{" "}
                        <span className="text-xs text-muted-foreground">
                          (n={a.linkedOutcomeCount}
                          {a.evidenceState !== "sufficient" && `, ${a.evidenceState} evidence`})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* 5. Limitations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">5 · Limitations</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {summary.evaluationNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </motion.main>
  );
}
