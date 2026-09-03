/**
 * Split a substantial lesson body into meaningful reading pages for the guided
 * page-by-page reader.
 *
 *   - Short content              → returns `null` (render as one page).
 *   - Long content with headings → one page per level-1/2 Markdown heading,
 *                                  sub-split by size if a section is very large.
 *   - Long content, few headings → packed into evenly sized pages, breaking only
 *                                  on paragraph / block boundaries.
 *
 * It never splits inside a fenced code block, never breaks a paragraph, and
 * merges away pages that would only be a sentence long. Markdown is preserved.
 *
 * Pure — no React, no dependencies.
 */

export type ReadingSection = {
  /** Heading for the page, shown by the reader above the body. */
  heading: string | null;
  /** Markdown for the page body, with the boundary heading line removed. */
  body: string;
};

type Block = { kind: "h1" | "h2" | "content"; text: string };

const FENCE_RE = /^[ \t]{0,3}(```|~~~)/;
const HEADING_RE = /^(#{1,2})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Break markdown into heading blocks + paragraph / list / code blocks, never
 *  splitting inside a fenced code block. */
function tokenize(src: string): Block[] {
  const blocks: Block[] = [];
  let inFence = false;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ kind: "content", text });
    buf = [];
  };
  for (const line of src.split("\n")) {
    if (FENCE_RE.test(line)) {
      buf.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }
    const h = line.match(HEADING_RE);
    if (h) {
      flush();
      blocks.push({ kind: h[1].length === 1 ? "h1" : "h2", text: h[2].trim() });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

/** A block's markdown source — headings become `#` / `##` lines again. */
function blockMd(b: Block): string {
  if (b.kind === "h1") return `# ${b.text}`;
  if (b.kind === "h2") return `## ${b.text}`;
  return b.text;
}

/** Greedily pack blocks into pages of about `targetChars`, never breaking a
 *  block. */
function packBySize(blocks: Block[], targetChars: number): string[] {
  const pages: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const b of blocks) {
    const md = blockMd(b);
    if (len > 0 && len + md.length > targetChars) {
      pages.push(cur.join("\n\n"));
      cur = [];
      len = 0;
    }
    cur.push(md);
    len += md.length + 2;
  }
  if (cur.length) pages.push(cur.join("\n\n"));
  return pages;
}

/** Fold a page shorter than `minChars` into a neighbour so the reader never
 *  shows a page that is just a sentence. */
function mergeShort(sections: ReadingSection[], minChars: number): ReadingSection[] {
  if (sections.length <= 1) return sections;
  const out: ReadingSection[] = [];
  for (const s of sections) {
    const prev = out[out.length - 1];
    if (prev && s.body.length < minChars) {
      const label = s.heading ? `## ${s.heading}\n\n` : "";
      prev.body = `${prev.body}\n\n${label}${s.body}`.trim();
    } else {
      out.push({ ...s });
    }
  }
  // A too-short first page has no previous page — fold it forward instead.
  if (out.length > 1 && out[0].body.length < minChars) {
    out[1].body = `${out[0].body}\n\n${out[1].body}`.trim();
    if (!out[1].heading) out[1].heading = out[0].heading;
    out.shift();
  }
  return out;
}

export function splitLessonIntoSections(
  markdown: string,
  opts: {
    /** Below this the whole lesson stays on one page. */
    minTotalChars?: number;
    /** Aim for pages around this size when packing by size. */
    targetChars?: number;
    /** A heading section larger than this is sub-split by size. */
    maxSectionChars?: number;
    /** Pages shorter than this are merged into a neighbour. */
    minSectionChars?: number;
  } = {},
): ReadingSection[] | null {
  const minTotal = opts.minTotalChars ?? 1600;
  const target = opts.targetChars ?? 1400;
  const maxSection = opts.maxSectionChars ?? 2800;
  const minSection = opts.minSectionChars ?? 320;

  const src = markdown.replace(/\r\n/g, "\n").trim();
  if (src.length < minTotal) return null;

  const blocks = tokenize(src);
  if (blocks.length === 0) return null;

  const headingCount = blocks.reduce((n, b) => n + (b.kind === "content" ? 0 : 1), 0);

  let sections: ReadingSection[] = [];

  if (headingCount >= 2) {
    // Headings are the natural page boundaries.
    let heading: string | null = null;
    let group: Block[] = [];
    const flushGroup = () => {
      const body = group.map(blockMd).join("\n\n").trim();
      if (!heading && !body) return;
      if (body.length > maxSection && group.length > 1) {
        const pages = packBySize(group, target);
        pages.forEach((p, i) => {
          sections.push({
            heading: i === 0 ? heading : heading ? `${heading} (continued)` : null,
            body: p,
          });
        });
      } else {
        sections.push({ heading, body });
      }
    };
    for (const b of blocks) {
      if (b.kind === "content") {
        group.push(b);
      } else {
        flushGroup();
        heading = b.text;
        group = [];
      }
    }
    flushGroup();
    if (sections[0] && !sections[0].heading) sections[0].heading = "Introduction";
  } else {
    // Long, but not enough headings to page by — pack into evenly sized pages.
    sections = packBySize(blocks, target).map((body) => ({ heading: null, body }));
  }

  sections = mergeShort(sections, minSection);

  if (sections.length < 2) return null;
  return sections;
}
