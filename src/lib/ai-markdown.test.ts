/**
 * <AIContentRenderer /> pre-parser — GFM pipe tables must be lifted out of the
 * Markdown stream so they can be drawn as a real table / comparison cards
 * instead of leaking raw `| … |` text. Everything that is NOT a table has to
 * pass through untouched.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/ai-markdown.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMarkdownTable, isTableDivider, splitAiContent, splitTableRow } from "@/lib/ai-markdown";

test("splitTableRow: outer pipes are optional and escapes survive", () => {
  assert.deepEqual(splitTableRow("| a | b | c |"), ["a", "b", "c"]);
  assert.deepEqual(splitTableRow("a | b | c"), ["a", "b", "c"]);
  assert.deepEqual(splitTableRow("| a \\| b | c |"), ["a | b", "c"]);
});

test("isTableDivider: only a real divider row, never a bare --- rule", () => {
  assert.equal(isTableDivider("| --- | --- |"), true);
  assert.equal(isTableDivider("|:---|:--:|---:|"), true);
  assert.equal(isTableDivider("---"), false);
  assert.equal(isTableDivider("| not | a | divider |"), false);
});

test("a plain response with no table is one markdown segment, unchanged", () => {
  const src = "## Hello\n\nSome **bold** text and a list:\n\n- one\n- two\n";
  const segs = splitAiContent(src);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "markdown");
  assert.equal(hasMarkdownTable(src), false);
});

test("a GFM table becomes a structured table segment with head + rows + align", () => {
  const src = [
    "Here is the comparison:",
    "",
    "| Feature | RAM | Storage |",
    "| --- | :--: | ---: |",
    "| Volatility | Volatile | Non-volatile |",
    "| Speed | Fast | Slower |",
    "",
    "That is the key difference.",
  ].join("\n");

  const segs = splitAiContent(src);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].kind, "markdown");
  assert.equal(segs[1].kind, "table");
  assert.equal(segs[2].kind, "markdown");

  assert.equal(segs[1].kind, "table");
  if (segs[1].kind !== "table") return;
  assert.deepEqual(segs[1].table.head, ["Feature", "RAM", "Storage"]);
  assert.deepEqual(segs[1].table.rows, [
    ["Volatility", "Volatile", "Non-volatile"],
    ["Speed", "Fast", "Slower"],
  ]);
  assert.deepEqual(segs[1].table.align, [null, "center", "right"]);
  assert.equal(hasMarkdownTable(src), true);
});

test("ragged body rows are padded / truncated to the header width", () => {
  const src = ["| A | B | C |", "| - | - | - |", "| short |", "| w | x | y | z |"].join("\n");
  const segs = splitAiContent(src);
  assert.equal(segs[0].kind, "table");
  if (segs[0].kind !== "table") return;
  assert.deepEqual(segs[0].table.rows, [
    ["short", "", ""],
    ["w", "x", "y"],
  ]);
});

test("pipes inside a fenced code block are never treated as a table", () => {
  const src = ["```", "| a | b |", "| - | - |", "| 1 | 2 |", "```"].join("\n");
  const segs = splitAiContent(src);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "markdown");
  assert.equal(hasMarkdownTable(src), false);
});

test("two tables separated by prose produce three ordered segments", () => {
  const src = [
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "then",
    "",
    "| c | d |",
    "| - | - |",
    "| 3 | 4 |",
  ].join("\n");
  const segs = splitAiContent(src);
  assert.deepEqual(
    segs.map((s) => s.kind),
    ["table", "markdown", "table"],
  );
});

test("a header + divider with no body rows is still a table segment", () => {
  const segs = splitAiContent("| a | b |\n| - | - |");
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "table");
  if (segs[0].kind !== "table") return;
  assert.deepEqual(segs[0].table.rows, []);
});

test("empty / whitespace input yields a single markdown segment", () => {
  assert.deepEqual(splitAiContent(""), [{ kind: "markdown", text: "" }]);
  assert.equal(splitAiContent("   \n  ")[0].kind, "markdown");
});
