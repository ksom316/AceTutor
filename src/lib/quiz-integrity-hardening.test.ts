/**
 * P2.2A — Official Quiz Integrity Hardening (SEC-01 / SEC-02 / SEC-03).
 *
 * There is no live Postgres/Supabase in this environment, so these are
 * STRUCTURAL/STATIC checks against the migration SQL text + the synced
 * bootstrap, plus checks that the client/server code no longer reaches the
 * `questions` table directly for students. They catch regressions in the
 * hardened policies/RPCs (a re-added blanket policy, a dropped guard, a
 * reintroduced client write) even though they can't execute the SQL.
 *
 * A manual live-DB verification checklist is in the P2.2A report.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/quiz-integrity-hardening.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const migration = read("../../supabase/migrations/20260916120000_quiz_integrity_hardening.sql");
const bootstrap = read("../../supabase/bootstrap_new_project.sql");
const SQL = [migration, bootstrap] as const;

const resultRoute = read("../routes/_authenticated/result.$attemptId.tsx");
const quizzesRoute = read("../routes/_authenticated/quizzes.$courseId.tsx");
const topicRoute = read("../routes/_authenticated/topic.$topicId.tsx");
const studyPathFns = read("./study-path.functions.ts");
const remedialFns = read("./remedial.functions.ts");
const practiceFns = read("./practice-quiz.functions.ts");
const settingsRoute = read("../routes/_authenticated/settings.tsx");
const quizRunner = read("../routes/_authenticated/quiz.$topicId.tsx");
const generalRunner = read("../routes/_authenticated/course-quiz.$quizId.tsx");
const quizRecovery = read("./quiz-recovery.ts");
const masterySrc = read("./mastery.ts");
const perfSrc = read("./quiz-performance.ts");

/* helper: isolate one `create or replace function public.<name>` body */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `${name} body not terminated`);
  return sql.slice(start, end + 3);
}

/* ============================ SEC-01 — answer keys ======================= */

test("1. the blanket authenticated SELECT on questions is DROPPED, not re-added", () => {
  assert.match(
    migration,
    /drop policy if exists "Authenticated can read questions" on public\.questions/,
  );
  // migration removes it; bootstrap never recreates it
  assert.doesNotMatch(bootstrap, /create policy "Authenticated can read questions"/);
  assert.doesNotMatch(
    bootstrap,
    /on public\.questions\s*\n\s*for select to authenticated using \(true\)/,
  );
});

test("2/3. lecturers keep DIRECT read of their OWN course's questions only", () => {
  for (const sql of SQL) {
    assert.match(
      sql,
      /create policy "questions_lecturer_read" on public\.questions\s*\n\s*for select to authenticated\s*\n\s*using \(/,
    );
    const start = sql.indexOf('create policy "questions_lecturer_read"');
    const body = sql.slice(start, start + 500);
    // scoped by current_lecturer_course() — a different lecturer / a student
    // (NULL course) matches nothing.
    assert.match(body, /course_id = public\.current_lecturer_course\(\)/);
    assert.doesNotMatch(body, /using \(true\)/);
  }
});

test("4. the student question RPCs still omit correct_index / explanation", () => {
  const gqq = fnBody(bootstrap, "get_quiz_questions");
  const gcqq = fnBody(bootstrap, "get_course_quiz_questions");
  for (const b of [gqq, gcqq]) {
    assert.match(b, /returns table \(id uuid, prompt text, choices jsonb, difficulty int\)/);
    assert.doesNotMatch(b, /correct_index/);
    assert.doesNotMatch(b, /explanation/);
  }
});

test("5/6/7. get_attempt_review: own + FINISHED only, ids server-derived", () => {
  for (const sql of SQL) {
    const b = fnBody(sql, "get_attempt_review");
    assert.match(b, /security definer set search_path = public/);
    // auth required
    assert.match(b, /if auth\.uid\(\) is null then\s*\n\s*raise exception 'forbidden'/);
    // ownership
    assert.match(
      b,
      /v_user is null or v_user <> auth\.uid\(\)[\s\S]{0,60}raise exception 'forbidden'/,
    );
    // finished-only
    assert.match(b, /if v_finished is null then\s*\n\s*raise exception 'ATTEMPT_NOT_FINISHED'/);
    // topic/course derived from the attempt row, NOT an argument
    assert.match(b, /from public\.quiz_attempts\s*\n\s*where id = _attempt_id/);
    assert.match(b, /where \(v_topic is not null and q\.topic_id = v_topic\)/);
    // returns the review columns the result page needs, LEFT JOINed to own answers
    assert.match(
      b,
      /left join public\.attempt_answers aa\s*\n\s*on aa\.question_id = q\.id and aa\.attempt_id = _attempt_id/,
    );
  }
  // anon cannot execute; authenticated can
  assert.match(
    bootstrap,
    /revoke execute on function public\.get_attempt_review\(uuid\)\s+from public, anon/,
  );
  assert.match(
    bootstrap,
    /grant\s+execute on function public\.get_attempt_review\(uuid\)\s+to authenticated/,
  );
});

test("the result page uses get_attempt_review and no longer selects questions directly", () => {
  assert.match(resultRoute, /supabase\.rpc\("get_attempt_review"/);
  assert.doesNotMatch(resultRoute, /\.from\("questions"\)/);
  // it also no longer relies on the questions(...) embedded join on attempt_answers
  assert.doesNotMatch(resultRoute, /attempt_answers[\s\S]{0,120}questions\(prompt/);
});

test("student 'has a quiz?' checks go through topics_with_questions (ids only)", () => {
  for (const sql of SQL) {
    const b = fnBody(sql, "topics_with_questions");
    assert.match(b, /returns setof uuid/);
    assert.match(b, /select distinct q\.topic_id/);
    assert.doesNotMatch(b, /prompt|choices|correct_index|explanation/);
  }
  assert.match(quizzesRoute, /supabase\.rpc\("topics_with_questions"/);
  assert.doesNotMatch(quizzesRoute, /\.from\("questions"\)/);
  assert.match(topicRoute, /supabase\.rpc\("topics_with_questions"/);
  assert.doesNotMatch(
    topicRoute,
    /\.from\("questions"\)\s*\n\s*\.select\("id"\)\s*\n\s*\.eq\("topic_id"/,
  );
});

test("server functions no longer read the questions table with the student's RLS client", () => {
  // study path needs the answer key → the SEC-01 get_attempt_review RPC
  // (SECURITY DEFINER, own + FINISHED attempts only) — the same student-safe
  // path the result page uses. No service-role client, no direct questions read
  // (so it needs no SUPABASE_SERVICE_ROLE_KEY).
  assert.match(studyPathFns, /supabase\.rpc\("get_attempt_review"/);
  assert.doesNotMatch(studyPathFns, /supabaseAdmin|client\.server/);
  assert.doesNotMatch(studyPathFns, /\.from\("questions"\)/);
  // remedial: prompts-only RPC via the RLS client — still no service-role client
  assert.match(remedialFns, /supabase\.rpc\("get_question_prompts"/);
  assert.doesNotMatch(remedialFns, /supabaseAdmin|client\.server/);
  assert.doesNotMatch(remedialFns, /\.from\("questions"\)/);
  // practice-quiz: official-exists count → service client
  assert.match(
    practiceFns,
    /supabaseAdmin\s*\n\s*\.from\("questions"\)\s*\n\s*\.select\("id", \{ count: "exact", head: true \}\)/,
  );
  for (const sql of SQL) {
    const b = fnBody(sql, "get_question_prompts");
    assert.match(b, /returns table \(id uuid, prompt text\)/);
    assert.doesNotMatch(b, /choices|correct_index|explanation/);
  }
});

/* ======================= SEC-02 — forged attempts ====================== */

test("8/9. a fresh module / general attempt can still be started (insert shape)", () => {
  assert.match(
    quizRunner,
    /\.from\("quiz_attempts"\)\s*\n\s*\.insert\(\{ user_id: user\.id, topic_id: topicId \}\)/,
  );
  assert.match(
    generalRunner,
    /\.from\("quiz_attempts"\)\s*\n\s*\.insert\(\{ user_id: user\.id, course_quiz_id: quizId \}\)/,
  );
  // no grading fields in the start payload
  assert.doesNotMatch(
    quizRunner,
    /\.insert\(\{[^}]*(score|total|finished_at|answered_count|timed_out)/,
  );
  assert.doesNotMatch(
    generalRunner,
    /\.insert\(\{[^}]*(score|total|finished_at|answered_count|timed_out)/,
  );
});

test("10/11. the INSERT policy pins the canonical fresh, un-graded state", () => {
  for (const sql of SQL) {
    assert.match(
      sql,
      /create policy "attempts_insert_own" on public\.quiz_attempts[\s\S]{0,60}for insert to authenticated[\s\S]{0,40}with check \([\s\S]{0,200}auth\.uid\(\) = user_id\s+and finished_at is null\s+and score = 0\s+and total = 0\s+and answered_count is null\s+and timed_out = false\s*\)/,
    );
  }
});

test("12/13. the client UPDATE policy on quiz_attempts is removed", () => {
  assert.match(migration, /drop policy if exists "attempts_update_own" on public\.quiz_attempts/);
  assert.doesNotMatch(bootstrap, /create policy "attempts_update_own"/);
  // no browser code updates quiz_attempts directly
  for (const src of [quizRunner, generalRunner, resultRoute, quizRecovery]) {
    assert.doesNotMatch(src, /\.from\("quiz_attempts"\)\s*\n?\s*\.update\(/);
  }
});

/* ============ SEC-02a — no per-row client DELETE of quiz_attempts ======= */

const settingsFull = read("../routes/_authenticated/settings.tsx");
const CLIENT_SRC = [
  quizRunner,
  generalRunner,
  resultRoute,
  quizRecovery,
  settingsFull,
  read("../routes/_authenticated/analytics.tsx"),
  read("../routes/_authenticated/my-courses.tsx"),
  read("../routes/_authenticated/study-path.$courseId.tsx"),
  read("../routes/_authenticated/performance.$courseId.tsx"),
  read("../routes/courses.$slug.tsx"),
  read("../hooks/use-student-dashboard.ts"),
];

test("SEC-02a #1. no client DELETE authority on quiz_attempts (policy dropped + privilege revoked)", () => {
  assert.match(migration, /drop policy if exists "attempts_delete_own" on public\.quiz_attempts/);
  assert.match(
    migration,
    /revoke update, delete on public\.quiz_attempts from anon, authenticated/,
  );
  // bootstrap: policy never created; write privilege revoked AFTER the blanket grant
  assert.doesNotMatch(bootstrap, /create policy "attempts_delete_own"/);
  const grantAll = bootstrap.indexOf("grant all on all tables");
  const revokeIdx = bootstrap.search(
    /revoke update, delete\s+on public\.quiz_attempts\s+from anon, authenticated/,
  );
  assert.ok(grantAll >= 0 && revokeIdx > grantAll, "revoke must follow the blanket grant");
});

test("SEC-02a #2/3. no browser .from('quiz_attempts').delete() remains anywhere", () => {
  for (const src of CLIENT_SRC) {
    assert.doesNotMatch(src, /\.from\("quiz_attempts"\)\s*\n?\s*\.delete\(/);
  }
  // and nothing selectively removes one attempt by id
  assert.doesNotMatch(
    settingsFull,
    /\.from\("quiz_attempts"\)[\s\S]{0,60}\.delete\(\)[\s\S]{0,40}\.eq\("id"/,
  );
});

test("SEC-02a #4/5. the Settings reset has a trusted RPC path, derived from auth.uid()", () => {
  assert.match(settingsFull, /supabase\.rpc\("reset_my_learning_data"\)/);
  for (const sql of SQL) {
    const b = fnBody(sql, "reset_my_learning_data");
    assert.match(b, /returns void/);
    assert.match(b, /security definer set search_path = public/);
    assert.match(b, /v_uid uuid := auth\.uid\(\)/);
    assert.match(b, /if v_uid is null then\s*\n\s*raise exception 'AUTH_REQUIRED'/);
  }
  assert.match(
    bootstrap,
    /revoke execute on function public\.reset_my_learning_data\(\)\s+from public, anon/,
  );
  assert.match(
    bootstrap,
    /grant\s+execute on function public\.reset_my_learning_data\(\)\s+to authenticated/,
  );
});

test("SEC-02a #6/7. the reset RPC takes NO id / user_id argument and only touches auth.uid()", () => {
  for (const sql of SQL) {
    // signature has no parameters at all
    assert.match(
      sql,
      /create or replace function public\.reset_my_learning_data\(\)\s*\n\s*returns void/,
    );
    const b = fnBody(sql, "reset_my_learning_data");
    // the user is derived, never passed
    assert.match(b, /v_uid uuid := auth\.uid\(\)/);
    assert.doesNotMatch(
      b,
      /_user_id\b|_attempt_id\b|::uuid|declare[\s\S]{0,120}\b_\w+\s+(uuid|text)/,
    );
    // EVERY delete is `where user_id = v_uid` — no id target, no other predicate
    const deletes = b.match(/delete from public\.\w+\s+where[^\n;]*/g) ?? [];
    assert.ok(deletes.length >= 7, `expected >=7 scoped deletes, got ${deletes.length}`);
    for (const d of deletes) {
      assert.match(d, /where user_id = v_uid$/, `unscoped/foreign delete: ${d}`);
    }
  }
});

test("SEC-02a #8. the reset RPC clears the SAME set the old client flow cleared", () => {
  const b = fnBody(bootstrap, "reset_my_learning_data");
  for (const tbl of [
    "quiz_attempts",
    "progress",
    "study_sessions",
    "enrollments",
    "learning_preferences",
    "vark_profiles",
    "learning_interactions",
  ]) {
    assert.match(b, new RegExp(`delete from public\\.${tbl}\\s+where user_id = v_uid`));
  }
  // it does NOT touch the user profile / auth / AI chat history (unchanged scope)
  assert.doesNotMatch(
    b,
    /public\.profiles\b|auth\.users|ai_conversations|ai_messages|public\.notifications/,
  );
});

test("14. direct attempt_answers writes are revoked; SELECT (finished-only) kept", () => {
  assert.match(migration, /drop policy if exists "answers_insert_own" on public\.attempt_answers/);
  assert.match(migration, /drop policy if exists "answers_delete_own" on public\.attempt_answers/);
  for (const sql of SQL) {
    assert.match(
      sql,
      /revoke insert, update, delete on public\.attempt_answers from anon, authenticated/,
    );
    assert.doesNotMatch(sql, /create policy "answers_insert_own"/);
    assert.doesNotMatch(sql, /create policy "answers_delete_own"/);
  }
  // the finished-attempt SELECT gate survives (in the bootstrap; the migration
  // only removes the two write policies, it doesn't recreate the SELECT one)
  assert.match(
    bootstrap,
    /create policy "answers_select_own" on public\.attempt_answers for select to authenticated[\s\S]{0,80}using \(exists \([\s\S]{0,240}a\.finished_at is not null/,
  );
  // account-reset no longer deletes attempt_answers directly (cascade handles it)
  assert.doesNotMatch(settingsRoute, /\.from\("attempt_answers"\)\s*\n?\s*\.delete\(/);
});

test("15/16. save_quiz_answer / grade_quiz are SECURITY DEFINER and unchanged in contract", () => {
  for (const name of ["save_quiz_answer", "grade_quiz"]) {
    const b = fnBody(bootstrap, name);
    assert.match(b, /security definer set search_path = public/);
    assert.match(b, /v_user <> auth\.uid\(\)|v_user is null or v_user <> auth\.uid\(\)/);
  }
  // grade_quiz still computes score server-side + writes finished_at
  const g = fnBody(bootstrap, "grade_quiz");
  assert.match(g, /is_correct\)\s*\n?\s*into v_answered, v_score/);
  assert.match(g, /finished_at = now\(\)/);
  // the migration does not touch grade_quiz / save_quiz_answer at all
  assert.doesNotMatch(migration, /function public\.grade_quiz|function public\.save_quiz_answer/);
});

test("17. Quiz Recovery still saves via the save_quiz_answer RPC", () => {
  assert.match(quizRecovery, /supabase\.rpc\("save_quiz_answer"/);
  assert.match(quizRecovery, /supabase\.rpc\("get_attempt_answers"/);
  assert.doesNotMatch(quizRecovery, /\.from\("attempt_answers"\)\s*\n?\s*\.(insert|update|upsert)/);
});

/* ========================= SEC-03 — enrollment ========================= */

test("18/19/20. a module attempt requires enrollment (or being the course lecturer)", () => {
  for (const sql of SQL) {
    const b = fnBody(sql, "enforce_course_quiz_attempt");
    // module branch is now handled, not skipped
    assert.match(b, /if new\.topic_id is not null then/);
    assert.match(
      b,
      /select t\.course_id into v_course from public\.topics t where t\.id = new\.topic_id/,
    );
    assert.match(
      b,
      /current_lecturer_course\(\) is distinct from v_course\s*\n\s*and not exists \(\s*\n\s*select 1 from public\.enrollments e\s*\n\s*where e\.course_id = v_course and e\.user_id = auth\.uid\(\)\s*\n\s*\) then\s*\n\s*raise exception 'You must be enrolled in this course to take this quiz\.'/,
    );
    // the module branch returns BEFORE the general-quiz block
    const moduleIdx = b.indexOf("if new.topic_id is not null then");
    const generalIdx = b.indexOf("if new.course_quiz_id is null then");
    assert.ok(moduleIdx >= 0 && generalIdx > moduleIdx);
  }
});

test("21. the General Course Quiz enrollment / deadline / cap checks are preserved", () => {
  for (const sql of SQL) {
    const b = fnBody(sql, "enforce_course_quiz_attempt");
    assert.match(b, /You must be enrolled in this course to take this assessment\./);
    assert.match(b, /This assessment is not available yet\./);
    assert.match(b, /the deadline has passed\./);
    assert.match(b, /pg_advisory_xact_lock\(\s*\n\s*hashtext\(new\.course_quiz_id::text\)/);
    assert.match(b, /You have used all % attempt\(s\) allowed/);
  }
});

test("SEC-03 analytics: module performance is filtered to enrolled students", () => {
  for (const sql of SQL) {
    const b = fnBody(sql, "get_course_quiz_performance");
    // module branch gets the enrollment EXISTS filter…
    assert.match(
      b,
      /join public\.quiz_attempts a on a\.topic_id = t\.id\s*\n\s*join public\.profiles p on p\.id = a\.user_id\s*\n\s*(--[^\n]*\n\s*)*where exists \(\s*\n\s*select 1 from public\.enrollments e\s*\n\s*where e\.course_id = lc\.course_id and e\.user_id = a\.user_id/,
    );
    // …and the metric formula (round(score/total*100)) is unchanged
    assert.match(b, /round\(a\.score::numeric \/ a\.total \* 100\)::integer/);
  }
});

/* ==================== existing invariants unchanged ==================== */

test("22/23/24/25. one-active-official-quiz trigger logic is untouched", () => {
  const b = fnBody(bootstrap, "enforce_one_active_official_quiz");
  assert.match(b, /pg_advisory_xact_lock\(\s*\n\s*hashtext\('acetutor:official-quiz-start'\)/);
  assert.match(
    b,
    /a\.finished_at is null\s*\n\s*and a\.expires_at is not null\s*\n\s*and now\(\) < a\.expires_at/,
  );
  assert.match(b, /ONE_ACTIVE_OFFICIAL_QUIZ:/);
  // the migration doesn't touch it
  assert.doesNotMatch(migration, /enforce_one_active_official_quiz/);
});

test("26. practice Quiz Me still never writes quiz_attempts / attempt_answers", () => {
  assert.doesNotMatch(
    practiceFns,
    /\.from\("quiz_attempts"\)\s*\n?\s*\.(insert|update|upsert|delete)/,
  );
  assert.doesNotMatch(practiceFns, /\.from\("attempt_answers"\)/);
  // migration creates/alters no practice-quiz object
  assert.doesNotMatch(
    migration,
    /(create|alter|drop)\s+(or replace\s+)?(function|table|policy)[^\n;]*practice/i,
  );
});

test("27/28. Mastery calculation + General-Course-Quiz exclusion are unchanged", () => {
  // the migration creates/alters no mastery object and no student_mastery table
  assert.doesNotMatch(
    migration,
    /(create|alter|drop)\s+(or replace\s+)?(function|table|policy|view)[^\n;]*(mastery|student_mastery)/i,
  );
  assert.match(masterySrc, /most recent completed official[\s\S]{0,16}module.?quiz/i);
  // module mastery is topic_id-based; the general-quiz RPC feed stays separate
  assert.match(
    fnBody(bootstrap, "get_course_student_mastery"),
    /join public\.quiz_attempts a on a\.topic_id = t\.id and a\.finished_at is not null/,
  );
  assert.match(perfSrc, /isSufficientAttempt/);
});

test("29. R4 official-outcome logging still happens inside grade_quiz()", () => {
  const g = fnBody(bootstrap, "grade_quiz");
  assert.match(
    g,
    /insert into public\.learning_interactions[\s\S]{0,200}'official_quiz_completed'/,
  );
  assert.match(g, /on conflict \(quiz_attempt_id\) where event_type = 'official_quiz_completed'/);
});

/* ====================== migration / bootstrap agree ==================== */

test("migration and bootstrap agree on every hardened object", () => {
  for (const token of [
    'create policy "questions_lecturer_read"',
    'create policy "attempts_insert_own"',
    "revoke insert, update, delete on public.attempt_answers",
    "revoke update, delete", // quiz_attempts write privilege (wording differs; presence only)
    "create or replace function public.get_attempt_review",
    "create or replace function public.topics_with_questions",
    "create or replace function public.get_question_prompts",
    "create or replace function public.reset_my_learning_data",
    "create or replace function public.enforce_course_quiz_attempt",
    "create or replace function public.get_course_quiz_performance",
  ]) {
    assert.ok(migration.includes(token), `migration missing: ${token}`);
    assert.ok(bootstrap.includes(token), `bootstrap missing: ${token}`);
  }
  // removed things stay removed in bootstrap
  for (const gone of [
    '"Authenticated can read questions"',
    '"attempts_update_own"',
    '"attempts_delete_own"',
    '"answers_insert_own"',
    '"answers_delete_own"',
  ]) {
    assert.doesNotMatch(
      bootstrap,
      new RegExp(`create policy ${gone}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("this phase rewrites NO historical data (outside the user-invoked reset RPC)", () => {
  // strip SQL line comments ("cascade delete from …") and the
  // reset_my_learning_data() body (a user-invoked feature, own-data-only —
  // not a bulk cleanup of existing quiz data).
  const resetStart = migration.indexOf("create or replace function public.reset_my_learning_data");
  const resetEnd = migration.indexOf("$$;", resetStart) + 3;
  const stmts = (migration.slice(0, resetStart) + migration.slice(resetEnd)).replace(/--.*$/gm, "");
  assert.doesNotMatch(
    stmts,
    /delete\s+from\s+public\.(quiz_attempts|attempt_answers|questions|progress)|update\s+public\.(quiz_attempts|attempt_answers|questions|progress)[\s\S]{0,60}\bset\b|truncate/i,
  );
});
