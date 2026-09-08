/**
 * Regression: `anthropic/claude-sonnet-5` (and any model) can hit its output-
 * token cap mid-response and return JSON that stops partway through the
 * `weakAreas` array — `finish=length`, `contentLen≈4372`. Before this fix
 * `JSON.parse` threw ("Expected ',' or ']' after array element") and the whole
 * Study Path was lost, including the weak areas that came back complete.
 *
 * `parseLenientJson` now repairs a truncated object best-effort, and
 * `parseStudyPath` must NEVER throw and NEVER return invalid content: it either
 * returns schema-valid `StudyPathContent` or `null`.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/study-path-parsing.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseLenientJson,
  parseStudyPath,
  studyPathContentSchema,
} from "@/lib/study-path.functions";

/* ---- fixtures ---------------------------------------------------------- */

function weakArea(n: number) {
  return {
    title: `Concept ${n}`,
    explanation:
      `The student confused idea ${n} with a neighbouring one. ` +
      "The key distinction is direction of dependency and when each applies.",
    example: `Given input ${n}, the correct step is to normalise first, then compare — not the reverse.`,
    practice: [
      { question: `Practice question ${n}a?`, answer: `Answer ${n}a.` },
      { question: `Practice question ${n}b?`, answer: `Answer ${n}b.` },
    ],
  };
}

function fullPath(areas: number) {
  return {
    title: "Personalized Study Path",
    weakAreas: Array.from({ length: areas }, (_, i) => weakArea(i + 1)),
  };
}

/* ---- parseLenientJson: pure repair helper ---------------------------- */

test("parseLenientJson returns clean JSON untouched", () => {
  assert.deepEqual(parseLenientJson('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] });
});

test("parseLenientJson closes a truncated nested array/object", () => {
  const out = parseLenientJson('{"title":"x","weakAreas":[{"title":"a"},{"title":"b"');
  assert.ok(out && typeof out === "object");
  assert.deepEqual((out as { weakAreas: unknown[] }).weakAreas, [{ title: "a" }]);
});

test("parseLenientJson keeps earlier complete elements when a later value is cut mid-string", () => {
  const out = parseLenientJson(
    '{"weakAreas":[{"title":"a"},{"title":"b","explanation":"half a sen',
  );
  assert.deepEqual(out, { weakAreas: [{ title: "a" }] });
});

test("parseLenientJson returns null when the only value is cut mid-string", () => {
  assert.equal(parseLenientJson('{"weakAreas":[{"title":"a","explanation":"half a sen'), null);
});

test("parseLenientJson never throws and returns null on unrepairable garbage", () => {
  assert.equal(parseLenientJson("not json at all"), null);
  assert.equal(parseLenientJson("<<< >>>"), null);
  assert.equal(parseLenientJson(""), null);
});

/* ---- parseStudyPath: clean inputs ---------------------------------------- */

test("parses a well-formed study path", () => {
  const content = parseStudyPath(JSON.stringify(fullPath(3)));
  assert.ok(content);
  assert.equal(content!.weakAreas.length, 3);
  assert.equal(studyPathContentSchema.safeParse(content).success, true);
});

test("strips ```json fences and surrounding prose", () => {
  const raw =
    "Here is your path:\n```json\n" + JSON.stringify(fullPath(2)) + "\n```\nHope it helps!";
  const content = parseStudyPath(raw);
  assert.ok(content);
  assert.equal(content!.weakAreas.length, 2);
});

test("caps oversized responses at 4 weakAreas", () => {
  const content = parseStudyPath(JSON.stringify(fullPath(9)));
  assert.ok(content);
  assert.equal(content!.weakAreas.length, 4);
});

/* ---- parseStudyPath: the truncation regression -------------------------- */

test("recovers the complete weak areas when the 4th is cut off (the real failure)", () => {
  // 3 complete areas, then a 4th that stops mid-practice — exactly what
  // finish=length produces.
  const good = fullPath(3);
  let raw = JSON.stringify(good);
  raw =
    raw.slice(0, -2) + // drop the closing ']}' of the valid doc
    ',{"title":"Concept 4","explanation":"Students often mix up the two forms because the notation looks similar and the';
  const content = parseStudyPath(raw);
  assert.ok(content, "expected the 3 complete areas to survive");
  assert.equal(content!.weakAreas.length, 3);
  assert.equal(studyPathContentSchema.safeParse(content).success, true);
});

test("recovers when truncation lands right after a complete weak area + comma", () => {
  const good = fullPath(2);
  let raw = JSON.stringify(good);
  raw = raw.slice(0, -2) + ',{"title":"Concept 3",';
  const content = parseStudyPath(raw);
  assert.ok(content);
  assert.equal(content!.weakAreas.length, 2);
});

test("returns null (never throws) when nothing usable survives truncation", () => {
  // Cut off during the very first weak area, before it is ever closed.
  const raw =
    '{"title":"Personalized Study Path","weakAreas":[{"title":"Concept 1","explanation":"the';
  assert.equal(parseStudyPath(raw), null);
});

test("returns null on an empty or whitespace reply", () => {
  assert.equal(parseStudyPath(""), null);
  assert.equal(parseStudyPath("   \n  "), null);
});

/* ---- fuzz: a long response can never yield invalid/throwing output ------ */

test("truncating a long response at every offset yields only valid content or null", () => {
  const raw = JSON.stringify(fullPath(8), null, 2); // large, pretty-printed
  for (let cut = 0; cut <= raw.length; cut += 7) {
    const sliced = raw.slice(0, cut);
    let content: ReturnType<typeof parseStudyPath>;
    assert.doesNotThrow(() => {
      content = parseStudyPath(sliced);
    }, `threw at cut=${cut}`);
    if (content!) {
      const check = studyPathContentSchema.safeParse(content);
      assert.equal(check.success, true, `invalid content at cut=${cut}`);
      assert.ok(content!.weakAreas.length >= 1 && content!.weakAreas.length <= 4);
    }
  }
});
