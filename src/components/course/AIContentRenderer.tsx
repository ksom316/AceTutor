import { Fragment, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/utils";
import { splitAiContent, type AiTable, type ColumnAlign } from "@/lib/ai-markdown";

/**
 * AIContentRenderer — the single renderer for every AI-generated Markdown
 * response in AceTutor (Course Tutor chat, Explain with AceTutor, Guide Me,
 * Study Path / Recovery Roadmap explanations, course recommendations, the
 * lecturer assistant).
 *
 * It renders the same CommonMark that `react-markdown` always did — headings,
 * bold / italic, bullet & numbered lists, code blocks, block quotes — and adds
 * the one thing the plain renderer could not: GFM pipe tables. A table is never
 * shown as raw `| … |` text. On wide screens it is a real, horizontally
 * scrollable table; on phones it collapses to stacked comparison cards (one card
 * per row, remaining columns as label / value pairs) so a "RAM vs Storage" style
 * comparison stays readable without pinch-zoom.
 *
 * Callers keep their existing `.prose-lesson` wrapper for base typography; this
 * component only owns the table treatment and passes everything else through.
 */

type Props = {
  content: string | null | undefined;
  className?: string;
};

/** Inline-only Markdown for table cells / headers (unwraps the block <p>). */
const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
};

function InlineMarkdown({ children }: { children: string }) {
  if (!children) return null;
  return <ReactMarkdown components={INLINE_COMPONENTS}>{children}</ReactMarkdown>;
}

function alignClass(align: ColumnAlign): string {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

function AITableBlock({ table }: { table: AiTable }) {
  const { head, rows, align } = table;
  const hasBody = rows.length > 0;
  const bodyColumns = head.slice(1);

  return (
    <div className="my-4">
      {/* Wide screens: a real table, scrollable if it overflows. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60">
              {head.map((cell, i) => (
                <th
                  key={i}
                  scope="col"
                  className={cn(
                    "border-b border-border px-3 py-2 font-semibold text-foreground",
                    alignClass(align[i]),
                  )}
                >
                  <InlineMarkdown>{cell}</InlineMarkdown>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="even:bg-muted/30">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={cn(
                      "border-b border-border/60 px-3 py-2 align-top text-foreground",
                      alignClass(align[ci]),
                    )}
                  >
                    <InlineMarkdown>{cell}</InlineMarkdown>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: one card per row — first column is the card title, the rest
          become label / value pairs. Falls back to a plain table-ish list when
          there is only one column. */}
      <div className="space-y-3 sm:hidden">
        {hasBody ? (
          rows.map((row, ri) => (
            <div key={ri} className="rounded-lg border border-border bg-card p-3">
              {row[0] && (
                <p className="mb-2 font-semibold text-foreground">
                  <InlineMarkdown>{row[0]}</InlineMarkdown>
                </p>
              )}
              {bodyColumns.length > 0 && (
                <dl className="space-y-1.5">
                  {bodyColumns.map((label, ci) => (
                    <div key={ci} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 text-sm">
                      <dt className="font-medium text-muted-foreground">
                        <InlineMarkdown>{label}</InlineMarkdown>
                      </dt>
                      <dd className="text-foreground">
                        <InlineMarkdown>{row[ci + 1] ?? ""}</InlineMarkdown>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-border bg-card p-3 text-sm font-medium text-foreground">
            {head.map((cell, i) => (
              <span key={i} className="mr-2">
                <InlineMarkdown>{cell}</InlineMarkdown>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AIContentRenderer({ content, className }: Props) {
  const segments = useMemo(() => splitAiContent(content ?? ""), [content]);

  if (!content || !content.trim()) return null;

  const nodes: ReactNode[] = segments.map((seg, i) =>
    seg.kind === "table" ? (
      <AITableBlock key={i} table={seg.table} />
    ) : (
      <ReactMarkdown key={i}>{seg.text}</ReactMarkdown>
    ),
  );

  if (className) return <div className={className}>{nodes}</div>;
  return <Fragment>{nodes}</Fragment>;
}

export default AIContentRenderer;
