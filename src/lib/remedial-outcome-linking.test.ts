/**
 * R4 — observational linking of remedial engagement to a later official
 * module quiz. Pure.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-outcome-linking.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  linkRemedialEngagementsToOutcomes,
  type OfficialModuleOutcome,
  type RemedialEngagementRecord,
} from "@/lib/remedial-outcome-linking";

const eng = (over: Partial<RemedialEngagementRecord>): RemedialEngagementRecord => ({
  studyPathId: "sp1",
  topicId: "topic-a",
  formatUsed: "audio",
  recommendedFormat: "audio",
  engagedAt: "2026-01-10T00:00:00Z",
  ...over,
});

const out = (over: Partial<OfficialModuleOutcome>): OfficialModuleOutcome => ({
  attemptId: `att-${Math.random()}`,
  topicId: "topic-a",
  scorePercent: 80,
  completedAt: "2026-01-20T00:00:00Z",
  ...over,
});

test("14. links only to a SUBSEQUENT quiz for the SAME topic", () => {
  const links = linkRemedialEngagementsToOutcomes({
    engagements: [eng({})],
    moduleOutcomes: [
      out({ topicId: "topic-b", completedAt: "2026-01-20T00:00:00Z", scorePercent: 90 }), // wrong topic
      out({ topicId: "topic-a", completedAt: "2026-01-05T00:00:00Z", scorePercent: 55 }), // before engagement
      out({ topicId: "topic-a", completedAt: "2026-01-20T00:00:00Z", scorePercent: 80 }), // the one
    ],
    baselineScoreByStudyPath: new Map([["sp1", 40]]),
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].topicId, "topic-a");
  assert.equal(links[0].subsequentScorePercent, 80);
  assert.equal(links[0].subsequentQuizAt, "2026-01-20T00:00:00Z");
});

test("15/16. General Course Quiz + practice Quiz Me are the caller's responsibility — only module outcomes are passed", () => {
  // linker takes `moduleOutcomes` (already filtered). With none, no link.
  const links = linkRemedialEngagementsToOutcomes({
    engagements: [eng({})],
    moduleOutcomes: [],
    baselineScoreByStudyPath: new Map([["sp1", 40]]),
  });
  assert.deepEqual(links, []);
});

test("17. the FIRST qualifying subsequent module quiz is chosen", () => {
  const links = linkRemedialEngagementsToOutcomes({
    engagements: [eng({ engagedAt: "2026-01-10T00:00:00Z" })],
    moduleOutcomes: [
      out({ completedAt: "2026-01-30T00:00:00Z", scorePercent: 95 }),
      out({ completedAt: "2026-01-15T00:00:00Z", scorePercent: 70 }), // earliest after engagement
      out({ completedAt: "2026-01-22T00:00:00Z", scorePercent: 88 }),
    ],
    baselineScoreByStudyPath: new Map([["sp1", 40]]),
  });
  assert.equal(links[0].subsequentScorePercent, 70);
  assert.equal(links[0].subsequentQuizAt, "2026-01-15T00:00:00Z");
});

test("40% -> Text + Audio -> 80%: two format observations, ONE unique subsequent quiz", () => {
  const retake = out({
    attemptId: "att-retake",
    completedAt: "2026-01-20T00:00:00Z",
    scorePercent: 80,
  });
  const links = linkRemedialEngagementsToOutcomes({
    engagements: [
      eng({ studyPathId: "sp1", formatUsed: "text", engagedAt: "2026-01-11T00:00:00Z" }),
      eng({ studyPathId: "sp1", formatUsed: "audio", engagedAt: "2026-01-12T00:00:00Z" }),
    ],
    moduleOutcomes: [retake],
    baselineScoreByStudyPath: new Map([["sp1", 40]]),
  });
  // both engagements legitimately precede the same 80% retake — neither is discarded
  assert.equal(links.length, 2);
  assert.deepEqual(links.map((l) => l.formatUsed).sort(), ["audio", "text"]);
  // ...but they point at the SAME real attempt id
  assert.deepEqual(new Set(links.map((l) => l.subsequentAttemptId)), new Set(["att-retake"]));
  for (const l of links) {
    assert.equal(l.subsequentScorePercent, 80);
    assert.equal(l.baselineScorePercent, 40);
    assert.equal(l.observedScoreDifference, 40);
  }
});

test("each engagement links to ITS OWN first subsequent quiz (different retakes)", () => {
  const links = linkRemedialEngagementsToOutcomes({
    engagements: [
      eng({ studyPathId: "spA", formatUsed: "text", engagedAt: "2026-01-10T00:00:00Z" }),
      eng({ studyPathId: "spB", formatUsed: "audio", engagedAt: "2026-01-25T00:00:00Z" }),
    ],
    moduleOutcomes: [
      out({ attemptId: "att-1", completedAt: "2026-01-15T00:00:00Z", scorePercent: 60 }),
      out({ attemptId: "att-2", completedAt: "2026-01-30T00:00:00Z", scorePercent: 85 }),
    ],
    baselineScoreByStudyPath: new Map([
      ["spA", 40],
      ["spB", 55],
    ]),
  });
  assert.equal(links.length, 2);
  assert.equal(links.find((l) => l.studyPathId === "spA")?.subsequentAttemptId, "att-1");
  assert.equal(links.find((l) => l.studyPathId === "spB")?.subsequentAttemptId, "att-2");
});

test("18. the Study Path's baseline attempt score is used as baselineScorePercent", () => {
  const links = linkRemedialEngagementsToOutcomes({
    engagements: [eng({ studyPathId: "sp1" })],
    moduleOutcomes: [out({ scorePercent: 80 })],
    baselineScoreByStudyPath: new Map([["sp1", 40]]),
  });
  assert.equal(links[0].baselineScorePercent, 40);

  // unknown baseline -> null (and no fabricated difference)
  const noBaseline = linkRemedialEngagementsToOutcomes({
    engagements: [eng({ studyPathId: "sp2" })],
    moduleOutcomes: [out({ scorePercent: 80 })],
    baselineScoreByStudyPath: new Map(),
  });
  assert.equal(noBaseline[0].baselineScorePercent, null);
  assert.equal(noBaseline[0].observedScoreDifference, null);
});

test("19. observed score difference = subsequent - baseline (observational, may be negative)", () => {
  const up = linkRemedialEngagementsToOutcomes({
    engagements: [eng({ studyPathId: "sp1", formatUsed: "audio" })],
    moduleOutcomes: [out({ scorePercent: 80 })],
    baselineScoreByStudyPath: new Map([["sp1", 40]]),
  });
  assert.equal(up[0].observedScoreDifference, 40);

  const down = linkRemedialEngagementsToOutcomes({
    engagements: [eng({ studyPathId: "sp1" })],
    moduleOutcomes: [out({ scorePercent: 30 })],
    baselineScoreByStudyPath: new Map([["sp1", 55]]),
  });
  assert.equal(down[0].observedScoreDifference, -25);
});

test("no subsequent quiz -> no link (a sequence we can't report)", () => {
  const links = linkRemedialEngagementsToOutcomes({
    engagements: [eng({ engagedAt: "2026-06-01T00:00:00Z" })],
    moduleOutcomes: [out({ completedAt: "2026-05-01T00:00:00Z" })], // before
    baselineScoreByStudyPath: new Map([["sp1", 40]]),
  });
  assert.deepEqual(links, []);
});
