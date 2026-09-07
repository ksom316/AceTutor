import { ChevronDown, Lightbulb, Rocket, ScrollText, Target } from "lucide-react";
import { AIContentRenderer } from "@/components/course/AIContentRenderer";
import type { RemedialVisualModel } from "@/lib/remedial-visual";

/**
 * R3 — renders the SAME persisted remedial lesson as an accessible
 * concept-map / learning-map. Everything shown comes from
 * `remedialContentToVisualModel(remedialContent)`; this component makes no AI
 * or server call, invents nothing, and adds no relationships beyond the
 * high-level flow (Focus concepts → Key ideas → Worked example → Practice).
 *
 * Accessible without colour or connectors: real headings, ordered/unordered
 * lists, semantic sections. The arrows are decorative (`aria-hidden`).
 */

function FlowConnector() {
  return (
    <div aria-hidden className="mx-auto flex flex-col items-center py-1.5">
      <span className="h-3 w-px bg-border" />
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function RemedialVisual({ model }: { model: RemedialVisualModel }) {
  return (
    <section aria-label="Visual learning map" className="space-y-1">
      <h3 className="font-display text-lg">Visual learning map</h3>

      {/* Root — the unifying idea of the lesson */}
      <div className="mx-auto max-w-md rounded-xl border border-primary/40 bg-primary/10 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">This lesson</p>
        <p className="mt-1 font-medium text-foreground">{model.centralConcept}</p>
        {model.summary && <p className="mt-1.5 text-sm text-muted-foreground">{model.summary}</p>}
      </div>

      <FlowConnector />

      {/* A. Focus concepts */}
      <div>
        <h4 className="flex items-center justify-center gap-1.5 text-sm font-semibold">
          <Target className="h-4 w-4 text-primary" aria-hidden />
          Focus concepts
        </h4>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {model.conceptNodes.map((node) => (
            <li
              key={node.id}
              className="rounded-xl border border-primary/30 bg-card p-3 text-center text-sm font-medium text-foreground shadow-sm"
            >
              {node.label}
            </li>
          ))}
        </ul>
      </div>

      <FlowConnector />

      {/* B. Key ideas */}
      <div>
        <h4 className="flex items-center justify-center gap-1.5 text-sm font-semibold">
          <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />
          Key ideas
        </h4>
        <ul className="mt-2 flex flex-wrap justify-center gap-2">
          {model.keyPointNodes.map((node) => (
            <li
              key={node.id}
              className="inline-flex items-start gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-foreground"
            >
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
              <span>{node.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* C. Worked example — only when present */}
      {model.example && (
        <>
          <FlowConnector />
          <div>
            <h4 className="flex items-center justify-center gap-1.5 text-sm font-semibold">
              <ScrollText className="h-4 w-4 text-primary" aria-hidden />
              Worked example
            </h4>
            <div className="prose-lesson mt-2 max-w-none break-words rounded-lg border border-border bg-muted/60 p-4 text-foreground">
              <AIContentRenderer content={model.example} />
            </div>
          </div>
        </>
      )}

      {/* D. Practice challenge — only when present */}
      {model.practicePrompt && (
        <>
          <FlowConnector />
          <div>
            <h4 className="flex items-center justify-center gap-1.5 text-sm font-semibold">
              <Rocket className="h-4 w-4 text-primary" aria-hidden />
              Practice challenge
            </h4>
            <p className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
              {model.practicePrompt}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
