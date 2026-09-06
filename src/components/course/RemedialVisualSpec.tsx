import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, Layers, Rows3 } from "lucide-react";
import type { RemedialVisualModel } from "@/lib/remedial-visual";
import {
  isConceptMapSpec,
  type RemedialArraySpec,
  type RemedialComparisonSpec,
  type RemedialHierarchySpec,
  type RemedialLinkedStructureSpec,
  type RemedialProcessSpec,
  type RemedialSequenceSpec,
  type RemedialTableSpec,
  type RemedialVisualSpec,
} from "@/lib/remedial-visual-spec";
import { RemedialVisual } from "@/components/course/RemedialVisual";

/**
 * R5 — renders a concept-fitted visual structure for the SAME persisted
 * remedial lesson. Every renderer is deterministic (no AI, no server call, no
 * state) and accessible: real headings/lists/tables, meaning never carried by
 * colour alone, wide content scrolls inside its own container. Anything the
 * validator rejected — or an explicit `concept-map` — renders the R3 map.
 */
export function RemedialVisualView({
  spec,
  fallbackModel,
}: {
  spec: RemedialVisualSpec | null;
  fallbackModel: RemedialVisualModel;
}) {
  if (isConceptMapSpec(spec)) return <RemedialVisual model={fallbackModel} />;

  switch (spec!.type) {
    case "sequence":
      return <SequenceView spec={spec as RemedialSequenceSpec} />;
    case "process":
      return <ProcessView spec={spec as RemedialProcessSpec} />;
    case "hierarchy":
      return <HierarchyView spec={spec as RemedialHierarchySpec} />;
    case "comparison":
      return <ComparisonView spec={spec as RemedialComparisonSpec} />;
    case "table":
      return <TableView spec={spec as RemedialTableSpec} />;
    case "array":
      return <ArrayView spec={spec as RemedialArraySpec} />;
    case "linked-structure":
      return <LinkedStructureView spec={spec as RemedialLinkedStructureSpec} />;
    default:
      return <RemedialVisual model={fallbackModel} />;
  }
}

function Frame({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section aria-label={`${label}: ${title}`} className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</p>
        <h3 className="font-display text-lg">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function StepConnector({ horizontal = false }: { horizontal?: boolean }) {
  const Icon = horizontal ? ArrowRight : ArrowDown;
  return (
    <div aria-hidden className={horizontal ? "flex items-center px-1" : "flex justify-center py-1"}>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function SequenceView({ spec }: { spec: RemedialSequenceSpec }) {
  return (
    <Frame label="Sequence" title={spec.title}>
      <ol className="space-y-1">
        {spec.steps.map((step, i) => (
          <li key={i}>
            {i > 0 && <StepConnector />}
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-baseline gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="text-sm font-medium text-foreground">{step.label}</span>
              </div>
              {step.state && (
                <p className="mt-1.5 overflow-x-auto whitespace-pre rounded-md bg-muted/60 px-2 py-1 font-mono text-xs text-foreground">
                  {step.state}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function ProcessView({ spec }: { spec: RemedialProcessSpec }) {
  return (
    <Frame label="Process" title={spec.title}>
      <ol className="space-y-1">
        {spec.steps.map((step, i) => (
          <li key={i}>
            {i > 0 && <StepConnector />}
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-baseline gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="text-sm font-medium text-foreground">{step.label}</span>
              </div>
              {step.detail && (
                <p className="mt-1 pl-7 text-sm text-muted-foreground">{step.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function HierarchyView({ spec }: { spec: RemedialHierarchySpec }) {
  return (
    <Frame label="Hierarchy" title={spec.title}>
      <ol className="space-y-1">
        {spec.levels.map((level, i) => (
          <li key={i}>
            {i > 0 && <StepConnector />}
            <div
              className="flex items-start gap-2 rounded-xl border border-primary/30 bg-card p-3 shadow-sm"
              style={{ marginInline: `${Math.min(i, 4) * 8}px` }}
            >
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Level {i + 1}</p>
                <p className="text-sm font-medium text-foreground">{level.label}</p>
                {level.detail && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{level.detail}</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function ComparisonView({ spec }: { spec: RemedialComparisonSpec }) {
  return (
    <Frame label="Comparison" title={spec.title}>
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.items.map((item, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h4 className="font-display text-base">{item.name}</h4>
            <ul className="mt-2 space-y-1.5 text-sm">
              {item.points.map((pt, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function TableView({ spec }: { spec: RemedialTableSpec }) {
  return (
    <Frame label="Table" title={spec.title}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-left">
              {spec.columns.map((col, i) => (
                <th key={i} scope="col" className="border-b border-border px-3 py-2 font-semibold">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, i) => (
              <tr key={i} className="odd:bg-background even:bg-muted/20">
                {row.map((cell, j) => (
                  <td key={j} className="border-b border-border px-3 py-2 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

function ArrayView({ spec }: { spec: RemedialArraySpec }) {
  return (
    <Frame label="Array" title={spec.title}>
      <div className="overflow-x-auto pb-1">
        <ol className="flex gap-1.5" role="list">
          {spec.cells.map((cell, i) => (
            <li key={i} className="flex flex-col items-center">
              <div
                className={
                  "grid h-11 min-w-11 place-items-center rounded-md border px-2 font-mono text-sm " +
                  (cell.highlight
                    ? "border-primary bg-primary/10 font-bold text-foreground ring-2 ring-primary/40"
                    : "border-border bg-card text-foreground")
                }
              >
                {cell.highlight && <span className="sr-only">highlighted: </span>}
                {cell.value}
              </div>
              <span className="mt-1 font-mono text-[11px] text-muted-foreground">{i}</span>
            </li>
          ))}
        </ol>
      </div>
      {spec.caption && <p className="text-sm text-muted-foreground">{spec.caption}</p>}
    </Frame>
  );
}

function LinkedStructureView({ spec }: { spec: RemedialLinkedStructureSpec }) {
  const labelById = new Map(spec.nodes.map((n) => [n.id, n.label]));
  return (
    <Frame label="Linked structure" title={spec.title}>
      <div className="overflow-x-auto pb-1">
        <ol className="flex flex-wrap items-stretch gap-1.5" role="list">
          {spec.nodes.map((node, i) => (
            <li key={node.id} className="flex items-center gap-1.5">
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm">
                {node.label}
              </div>
              {i < spec.nodes.length - 1 && <StepConnector horizontal />}
            </li>
          ))}
        </ol>
      </div>
      {spec.links.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {spec.links.map((lnk, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Rows3 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="text-foreground">{labelById.get(lnk.from)}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="text-foreground">{labelById.get(lnk.to)}</span>
              {lnk.label && <span>— {lnk.label}</span>}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
