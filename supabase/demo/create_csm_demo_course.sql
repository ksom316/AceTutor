-- ============================================================================
--  CSM Demo Course — Testing Only   ·   CREATE / RE-SEED
-- ============================================================================
--  Purpose: a small, isolated, disposable course for rehearsing the COMPLETE
--  AceTutor student experience before the final defense — enroll, study a
--  lesson, use the AI Tutor / Guide Me, use Quiz Me, take an official module
--  quiz, see Mastery, deliberately fail questions to trigger a Study Path,
--  view remedial content, retake the quiz, and check the student dashboard +
--  lecturer analytics.
--
--  This script:
--    * creates ONE course, THREE modules, TWO text lessons per module,
--      ~5 official questions per module, and ONE General Course Quiz (8 Qs);
--    * uses FIXED UUIDs for every row, so re-running it UPDATES content in
--      place and never duplicates anything and never deletes tester-generated
--      data (quiz attempts, answers, progress, study paths stay intact);
--    * touches NO existing real course and changes NO schema / policy / logic;
--    * adds NO media URLs (requirement 10) — every lesson is text, because the
--      project has no bundled media asset that can be reused safely.
--
--  HOW TO RUN: paste into the Supabase SQL Editor and run once (top to bottom).
--  Safe to run again at any time. See delete_csm_demo_course.sql to remove it.
--
--  FIXED DEMO COURSE UUID:  de300000-0000-4000-a000-000000000000
--  (all demo rows share the de300000-0000-4000-a000-... prefix)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Course
-- ----------------------------------------------------------------------------
insert into public.courses (id, slug, title, summary, cover_url, order_index)
values (
  'de300000-0000-4000-a000-000000000000',
  'csm-demo-testing-only',
  'CSM Demo Course — Testing Only',
  '[DEMO / TEST CONTENT — NOT A REAL ACADEMIC COURSE] '
    || 'A disposable sandbox for rehearsing the full AceTutor student journey: '
    || 'enroll, study a lesson, use the AI Tutor and Guide Me, use Quiz Me, take '
    || 'an official module quiz, see your Mastery score, deliberately answer '
    || 'questions wrong to trigger a Study Path, review the remedial content, '
    || 'retake the quiz, then check the dashboard and lecturer analytics. '
    || 'Delete it anytime with supabase/demo/delete_csm_demo_course.sql.',
  null,
  9000
)
on conflict (id) do update set
  slug        = excluded.slug,
  title       = excluded.title,
  summary     = excluded.summary,
  cover_url   = excluded.cover_url,
  order_index = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 2. Modules (topics)
-- ----------------------------------------------------------------------------
insert into public.topics (id, course_id, slug, title, summary, order_index, quiz_duration_minutes)
values
  ('de300000-0000-4000-a000-000000000101',
   'de300000-0000-4000-a000-000000000000',
   'getting-started-with-acetutor',
   'Module 1 — Getting Started with AceTutor',
   'How AceTutor is organised and how the study tools fit together. Start here.',
   0, 15),
  ('de300000-0000-4000-a000-000000000102',
   'de300000-0000-4000-a000-000000000000',
   'study-skills-fundamentals',
   'Module 2 — Study Skills Fundamentals',
   'Spaced practice, active recall, and what to do after a wrong answer.',
   1, 15),
  ('de300000-0000-4000-a000-000000000103',
   'de300000-0000-4000-a000-000000000000',
   'understanding-your-progress',
   'Module 3 — Understanding Your Progress',
   'Mastery scores, Study Paths, remedial content, dashboards and analytics.',
   2, 15)
on conflict (id) do update set
  course_id             = excluded.course_id,
  slug                  = excluded.slug,
  title                 = excluded.title,
  summary               = excluded.summary,
  order_index           = excluded.order_index,
  quiz_duration_minutes = excluded.quiz_duration_minutes;

-- ----------------------------------------------------------------------------
-- 3. Lessons (all text — no media URLs, see header)
-- ----------------------------------------------------------------------------

-- Module 1
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000201',
   'de300000-0000-4000-a000-000000000101', 'text',
   'How AceTutor is organised',
   $md$## The big picture

AceTutor content is arranged in three levels:

1. **Course** — the whole subject (this one is *CSM Demo Course — Testing Only*).
2. **Module** — a focused unit inside a course. Each module has its own **official module quiz**.
3. **Lesson** — a single piece of learning material inside a module. A lesson can be text, video, audio, or slides.

There is also **one General Course Quiz** per course. It draws on the whole course rather than a single module.

## What you do first

Before you can take any quiz you must **enroll** in the course from the course page. Enrolling is what puts the course on your dashboard and lets the system track your progress and Mastery.

## How progress is recorded

- Opening and studying a lesson records **lesson progress**.
- Finishing a module quiz records an **attempt** — your score, how many questions you answered, and when you finished.
- Your most recent completed module quiz becomes your **Mastery score** for that module.

Study this lesson, then try the **AI Tutor** and **Guide Me** on anything above that is unclear.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000202',
   'de300000-0000-4000-a000-000000000101', 'text',
   'The study tools: AI Tutor, Guide Me and Quiz Me',
   $md$## AI Tutor

A course-aware chat. Ask a question in your own words and it answers using the
material from this course. Use it when you are stuck on a specific point.

## Guide Me

A structured, step-by-step walkthrough of a concept. Use it when you want to be
*led through* an idea rather than asking one-off questions.

## Quiz Me

Generates **practice** questions from a lesson. Practice questions are for your
own benefit only — **they do not affect your grade or your Mastery score**. Use
Quiz Me to check yourself before taking the real module quiz.

## The official module quiz

This is the graded one. It is timed, it records an attempt, and it feeds your
Mastery score. You can retake it — the newest completed attempt is the one that
counts.
$md$,
   null, null, 1)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- Module 2
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000203',
   'de300000-0000-4000-a000-000000000102', 'text',
   'Spaced practice and active recall',
   $md$## Spaced practice

Studying the same material in **several shorter sessions spread over time** beats
one long session. Each time you come back and successfully recall something, the
memory gets more durable.

## Active recall

**Retrieving** information from memory — without looking at the notes — is far
more effective than re-reading. Every act of recall is itself a learning event.

Practical version:
- Read a short section.
- Close it. Say or write what it said from memory.
- Only then check what you missed.

## The forgetting curve

Without review, newly learned material decays quickly over days. Spaced reviews
flatten that curve. This is why AceTutor keeps quizzes and Study Paths available
for retakes rather than one-and-done.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000204',
   'de300000-0000-4000-a000-000000000102', 'text',
   'Why re-reading is not enough',
   $md$## The illusion of knowing

Re-reading and highlighting make material feel *familiar*, and familiarity feels
like understanding — but it does not predict whether you can produce the answer
in a quiz. This is called the **illusion of knowing**.

## A better response to a wrong answer

When you get a quiz question wrong:

1. Read the **explanation** for that question.
2. Go back to the lesson section it came from.
3. **Re-test** yourself on it a little later — not immediately.

That loop is exactly what a **Study Path** automates for you after a quiz.
$md$,
   null, null, 1)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- Module 3
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000205',
   'de300000-0000-4000-a000-000000000103', 'text',
   'Mastery, dashboards and lecturer analytics',
   $md$## Your Mastery score

Your **Mastery** for a module is the percentage score of your **most recent
completed official module quiz** for that module. It is not an average. Retaking
a quiz after studying is the way to move it.

## Your dashboard

The student dashboard shows your enrolled courses, your progress through each
module, your Mastery scores, and your recent quiz activity. Practice ("Quiz Me")
questions are deliberately **not** shown there — only official attempts.

## What lecturers see

Lecturers see **aggregated** class performance for their own course: average
scores per module, participation, and trends. They do **not** see your private
AI Tutor conversations or your individual practice sessions.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000206',
   'de300000-0000-4000-a000-000000000103', 'text',
   'Study Paths and remedial content',
   $md$## When a Study Path appears

After you finish a module quiz **and got at least one answered question wrong**,
AceTutor can generate a **Study Path**: a short, focused plan built only from the
concepts you actually missed. A blank submission (nothing answered) does not
create one — there is no evidence of weakness to work from.

## Remedial content

Inside a Study Path, **remedial content** is a fresh re-explanation of each weak
concept, with a worked example and a couple of practice questions. It may be
shown as text, audio, or a visual explanation depending on what has worked for
you before.

## Closing the loop

Work through the Study Path, then **retake the module quiz**. The new completed
attempt updates your Mastery score and your dashboard.
$md$,
   null, null, 1)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 4. Official module-quiz questions (~5 per module)
--    Fixed UUIDs + upsert so re-running only refreshes wording and never
--    cascade-deletes a tester's attempt_answers.
-- ----------------------------------------------------------------------------

-- Module 1
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000301',
   'de300000-0000-4000-a000-000000000101', null,
   'In AceTutor, what is the correct order from largest to smallest?',
   '["Course, then module, then lesson","Lesson, then module, then course","Module, then course, then lesson","Quiz, then lesson, then course"]'::jsonb,
   0,
   'A course contains modules; each module contains lessons (and one official module quiz).',
   1, 0),
  ('de300000-0000-4000-a000-000000000302',
   'de300000-0000-4000-a000-000000000101', null,
   'What must you do before you can take a module quiz?',
   '["Finish every other course first","Ask a lecturer to unlock it","Enroll in the course","Pass the General Course Quiz"]'::jsonb,
   2,
   'Enrolling puts the course on your dashboard and lets AceTutor track your attempts and Mastery.',
   1, 1),
  ('de300000-0000-4000-a000-000000000303',
   'de300000-0000-4000-a000-000000000101', null,
   'Which tool gives you a structured, step-by-step walkthrough of a concept?',
   '["Quiz Me","Guide Me","The download button","The notifications bell"]'::jsonb,
   1,
   'Guide Me leads you through an idea in steps. The AI Tutor answers one-off questions; Quiz Me makes practice questions.',
   2, 2),
  ('de300000-0000-4000-a000-000000000304',
   'de300000-0000-4000-a000-000000000101', null,
   'Do practice questions from "Quiz Me" affect your grade or Mastery score?',
   '["Yes — they count the same as the official quiz","Only if you get them wrong","Only the first ten each day","No — practice questions never affect your grade or Mastery"]'::jsonb,
   3,
   'Quiz Me is for self-checking only. Only official module-quiz attempts feed Mastery.',
   2, 3),
  ('de300000-0000-4000-a000-000000000305',
   'de300000-0000-4000-a000-000000000101', null,
   'What does the General Course Quiz cover?',
   '["The whole course","Only the first module","Only lessons you have not opened","Nothing — it is decorative"]'::jsonb,
   0,
   'The General Course Quiz draws on the entire course rather than a single module.',
   2, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- Module 2
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000311',
   'de300000-0000-4000-a000-000000000102', null,
   'What is "spaced practice"?',
   '["Cramming everything the night before","Studying in shorter sessions spread out over time","Studying only in a quiet room","Reading each page exactly twice"]'::jsonb,
   1,
   'Spacing your study across time produces more durable memory than one long block.',
   1, 0),
  ('de300000-0000-4000-a000-000000000312',
   'de300000-0000-4000-a000-000000000102', null,
   'What is "active recall"?',
   '["Re-reading your notes until they feel familiar","Highlighting the most important sentences","Copying the lesson out word for word","Retrieving information from memory without looking at your notes"]'::jsonb,
   3,
   'Retrieval practice — producing the answer from memory — is itself a powerful learning event.',
   2, 1),
  ('de300000-0000-4000-a000-000000000313',
   'de300000-0000-4000-a000-000000000102', null,
   'Which activity best predicts whether you will remember something in a quiz?',
   '["Testing yourself on it","Highlighting it","Re-reading it once more","Recognising it looks familiar"]'::jsonb,
   0,
   'Familiarity feels like knowing but does not predict recall. Self-testing does.',
   2, 2),
  ('de300000-0000-4000-a000-000000000314',
   'de300000-0000-4000-a000-000000000102', null,
   'What does the "forgetting curve" describe?',
   '["Grades always fall in the second semester","Quizzes get harder each attempt","Memory decays over time without review","Motivation drops after lunch"]'::jsonb,
   2,
   'Newly learned material decays over days unless it is reviewed; spaced review flattens the curve.',
   2, 3),
  ('de300000-0000-4000-a000-000000000315',
   'de300000-0000-4000-a000-000000000102', null,
   'You get a quiz question wrong. What is the best next step?',
   '["Ignore it and move on","Read the explanation, revisit that lesson section, and re-test later","Retake the whole quiz immediately five times","Delete the attempt so it does not count"]'::jsonb,
   1,
   'Review the explanation, go back to the source section, then re-test after a short gap — the loop a Study Path automates.',
   1, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- Module 3
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000321',
   'de300000-0000-4000-a000-000000000103', null,
   'Your Mastery score for a module is based on what?',
   '["The average of every attempt you have ever made","How many lessons you opened","Your most recent completed official module quiz","Your practice (Quiz Me) results"]'::jsonb,
   2,
   'Mastery is the score of your latest completed official module quiz — not an average, not practice.',
   2, 0),
  ('de300000-0000-4000-a000-000000000322',
   'de300000-0000-4000-a000-000000000103', null,
   'When can AceTutor generate a Study Path for you?',
   '["After a module quiz where you answered at least one question wrong","Only if you score 100%","Before you have taken any quiz","Only once per course, ever"]'::jsonb,
   0,
   'A Study Path is built from the questions you actually missed. A blank submission creates none.',
   2, 1),
  ('de300000-0000-4000-a000-000000000323',
   'de300000-0000-4000-a000-000000000103', null,
   'What is "remedial content" inside a Study Path?',
   '["A penalty applied to your score","A message sent to your lecturer","A lock on the module until next week","A fresh re-explanation of the concepts you missed, with examples and practice"]'::jsonb,
   3,
   'Remedial content re-teaches only your weak concepts, and may be shown as text, audio, or a visual explanation.',
   2, 2),
  ('de300000-0000-4000-a000-000000000324',
   'de300000-0000-4000-a000-000000000103', null,
   'What is the right way to raise a Mastery score you are unhappy with?',
   '["Wait for it to rise on its own","Study the weak areas, then retake the module quiz","Open more lessons without studying them","Take the General Course Quiz instead"]'::jsonb,
   1,
   'The newest completed module-quiz attempt replaces the old Mastery score, so study then retake.',
   1, 3),
  ('de300000-0000-4000-a000-000000000325',
   'de300000-0000-4000-a000-000000000103', null,
   'What can a lecturer see about you?',
   '["Every message you send the AI Tutor","Your password","Aggregated class performance for their course — not your private AI chats","Your practice-question sessions in detail"]'::jsonb,
   2,
   'Lecturer analytics are aggregated per module. Private conversations and practice sessions are not exposed.',
   3, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 5. General Course Quiz  (+ 8 questions spanning all three modules)
--    available_from is a fixed past instant so it is always takeable;
--    no deadline, unlimited attempts (testers need to retake).
-- ----------------------------------------------------------------------------
insert into public.course_quizzes
  (id, course_id, title, description, available_from, deadline, max_attempts, duration_minutes)
values (
  'de300000-0000-4000-a000-0000000000c1',
  'de300000-0000-4000-a000-000000000000',
  'CSM Demo — General Course Quiz (Testing Only)',
  'Covers all three demo modules. Unlimited attempts, no deadline. Testing content only.',
  timestamptz '2026-01-01 00:00:00+00',
  null,
  null,
  15
)
on conflict (id) do update set
  course_id        = excluded.course_id,
  title            = excluded.title,
  description      = excluded.description,
  available_from   = excluded.available_from,
  deadline         = excluded.deadline,
  max_attempts     = excluded.max_attempts,
  duration_minutes = excluded.duration_minutes;

insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000401', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Which sequence is correct in AceTutor?',
   '["Course > Module > Lesson","Lesson > Course > Module","Module > Lesson > Course","Quiz > Module > Course"]'::jsonb,
   0, 'A course holds modules; a module holds lessons.', 1, 0),
  ('de300000-0000-4000-a000-000000000402', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Enrolling in a course lets AceTutor do what?',
   '["Charge your account","Email your class","Track your attempts and Mastery","Hide the course from you"]'::jsonb,
   2, 'Enrollment is what connects your progress and Mastery to the course.', 1, 1),
  ('de300000-0000-4000-a000-000000000403', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Quiz Me practice questions affect your Mastery score.',
   '["True","False","Only on weekends","Only for the first module"]'::jsonb,
   1, 'Only official module-quiz attempts feed Mastery. Practice never does.', 2, 2),
  ('de300000-0000-4000-a000-000000000404', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Active recall means...',
   '["Re-reading until it feels familiar","Highlighting key lines","Listening to the lesson twice","Retrieving an answer from memory without looking"]'::jsonb,
   3, 'Producing the answer from memory is the effective study move.', 2, 3),
  ('de300000-0000-4000-a000-000000000405', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Spaced practice is better than cramming because...',
   '["It takes less total effort","It looks better to lecturers","Repeated recall over time makes memory more durable","Cramming is against the rules"]'::jsonb,
   2, 'Spacing and repeated successful recall build lasting memory.', 2, 4),
  ('de300000-0000-4000-a000-000000000406', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Your module Mastery score reflects...',
   '["Your most recent completed module quiz","The average of all your attempts","Your fastest attempt","How many lessons you opened"]'::jsonb,
   0, 'Mastery = latest completed official module-quiz score, not an average.', 2, 5),
  ('de300000-0000-4000-a000-000000000407', null,
   'de300000-0000-4000-a000-0000000000c1',
   'A Study Path is generated after a quiz when...',
   '["You scored full marks","You did not answer anything","You opened every lesson","You answered at least one question incorrectly"]'::jsonb,
   3, 'Study Paths are built only from questions you actually got wrong.', 2, 6),
  ('de300000-0000-4000-a000-000000000408', null,
   'de300000-0000-4000-a000-0000000000c1',
   'To improve a disappointing Mastery score you should...',
   '["Wait a week","Study the weak areas and retake the module quiz","Take the General Course Quiz repeatedly","Open more lessons without reading them"]'::jsonb,
   1, 'The newest completed module-quiz attempt replaces the old Mastery score.', 1, 7)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 6. OPTIONAL — lecturer-analytics testing
-- ----------------------------------------------------------------------------
--  By default the demo course has NO lecturer, so the student experience is
--  fully testable but the lecturer dashboards for THIS course are empty (they
--  are scoped to a claimed lecturer slot). Lecturer analytics can still be
--  reviewed on your real course.
--
--  To also test the lecturer side ON the demo course, uncomment the INSERT
--  below, then during signup register a SEPARATE account as a lecturer using
--  Lecturer ID  LECT-DEMO. That account becomes the demo course's lecturer.
--
--  Caveats:
--    * a lecturer account cannot also be a student account (role conflict) —
--      use a different email from your student tester account;
--    * delete_csm_demo_course.sql removes this slot, but a tester account that
--      claimed it stays role 'teacher' (per-user data is not rewritten).
--
-- insert into public.lecturer_slots (lecturer_id, course_id)
-- values ('LECT-DEMO', 'de300000-0000-4000-a000-000000000000')
-- on conflict (lecturer_id) do nothing;

-- ----------------------------------------------------------------------------
-- 7. Confirmation
-- ----------------------------------------------------------------------------
do $$
declare
  v_course uuid := 'de300000-0000-4000-a000-000000000000';
  v_modules int;
  v_lessons int;
  v_mod_q   int;
  v_gcq_q   int;
begin
  select count(*) into v_modules from public.topics where course_id = v_course;
  select count(*) into v_lessons from public.lessons
    where topic_id in (select id from public.topics where course_id = v_course);
  select count(*) into v_mod_q from public.questions
    where topic_id in (select id from public.topics where course_id = v_course);
  select count(*) into v_gcq_q from public.questions
    where course_quiz_id in (select id from public.course_quizzes where course_id = v_course);
  raise notice 'CSM Demo Course seeded: % modules, % lessons, % module-quiz questions, % general-quiz questions.',
    v_modules, v_lessons, v_mod_q, v_gcq_q;
end $$;

commit;

-- ============================================================================
--  Done. Testers can now find "CSM Demo Course — Testing Only" in the course
--  catalogue and enroll. To remove everything: run delete_csm_demo_course.sql.
-- ============================================================================
