/**
 * R6 — embedded remedial video recommendations: id/url validation, deterministic
 * relevance ranking, course-first selection, cache/no-autoplay/security
 * structural checks, and proof that VARK / A7 / R4 are untouched.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/remedial-video.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildYouTubeEmbedUrl,
  extractYouTubeId,
  formatVideoDuration,
  parseIso8601Duration,
  parseRemedialVideoRecommendation,
  watchUrl,
} from "@/lib/remedial-video";
import {
  courseVideoCandidates,
  pickBestVideo,
  REMEDIAL_VIDEO_MIN_RELEVANCE,
  scoreVideoRelevance,
  significantTerms,
  type VideoCandidate,
} from "@/lib/remedial-video-ranking";
import { buildVideoSearchQuery } from "@/lib/remedial-video-search";

const ID = "dQw4w9WgXcQ"; // 11 valid chars

/* ---------------- YouTube id / url validation ---------------- */

test("1. extractYouTubeId accepts every supported YouTube shape", () => {
  for (const url of [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=30s`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
  ]) {
    assert.equal(extractYouTubeId(url), ID, url);
  }
});

test("2. unsupported domains / shapes are rejected", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "not a url",
    "https://vimeo.com/123456789",
    `https://evil.example.com/embed/${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/embed/", // no id
    `javascript:alert(1)//${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`,
  ]) {
    assert.equal(extractYouTubeId(bad as string), null, String(bad));
  }
});

test("3. buildYouTubeEmbedUrl is privacy-enhanced, has NO autoplay, needs a valid id", () => {
  const url = buildYouTubeEmbedUrl(ID);
  assert.match(url, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.doesNotMatch(url, /autoplay/i);
  assert.match(url, /rel=0/);
  assert.throws(() => buildYouTubeEmbedUrl("../../etc/passwd"));
  assert.throws(() => buildYouTubeEmbedUrl(`${ID}&malicious=1`));
  assert.throws(() => watchUrl("bad"));
});

/* ---------------- untrusted metadata ---------------- */

test("4. parseRemedialVideoRecommendation rejects malformed / fabricated metadata", () => {
  for (const bad of [
    null,
    {},
    { videoId: "tooshort", title: "x", source: "youtube", reason: "r" },
    { videoId: ID, title: "", source: "youtube", reason: "r" }, // empty title
    { videoId: ID, title: "x", source: "vimeo", reason: "r" }, // bad source
    { videoId: ID, title: "x", source: "youtube" }, // missing reason
    { videoId: ID, title: "x", source: "youtube", reason: "r", durationSeconds: -5 },
    { videoId: ID, title: "x", source: "youtube", reason: "r", durationSeconds: 999999 },
  ]) {
    assert.equal(parseRemedialVideoRecommendation(bad), null, JSON.stringify(bad));
  }
  const ok = parseRemedialVideoRecommendation({
    videoId: ID,
    title: "Partial dependencies explained",
    channelTitle: "DB School",
    durationSeconds: 480,
    source: "youtube",
    reason: "Covers partial dependencies.",
  });
  assert.ok(ok);
  assert.equal(ok.videoId, ID);
});

test("5. ISO-8601 duration parsing never guesses", () => {
  assert.equal(parseIso8601Duration("PT8M20S"), 500);
  assert.equal(parseIso8601Duration("PT1H2M"), 3720);
  assert.equal(parseIso8601Duration("PT45S"), 45);
  assert.equal(parseIso8601Duration(null), null);
  assert.equal(parseIso8601Duration("garbage"), null);
  assert.equal(parseIso8601Duration("P0D"), null);
  assert.equal(formatVideoDuration(500), "8:20");
  assert.equal(formatVideoDuration(3720), "1:02:00");
  assert.equal(formatVideoDuration(undefined), null);
});

/* ---------------- deterministic relevance ranking ---------------- */

const WEAK = ["Second Normal Form partial dependencies", "Functional dependency"];
const TOPIC = "Database normalization";

test("6. scoreVideoRelevance is deterministic keyword overlap (no popularity)", () => {
  const a = scoreVideoRelevance({
    candidateText: "Second Normal Form and partial dependencies in database normalization",
    topicTitle: TOPIC,
    weakConcepts: WEAK,
  });
  const b = scoreVideoRelevance({
    candidateText: "Ten celebrity gossip moments you missed this week",
    topicTitle: TOPIC,
    weakConcepts: WEAK,
  });
  assert.ok(a > 0.5, `relevant scored ${a}`);
  assert.ok(b < REMEDIAL_VIDEO_MIN_RELEVANCE, `irrelevant scored ${b}`);
  // stable
  assert.equal(
    a,
    scoreVideoRelevance({
      candidateText: "Second Normal Form and partial dependencies in database normalization",
      topicTitle: TOPIC,
      weakConcepts: WEAK,
    }),
  );
  assert.ok(!significantTerms("the a an of").length); // stopwords stripped
});

test("7. pickBestVideo picks the most relevant candidate, ties break by input order", () => {
  const candidates: VideoCandidate[] = [
    { videoId: "aaaaaaaaaaa", title: "Unrelated cooking video", durationSeconds: 600 },
    {
      videoId: "bbbbbbbbbbb",
      title: "Partial dependencies and Second Normal Form (2NF) — database normalization",
      channelTitle: "DB School",
      durationSeconds: 500,
    },
    {
      videoId: "ccccccccccc",
      title: "Database normalization full course",
      description: "normalization overview",
      durationSeconds: 500,
    },
  ];
  const rec = pickBestVideo({
    candidates,
    topicTitle: TOPIC,
    weakConcepts: WEAK,
    source: "youtube",
  });
  assert.ok(rec);
  assert.equal(rec.videoId, "bbbbbbbbbbb");
  assert.equal(rec.source, "youtube");
  assert.match(rec.reason, /external YouTube/i); // clearly labelled
});

test("8. an irrelevant course video is rejected (no free pass for course source)", () => {
  const rec = pickBestVideo({
    candidates: [{ videoId: ID, title: "Welcome to the module — intro", durationSeconds: 120 }],
    topicTitle: TOPIC,
    weakConcepts: WEAK,
    source: "course",
  });
  assert.equal(rec, null);
});

test("9. provider/AI cannot inject arbitrary ids — non-11-char candidates are dropped", () => {
  const rec = pickBestVideo({
    candidates: [
      {
        videoId: "'; DROP TABLE",
        title: "Second Normal Form partial dependencies",
        durationSeconds: 400,
      },
      { videoId: "short", title: "partial dependencies normalization", durationSeconds: 400 },
    ],
    topicTitle: TOPIC,
    weakConcepts: WEAK,
    source: "youtube",
  });
  assert.equal(rec, null);
});

test("10. non-embeddable and extreme-duration candidates are excluded", () => {
  const base = { title: "Second Normal Form partial dependencies normalization" };
  assert.equal(
    pickBestVideo({
      candidates: [{ videoId: "bbbbbbbbbbb", ...base, embeddable: false }],
      topicTitle: TOPIC,
      weakConcepts: WEAK,
      source: "youtube",
    }),
    null,
  );
  assert.equal(
    pickBestVideo({
      candidates: [{ videoId: "bbbbbbbbbbb", ...base, durationSeconds: 8 }],
      topicTitle: TOPIC,
      weakConcepts: WEAK,
      source: "youtube",
    }),
    null,
  );
});

test("11. courseVideoCandidates only yields YouTube-embedded video lessons", () => {
  const cands = courseVideoCandidates([
    {
      modality: "video",
      title: "2NF partial dependencies",
      body_md: null,
      media_url: `https://www.youtube.com/embed/${ID}`,
      duration_sec: 500,
    },
    {
      modality: "video",
      title: "Uploaded lecture",
      body_md: null,
      media_url: "https://cdn.site/storage/v1/object/x.mp4",
      duration_sec: 500,
    },
    { modality: "text", title: "Reading", body_md: "words", media_url: null, duration_sec: null },
    {
      modality: "video",
      title: "Vimeo talk",
      body_md: null,
      media_url: "https://vimeo.com/999",
      duration_sec: 500,
    },
  ]);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].videoId, ID);
});

test("12. buildVideoSearchQuery is topic + weak concepts + educational intent", () => {
  const q = buildVideoSearchQuery({ topicTitle: TOPIC, weakConcepts: WEAK });
  assert.match(q, /Database normalization/);
  assert.match(q, /partial dependencies/i);
  assert.match(q, /tutorial|explained/);
});

/* ---------------- structural: server fn / hook / card / migration ---------------- */

const fnSrc = readFileSync(
  fileURLToPath(new URL("./remedial-video.functions.ts", import.meta.url)),
  "utf8",
);
const searchSrc = readFileSync(
  fileURLToPath(new URL("./remedial-video-search.ts", import.meta.url)),
  "utf8",
);
const rankSrc = readFileSync(
  fileURLToPath(new URL("./remedial-video-ranking.ts", import.meta.url)),
  "utf8",
);
const modelSrc = readFileSync(
  fileURLToPath(new URL("./remedial-video.ts", import.meta.url)),
  "utf8",
);
const hookSrc = readFileSync(
  fileURLToPath(new URL("../hooks/use-remedial-video.ts", import.meta.url)),
  "utf8",
);
const cardSrc = readFileSync(
  fileURLToPath(new URL("../components/course/RemedialVideoCard.tsx", import.meta.url)),
  "utf8",
);
const panelSrc = readFileSync(
  fileURLToPath(new URL("../components/course/RemedialExplanation.tsx", import.meta.url)),
  "utf8",
);
const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260906270000_study_path_remedial_video.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const bootstrap = readFileSync(
  fileURLToPath(new URL("../../supabase/bootstrap_new_project.sql", import.meta.url)),
  "utf8",
);

test("13. course video is tried BEFORE the external search", () => {
  const courseIdx = fnSrc.indexOf('source: "course"');
  const searchIdx = fnSrc.indexOf("searchYouTubeVideos(");
  assert.ok(courseIdx > 0 && searchIdx > 0 && courseIdx < searchIdx);
  // the external search only runs when there is no recommendation yet
  assert.match(fnSrc, /if \(!recommendation\) \{[\s\S]{0,400}searchYouTubeVideos/);
});

test("14. the recommendation is cached — no search on every render", () => {
  assert.match(
    fnSrc,
    /if \(!data\.refresh && row\.remedial_video_generated_at\)[\s\S]{0,200}status: "existing"/,
  );
  assert.match(fnSrc, /save_study_path_remedial_video/);
  // the hook never refetches on focus/mount
  assert.match(hookSrc, /staleTime: Infinity/);
  assert.match(hookSrc, /refetchOnWindowFocus: false/);
  assert.match(hookSrc, /refetchOnMount: false/);
});

test("15. no AI is involved in choosing / describing the video (deterministic only)", () => {
  for (const src of [fnSrc, searchSrc, rankSrc, modelSrc]) {
    assert.doesNotMatch(src, /callAI|course-chat\.functions|openrouter/i);
  }
});

test("16. YouTube API key is server-only", () => {
  assert.match(searchSrc, /process\.env\.YOUTUBE_API_KEY/);
  for (const src of [fnSrc, searchSrc, rankSrc, modelSrc, hookSrc, cardSrc, panelSrc]) {
    assert.doesNotMatch(src, /VITE_YOUTUBE|import\.meta\.env\.[A-Z_]*YOUTUBE/);
  }
  // the key never leaves the search module
  assert.doesNotMatch(cardSrc, /YOUTUBE_API_KEY/);
  assert.doesNotMatch(hookSrc, /YOUTUBE_API_KEY/);
  assert.doesNotMatch(fnSrc, /YOUTUBE_API_KEY/);
});

test("17. the server fn requires an established student + an owned Study Path", () => {
  assert.match(fnSrc, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(fnSrc, /requireEstablishedStudent\(supabase, userId\)/);
  assert.match(
    fnSrc,
    /role !== "student" \|\| data\.status !== "established"[\s\S]{0,60}NOT_AN_ESTABLISHED_STUDENT/,
  );
  assert.match(fnSrc, /loadOwnStudyPath\(supabase, userId/);
  assert.match(fnSrc, /studyPathId: z\.string\(\)\.uuid\(\)/);
  // the client input schema carries ONLY studyPathId + refresh
  assert.match(
    fnSrc,
    /const input = z\.object\(\{\s*studyPathId: z\.string\(\)\.uuid\(\),\s*refresh: z\.boolean\(\)\.optional\(\),\s*\}\)/,
  );
  // course / topic / weak concepts come from the loaded row + parsed content,
  // never from a client-supplied claim
  assert.doesNotMatch(fnSrc, /data\.courseId|data\.topicId|data\.course_id|data\.weakConcepts/);
  assert.match(fnSrc, /parsedContent\.data\.weakAreas\.map/);
});

test("18. the save RPC is SECURITY DEFINER with auth + established-student + ownership", () => {
  for (const sql of [migration, bootstrap]) {
    const fn = sql.slice(sql.indexOf("function public.save_study_path_remedial_video"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    assert.match(body, /security definer/);
    assert.match(body, /if v_uid is null then raise exception 'AUTH_REQUIRED'/);
    assert.match(
      body,
      /role = 'student' and status = 'established'[\s\S]{0,80}NOT_AN_ESTABLISHED_STUDENT/,
    );
    assert.match(body, /v_owner <> v_uid then raise exception 'STUDY_PATH_NOT_OWNED'/);
    assert.match(body, /jsonb_typeof\(_video\) <> 'object'/);
  }
  assert.match(
    bootstrap,
    /revoke execute on function public\.save_study_path_remedial_video\(uuid, jsonb\)\s+from public, anon/,
  );
});

test("19. the migration touches only study_paths + its own function", () => {
  assert.match(
    migration,
    /alter table public\.study_paths\s+add column if not exists remedial_video/,
  );
  assert.doesNotMatch(
    migration,
    /alter table public\.(vark_profiles|learning_preferences|learning_interactions|quiz_attempts|progress)\b/,
  );
  assert.doesNotMatch(
    migration,
    /event_type|meaningful_engagement|grade_quiz|buildModalityEvidence/,
  );
});

test("20. no autoplay anywhere in the embed", () => {
  // the constructed URL carries no autoplay/auto-start param
  assert.doesNotMatch(buildYouTubeEmbedUrl(ID), /autoplay|auto_?play|start=/i);
  // the iframe's own attributes/`allow` list never grant autoplay
  const iframe = cardSrc.slice(
    cardSrc.indexOf("<iframe"),
    cardSrc.indexOf("/>", cardSrc.indexOf("<iframe")),
  );
  assert.doesNotMatch(iframe, /autoplay|autoPlay/i);
  // the card builds the src ONLY from buildYouTubeEmbedUrl(validated id)
  assert.match(cardSrc, /buildYouTubeEmbedUrl\(recommendation\.videoId\)/);
  assert.match(cardSrc, /YOUTUBE_ID_RE\.test\(recommendation\.videoId\)/);
  assert.doesNotMatch(cardSrc, /dangerouslySetInnerHTML/);
  assert.match(cardSrc, /allowFullScreen/);
});

test("21. external video is clearly labelled and not implied lecturer-approved", () => {
  assert.match(cardSrc, /YouTube recommendation/);
  assert.match(cardSrc, /not reviewed or endorsed by your lecturer/i);
  assert.match(cardSrc, /Course material/);
});

test("22. failure is graceful — the card is fail-safe and never blocks remediation", () => {
  assert.match(hookSrc, /catch \{\s*return null;/);
  assert.match(searchSrc, /catch \(e\) \{[\s\S]{0,120}return \[\];/);
  assert.match(searchSrc, /if \(!key \|\| !query\.trim\(\)\) return \[\]/);
  // the card renders a calm empty state, never throws on a missing/invalid rec
  assert.match(cardSrc, /if \(!recommendation \|\| !validId\)/);
  assert.match(cardSrc, /text, audio and visual explanations/i);
  // the panel only mounts the card when there IS remedial content, as a sibling
  assert.match(panelSrc, /\{hasContent && \(\s*<RemedialVideoCard/);
});

test("23. VARK / A7 / Learning Preferences / Mastery are untouched by R6", () => {
  for (const src of [fnSrc, searchSrc, rankSrc, modelSrc, hookSrc, cardSrc]) {
    assert.doesNotMatch(
      src,
      /vark_profiles|buildModalityEvidence|computeAdaptiveModalityRecommendation|adaptive-modality|computeModuleMastery|\.rpc\("grade_quiz/i,
    );
    assert.doesNotMatch(src, /\.from\("learning_preferences"\)|\.from\("vark_profiles"\)/);
  }
});

test("24. R4 / A7 event isolation — R6 emits no learning_interactions events", () => {
  for (const src of [fnSrc, searchSrc, rankSrc, modelSrc, hookSrc, cardSrc]) {
    assert.doesNotMatch(
      src,
      /meaningful_engagement|remedial_format_selected|remedial_meaningful_engagement|remedial_video_started|logInteraction|logRemedialInteraction/,
    );
    assert.doesNotMatch(src, /\.from\("learning_interactions"\)/);
  }
  // R6 adds NO new event type to the check constraint
  assert.doesNotMatch(migration, /remedial_video_started|remedial_video_meaningful_engagement/);
});
