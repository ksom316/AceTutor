/**
 * R2 — audio remedial delivery: pure control-state tests + structural checks
 * on the speech hook / player / panel wiring (no DOM in the node runner).
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/speech-controls.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSpeechControls } from "@/lib/speech-controls";
import { REMEDIAL_MODALITY_IMPLEMENTED } from "@/lib/remedial-modality";

/* ---------------- resolveSpeechControls (pure) ---------------- */

const idle = { supported: true, speaking: false, paused: false };
const playing = { supported: true, speaking: true, paused: false };
const pausedMid = { supported: true, speaking: true, paused: true };

test("3. idle -> Play enabled, everything else disabled (no overlap possible)", () => {
  const c = resolveSpeechControls(idle);
  assert.deepEqual(
    { p: c.canPlay, pa: c.canPause, r: c.canResume, rs: c.canRestart, s: c.canStop },
    { p: true, pa: false, r: false, rs: false, s: false },
  );
  assert.equal(c.statusLabel, "Ready");
});

test("3b. while speaking -> Play disabled (a second Play cannot start a 2nd voice)", () => {
  const c = resolveSpeechControls(playing);
  assert.equal(c.canPlay, false);
});

test("4. Pause is only offered while actively speaking", () => {
  assert.equal(resolveSpeechControls(playing).canPause, true);
  assert.equal(resolveSpeechControls(pausedMid).canPause, false);
  assert.equal(resolveSpeechControls(idle).canPause, false);
});

test("5. Resume is only offered while paused", () => {
  assert.equal(resolveSpeechControls(pausedMid).canResume, true);
  assert.equal(resolveSpeechControls(playing).canResume, false);
  assert.equal(resolveSpeechControls(idle).canResume, false);
});

test("6. Stop is disabled when idle, enabled once a narration exists", () => {
  assert.equal(resolveSpeechControls(idle).canStop, false);
  assert.equal(resolveSpeechControls(playing).canStop, true);
  assert.equal(resolveSpeechControls(pausedMid).canStop, true);
});

test("7. Restart is offered whenever a narration exists (speaking or paused)", () => {
  assert.equal(resolveSpeechControls(idle).canRestart, false);
  assert.equal(resolveSpeechControls(playing).canRestart, true);
  assert.equal(resolveSpeechControls(pausedMid).canRestart, true);
  assert.equal(resolveSpeechControls(playing).statusLabel, "Speaking…");
  assert.equal(resolveSpeechControls(pausedMid).statusLabel, "Paused");
});

test("10. unsupported -> every control disabled + honest status", () => {
  const c = resolveSpeechControls({ supported: false, speaking: false, paused: false });
  assert.deepEqual(
    [c.canPlay, c.canPause, c.canResume, c.canRestart, c.canStop],
    [false, false, false, false, false],
  );
  assert.equal(c.statusLabel, "Not supported");
});

/* ---------------- structural: hook + player + panel ---------------- */

const hookSrc = readFileSync(
  fileURLToPath(new URL("../hooks/use-speech-synthesis.ts", import.meta.url)),
  "utf8",
);
const playerSrc = readFileSync(
  fileURLToPath(new URL("../components/course/RemedialAudioPlayer.tsx", import.meta.url)),
  "utf8",
);
const panelSrc = readFileSync(
  fileURLToPath(new URL("../components/course/RemedialExplanation.tsx", import.meta.url)),
  "utf8",
);

test("1. the spoken text is remedialContentToScript(content) — no separate audio lesson", () => {
  assert.match(
    panelSrc,
    /const script = useMemo\(\(\) => \(content \? remedialContentToScript\(content\) : ""\)/,
  );
  assert.match(panelSrc, /<RemedialAudioPlayer key=\{audioKey\} script=\{script\}/);
  assert.match(playerSrc, /useSpeechSynthesis\(script\)/);
  // the player builds no AI call / no generation of its own
  assert.doesNotMatch(playerSrc, /callAI|askCourse|\.generate\(|createServerFn/);
});

test("2. Audio before content exists -> 'generate first', no player mounted", () => {
  assert.match(
    panelSrc,
    /!hasContent \|\| !content \|\| !script[\s\S]{0,400}Generate the personalized explanation first/,
  );
  // the player is only rendered in the audio+content branch
  assert.match(panelSrc, /activeFormat === "audio" \? \(\s*<div[\s\S]{0,120}<RemedialAudioPlayer/);
});

test("3/11. no overlapping utterances: cancel() precedes speak(); no autoplay", () => {
  // speak() happens exactly ONCE, inside play(), and play() cancels first.
  assert.equal((hookSrc.match(/speechSynthesis\.speak\(/g) ?? []).length, 1);
  assert.match(
    hookSrc,
    /const play = useCallback\(\(\) => \{[\s\S]*?window\.speechSynthesis\.cancel\(\);[\s\S]*?new window\.SpeechSynthesisUtterance[\s\S]*?window\.speechSynthesis\.speak\(/,
  );
  // restart cancels then re-plays (via a cleared-on-unmount timer)
  assert.match(hookSrc, /const restart = useCallback[\s\S]{0,400}cancel\(\)[\s\S]{0,260}play\(\)/);
  // play() is only invoked from restart() and from the returned callback — never
  // from a mount effect (no autoplay). The only useEffect that references play
  // is not present.
  const effects = hookSrc.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
  assert.ok(effects.length >= 2);
  for (const e of effects) {
    assert.doesNotMatch(e, /\.speak\(|speak\(utterance\)|\bplay\(\);/);
  }
  // the player never calls play() outside an onClick handler
  assert.doesNotMatch(playerSrc, /useEffect[\s\S]{0,160}speech\.play\(\)/);
  assert.doesNotMatch(playerSrc, /autoPlay|autoplay/i);
});

test("4/5/6. pause / resume / stop map to the browser speech API", () => {
  assert.match(hookSrc, /const pause = useCallback[\s\S]{0,200}window\.speechSynthesis\.pause\(\)/);
  assert.match(
    hookSrc,
    /const resume = useCallback[\s\S]{0,200}window\.speechSynthesis\.resume\(\)/,
  );
  assert.match(hookSrc, /const stop = useCallback[\s\S]{0,320}window\.speechSynthesis\.cancel\(\)/);
});

test("8/9. narration stops on content change AND on unmount", () => {
  // cleanup effect keyed on [text, stop] -> cancel on text change + unmount
  assert.match(hookSrc, /return \(\) => stop\(\);\s*\},\s*\[text, stop\]\)/);
  // <RemedialAudioPlayer> is rendered in exactly one place — the audio+content
  // branch — so switching to Text/Visual (or leaving the page) unmounts it.
  assert.equal((panelSrc.match(/<RemedialAudioPlayer key=/g) ?? []).length, 1);
  assert.match(panelSrc, /activeFormat === "audio" \? \([\s\S]{0,200}<RemedialAudioPlayer key=/);
});

test("10. SSR-safe support detection + honest fallback text", () => {
  assert.match(hookSrc, /typeof window !== "undefined"/);
  assert.match(hookSrc, /useState<boolean \| null>\(null\)/); // tri-state avoids a hydration flash
  assert.match(
    playerSrc,
    /Audio narration is not supported in this browser\. You can still study the text explanation\./,
  );
  assert.match(playerSrc, /Listen to your personalized explanation/);
});

test("12. R2 mutates nothing in R1 / VARK / A7 / preferences / Mastery", () => {
  // audio is now an implemented renderer; visual is still deferred
  assert.equal(REMEDIAL_MODALITY_IMPLEMENTED.audio, true);
  assert.equal(REMEDIAL_MODALITY_IMPLEMENTED.text, true);
  assert.equal(REMEDIAL_MODALITY_IMPLEMENTED.visual, false);
  for (const src of [hookSrc, playerSrc]) {
    assert.doesNotMatch(
      src,
      /\.functions|supabase|rpc\(|vark|adaptive|mastery|learning_preferences|meaningful_engagement|logInteraction/i,
    );
  }
  // the panel still just reads the recommendation — it never writes it
  assert.doesNotMatch(panelSrc, /remedial_modality\s*=|\.rpc\(|save_study_path/);
});

test("no speech position / voice / speaking state is persisted", () => {
  for (const src of [hookSrc, playerSrc, panelSrc]) {
    assert.doesNotMatch(src, /localStorage|sessionStorage|\.rpc\(["']save|persist/i);
  }
});
