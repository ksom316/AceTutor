/**
 * P2.2B — Essential Remaining Security Hardening (SEC-04 / SEC-05).
 *
 * SEC-04: lesson media_url allowlist + sandboxed iframe embedding.
 * SEC-05: public.progress is SELECT-only for clients (completion is
 *         server-owned, written only by grade_quiz()).
 *
 * There is no live Postgres in this environment, so the DB-shape checks are
 * STRUCTURAL/STATIC against the migration SQL + the synced bootstrap. The
 * allowlist itself is exercised for real through the pure TS mirror
 * `isAllowedLessonMediaUrl` (kept in sync with the SQL CHECK by hand).
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/media-progress-hardening.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isAllowedLessonMediaUrl, isLessonValueComplete } from "./lesson-shared.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const migration = read("../../supabase/migrations/20260917120000_media_and_progress_hardening.sql");
const bootstrap = read("../../supabase/bootstrap_new_project.sql");
const SQL = [migration, bootstrap] as const;

const topicRoute = read("../routes/_authenticated/topic.$topicId.tsx");
const lessonDialog = read("../components/lecturer/LessonFormDialog.tsx");
const masterySrc = read("./mastery.ts");
const dashHook = read("../hooks/use-student-dashboard.ts");
const myCourses = read("../routes/_authenticated/my-courses.tsx");
const analyticsRoute = read("../routes/_authenticated/analytics.tsx");

/* ===================== SEC-04 — lesson media allowlist ==================== */

test("Media 1. unsafe schemes are rejected (js/data/file/non-https)", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "http://example.com/video.mp4", // plain http
    "https://www.youtube.com/watch?v=abc123", // watch link, not embed
    "vbscript:msgbox(1)",
  ]) {
    assert.equal(isAllowedLessonMediaUrl(bad), false, bad);
  }
  // SQL CHECK anchors every branch to `^https://`
  for (const sql of SQL) {
    const fn = sql.slice(
      sql.indexOf("function public.is_allowed_lesson_media_url"),
      sql.indexOf("$$;", sql.indexOf("function public.is_allowed_lesson_media_url")),
    );
    assert.ok(fn.length > 0);
    assert.doesNotMatch(fn, /\^http:\/\//); // no plain-http branch
    assert.match(fn, /\^https:\/\//);
  }
});

test("Media 2. an arbitrary external iframe host is rejected", () => {
  for (const bad of [
    "https://evil.example.com/embed/abcdef",
    "https://youtube.com.evil.com/embed/abcdef",
    "https://player.vimeo.com.evil.com/video/123",
    "https://not-supabase.co/storage/v1/object/public/x/y.png",
    "https://cdn.jsdelivr.net/npm/thing/embed",
  ]) {
    assert.equal(isAllowedLessonMediaUrl(bad), false, bad);
  }
});

test("Media 3. a real YouTube (and -nocookie) embed URL is allowed", () => {
  assert.equal(isAllowedLessonMediaUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"), true);
  assert.equal(isAllowedLessonMediaUrl("https://youtube.com/embed/dQw4w9WgXcQ"), true);
  assert.equal(
    isAllowedLessonMediaUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"),
    true,
  );
  assert.equal(isAllowedLessonMediaUrl("https://player.vimeo.com/video/76979871"), true);
});

test("Media 4. Supabase-hosted media and direct media files are allowed", () => {
  assert.equal(
    isAllowedLessonMediaUrl(
      "https://pwkeqkxipuyxpezzreca.supabase.co/storage/v1/object/public/course-materials/abc/lecture.mp4",
    ),
    true,
  );
  assert.equal(
    isAllowedLessonMediaUrl(
      "https://pwkeqkxipuyxpezzreca.supabase.co/storage/v1/object/public/course-materials/abc/slides.pdf",
    ),
    true,
  );
  assert.equal(isAllowedLessonMediaUrl("https://cdn.example.com/audio/lesson-3.mp3"), true);
  assert.equal(isAllowedLessonMediaUrl("https://cdn.example.com/v/clip.webm?token=x"), true);
  // empty / null = allowed (text lessons, no media)
  assert.equal(isAllowedLessonMediaUrl(null), true);
  assert.equal(isAllowedLessonMediaUrl(""), true);
});

test("Media 5. every lesson <iframe> carries a sandbox", () => {
  const iframes = topicRoute.match(/<iframe\b[^>]*\/>/g) ?? [];
  assert.ok(iframes.length >= 2, "expected the video + slides iframes");
  for (const tag of iframes) {
    assert.match(tag, /sandbox="[^"]*allow-scripts[^"]*"/, tag);
  }
});

test("Media 6. unnecessary iframe permissions are removed", () => {
  const iframes = topicRoute.match(/<iframe\b[^>]*\/>/g) ?? [];
  const allText = iframes.join("\n");
  for (const gone of ["clipboard-write", "accelerometer", "gyroscope"]) {
    assert.ok(!allText.includes(gone), `iframe still grants ${gone}`);
  }
});

test("Media 7. no un-vetted media_url reaches an <iframe> (render is guarded)", () => {
  // both iframe branches are gated on isAllowedLessonMediaUrl(lesson.media_url)
  assert.match(
    topicRoute,
    /isAllowedLessonMediaUrl\(lesson\.media_url\)\s*\?\s*\(\s*<div[\s\S]*?<iframe/,
  );
  const guards = topicRoute.match(/isAllowedLessonMediaUrl\(lesson\.media_url\)/g) ?? [];
  assert.ok(guards.length >= 2, "video + slides iframe both guarded");
  assert.match(topicRoute, /import \{ isAllowedLessonMediaUrl \} from "@\/lib\/lesson-shared"/);
});

test("Media 8. the allowlist is enforced at a trusted layer (DB CHECK), NOT VALID", () => {
  for (const sql of SQL) {
    assert.match(
      sql,
      /create (or replace )?function public\.is_allowed_lesson_media_url\(_url text\)/,
    );
    assert.match(sql, /immutable/i);
    assert.match(sql, /set search_path = public/);
    assert.match(
      sql,
      /add constraint lessons_media_url_allowed\s+check \(public\.is_allowed_lesson_media_url\(media_url\)\) not valid/,
    );
  }
});

test("Media 9. this phase does NOT rewrite or delete historical lesson rows", () => {
  const strip = (s: string) => s.replace(/--.*$/gm, "");
  assert.doesNotMatch(strip(migration), /\b(update|delete from)\s+public\.lessons\b/i);
});

test("Media 10. the client form blocks a disallowed media URL before save", () => {
  assert.match(lessonDialog, /isAllowedLessonMediaUrl/);
  // a well-formed but disallowed URL is not a complete lesson value
  const base = {
    title: "L",
    modality: "video" as const,
    source: "url" as const,
    body: "",
    file: null,
  };
  assert.equal(isLessonValueComplete({ ...base, url: "https://evil.example.com/embed/x" }), false);
  assert.equal(
    isLessonValueComplete({ ...base, url: "https://www.youtube.com/embed/dQw4w9WgXcQ" }),
    true,
  );
});

/* ===================== SEC-05 — progress is SELECT-only ================== */

test("Progress 11. client INSERT/UPDATE/DELETE on public.progress is removed", () => {
  // migration drops the three write policies explicitly
  assert.match(migration, /drop policy if exists "progress_insert_own" on public\.progress/);
  assert.match(migration, /drop policy if exists "progress_update_own" on public\.progress/);
  assert.match(migration, /drop policy if exists "progress_delete_own" on public\.progress/);
  // both files pull back the table privilege
  for (const sql of SQL) {
    assert.match(sql, /revoke insert, update, delete on public\.progress from anon, authenticated/);
  }
  // bootstrap no longer declares the write policies at all
  assert.doesNotMatch(bootstrap, /create policy "progress_insert_own"/);
  assert.doesNotMatch(bootstrap, /create policy "progress_update_own"/);
  assert.doesNotMatch(bootstrap, /create policy "progress_delete_own"/);
});

test("Progress 12. the REVOKE sits AFTER the blanket `grant all` in bootstrap", () => {
  const grantAll = bootstrap.indexOf("grant all on all tables");
  const revoke = bootstrap.indexOf("revoke insert, update, delete on public.progress");
  assert.ok(grantAll > 0 && revoke > grantAll, "revoke must come after grant all to take effect");
});

test("Progress 13. a student cannot read another student's progress (SELECT stays own-only)", () => {
  assert.match(
    bootstrap,
    /create policy "progress_select_own" on public\.progress for select to authenticated using \(auth\.uid\(\) = user_id\)/,
  );
});

test("Progress 14. no code path performs a client write to progress (revoke breaks nothing)", () => {
  for (const src of [dashHook, myCourses, analyticsRoute]) {
    assert.match(src, /\.from\("progress"\)/);
    assert.doesNotMatch(src, /\.from\("progress"\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/);
  }
});

test("Progress 15. the legitimate completion path (grade_quiz) still marks progress", () => {
  const gq = bootstrap.slice(
    bootstrap.indexOf("function public.grade_quiz"),
    bootstrap.indexOf("$$;", bootstrap.indexOf("function public.grade_quiz")),
  );
  assert.match(gq, /security definer/i);
  assert.match(
    gq,
    /insert into public\.progress \(user_id, lesson_id, watched_seconds, completed_at, updated_at\)/,
  );
  assert.match(gq, /on conflict \(user_id, lesson_id\) do update/);
  // completion is for the caller's own row + a lesson derived from the attempt's topic
  assert.match(gq, /values \(v_user, v_lesson_id/);
  assert.doesNotMatch(gq, /_user_id\b/); // no client-supplied user id
});

test("Progress 16. completion still requires enrollment (module attempts gated upstream)", () => {
  const guard = bootstrap.slice(
    bootstrap.indexOf("function public.enforce_course_quiz_attempt"),
    bootstrap.indexOf("$$;", bootstrap.indexOf("function public.enforce_course_quiz_attempt")),
  );
  assert.match(guard, /enrol/i);
});

test("Progress 17. Mastery is unchanged and independent of progress", () => {
  assert.doesNotMatch(masterySrc, /progress/i);
  assert.match(masterySrc, /quiz_attempts|QuizAttempt|attempt/i);
});

test("Progress 18. course-completion still reads completed_at from progress", () => {
  assert.match(dashHook, /\.from\("progress"\)[\s\S]{0,120}completed_at/);
});
