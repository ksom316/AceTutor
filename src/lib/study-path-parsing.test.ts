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

/* ---- the exact production failure: fenced + pretty-printed + cut inside a
 *      weakArea.practice array (anthropic/claude-sonnet-5, finish=length) ---- */

// Faithful reproduction of a captured live truncation: ```json fence, pretty-
// printed, two complete weak areas, then a third whose `practice` array is cut
// off part-way through the SECOND practice item's answer string.
const FENCED_TRUNCATED_MID_PRACTICE = [
  "```json",
  "{",
  '  "title": "Personalized Study Path",',
  '  "weakAreas": [',
  "    {",
  '      "title": "Balance Factor Calculation",',
  '      "explanation": "The balance factor is height(left) minus height(right); a valid AVL node keeps it in {-1, 0, 1}.",',
  '      "example": "A node with left height 2 and right height 0 has balance factor 2, so it is unbalanced.",',
  '      "practice": [',
  '        { "question": "Left height 3, right height 1 — balance factor?", "answer": "2, left-heavy, needs a rotation." }',
  "      ]",
  "    },",
  "    {",
  '      "title": "Choosing the Rotation Case",',
  '      "explanation": "LL and RR need one rotation; LR and RL need two.",',
  '      "example": "Insert into the left subtree of the left child -> LL -> single right rotation.",',
  '      "practice": [',
  '        { "question": "Insert into right subtree of right child — which case?", "answer": "RR, single left rotation." }',
  "      ]",
  "    },",
  "    {",
  '      "title": "Performing the Rotation",',
  '      "explanation": "Reassign child pointers without dropping subtrees, then recompute heights.",',
  '      "example": "On a right rotation, the left child becomes the new root of the subtree.",',
  '      "practice": [',
  '        { "question": "After a right rotation, whose height do you update first?", "answer": "The old root, then the new root." },',
  '        { "question": "What property must still hold after the rotation is complete for the tree to remain a valid search structure, and why does an in-order tra',
].join("\n");

test("recovers 3 complete weak areas from the exact fenced/pretty-printed mid-practice truncation", () => {
  const content = parseStudyPath(FENCED_TRUNCATED_MID_PRACTICE);
  assert.ok(content, "expected the complete weak areas to survive");
  // 3rd area keeps its one complete practice item; the half-written 2nd is dropped.
  assert.equal(content!.weakAreas.length, 3);
  assert.equal(content!.weakAreas[2].practice.length, 1);
  assert.equal(studyPathContentSchema.safeParse(content).success, true);
});

test("parseLenientJson: array cut inside weakArea.practice keeps the finished practice items", () => {
  const raw =
    '{"weakAreas":[{"title":"A","explanation":"e","example":"x","practice":[' +
    '{"question":"q1","answer":"a1"},{"question":"q2","answer":"a2"},{"question":"q3","answer":"a3 but then it cuts o';
  const out = parseLenientJson(raw) as { weakAreas: { practice: unknown[] }[] } | null;
  assert.ok(out);
  assert.equal(out!.weakAreas.length, 1);
  assert.equal(out!.weakAreas[0].practice.length, 2); // q1, q2 kept; q3 truncated
});

test("ignores trailing prose after a complete JSON object", () => {
  const raw =
    JSON.stringify(fullPath(2)) + "\n\nLet me know if you'd like more detail on any area!";
  const content = parseStudyPath(raw);
  assert.ok(content);
  assert.equal(content!.weakAreas.length, 2);
});

test("skips a stray '{' in leading prose", () => {
  const raw = "Sure — the JSON is shaped like {title, weakAreas}:\n" + JSON.stringify(fullPath(2));
  const content = parseStudyPath(raw);
  assert.ok(content);
  assert.equal(content!.weakAreas.length, 2);
});

test("recovers when a comma between two weak areas is missing then truncated", () => {
  // 'Expected ,' or ']' after array element' — the element before the missing
  // comma still parses via an earlier cut point.
  const a = JSON.stringify(weakArea(1));
  const b = JSON.stringify(weakArea(2));
  const raw = `{"title":"P","weakAreas":[${a} ${b.slice(0, 40)}`;
  const content = parseStudyPath(raw);
  assert.ok(content);
  assert.equal(content!.weakAreas.length, 1);
});

/* ---- fuzz: a long response can never yield invalid/throwing output ------ */

test("truncating a long response at every offset yields only valid content or null", () => {
  // Both compact and fenced/pretty-printed, since real replies come both ways.
  for (const raw of [
    JSON.stringify(fullPath(8)),
    "```json\n" + JSON.stringify(fullPath(6), null, 2) + "\n```",
  ]) {
    for (let cut = 0; cut <= raw.length; cut++) {
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
  }
});
