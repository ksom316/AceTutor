/**
 * AI content pre-parser — shared by <AIContentRenderer />.
 *
 * `react-markdown` (CommonMark only, no `remark-gfm` in this project) does not
 * understand GFM pipe tables, so a model that emits one used to render as raw
 * `| … |` text. Rather than pull in the GFM plugin (which would render a plain
 * <table> that overflows narrow surfaces like the contextual-explanation popup),
 * we split the raw string into ordinary Markdown runs and structured table
 * blocks. The renderer draws the Markdown runs with `react-markdown` unchanged
 * and the table blocks with a responsive component (scrollable table on wide
 * screens, stacked comparison cards on phones).
 *
 * Pure string/data helpers only — no React, no DOM — so they are unit-testable
 * and safe to run during SSR.
 */

export type ColumnAlign = "left" | "center" | "right" | null;

export type AiTable = {
  head: string[];
  rows: string[][];
  align: ColumnAlign[];
};

export type AiSegment = { kind: "markdown"; text: string } | { kind: "table"; table: AiTable };

/** Split one table line into trimmed cell strings, honouring `\|` escapes and
 *  optional outer pipes (`| a | b |` and `a | b` are both valid GFM). */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // Drop the empty cells produced by leading / trailing outer pipes.
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** A GFM header/body divider: `| --- | :--: | ---: |`. Must contain a pipe so a
 *  bare `---` horizontal rule is never mistaken for one. */
export function isTableDivider(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length >= 1 && cells.every((c) => /^:?-+:?$/.test(c));
}

function parseAlign(cell: string): ColumnAlign {
  const s = cell.trim();
  const left = s.startsWith(":");
  const right = s.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function fitRow(cells: string[], width: number): string[] {
  const out = cells.slice(0, width);
  while (out.length < width) out.push("");
  return out;
}

function fitAlign(cells: ColumnAlign[], width: number): ColumnAlign[] {
  const out = cells.slice(0, width);
  while (out.length < width) out.push(null);
  return out;
}

const FENCE = /^\s*(```+|~~~+)/;

/**
 * Break AI Markdown into ordered Markdown / table segments. Fenced code blocks
 * are passed through untouched (a `|` inside a code sample is never a table).
 * Always returns at least one segment.
 */
export function splitAiContent(src: string): AiSegment[] {
  if (!src || !src.trim()) return [{ kind: "markdown", text: src ?? "" }];

  const lines = src.split(/\r?\n/);
  const segments: AiSegment[] = [];
  let buf: string[] = [];
  let inFence = false;
  let fenceChar = "";

  const flush = () => {
    const text = buf.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim()) segments.push({ kind: "markdown", text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(FENCE);

    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (line.trimStart().startsWith(fenceChar)) {
        inFence = false;
      }
      buf.push(line);
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }

    // A table = a row line, then a divider line, then zero+ body rows.
    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = splitTableRow(line);
      const align = splitTableRow(lines[i + 1]).map(parseAlign);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length; j += 1) {
        const r = lines[j];
        if (!r.trim() || !r.includes("|") || FENCE.test(r)) break;
        rows.push(fitRow(splitTableRow(r), head.length));
      }
      flush();
      segments.push({
        kind: "table",
        table: { head, rows, align: fitAlign(align, head.length) },
      });
      i = j - 1;
      continue;
    }

    buf.push(line);
  }

  flush();
  return segments.length ? segments : [{ kind: "markdown", text: src }];
}

/** True when the content contains at least one GFM pipe table. */
export function hasMarkdownTable(src: string): boolean {
  return splitAiContent(src).some((s) => s.kind === "table");
}
