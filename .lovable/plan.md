
# AceTutor v1 — Implementation Plan

A multimodal AI tutoring web app for KNUST CS/IT students. v1 focuses on a polished, working product across the four pillars you selected. The ML model (Random Forest / Gradient Boost) and NLP feedback engine described in the proposal are stubbed behind a clean interface so they can be plugged in later without rewriting the UI.

## 1. Design direction

- Academic, focused, modern — closer to Notion / Khan Academy than a corporate SaaS.
- Deep indigo + warm amber accent on a near-white surface (dark mode supported).
- Display: Instrument Serif for headings; body: Inter. Generous whitespace, soft shadows, large readable type for long study sessions.
- All colors as HSL semantic tokens in `src/styles.css`; no hard-coded colors in components.

## 2. Tech & backend

- Lovable Cloud (Postgres + Auth + Storage) enabled.
- TanStack Start routing (file-based, SSR-friendly for SEO on public pages).
- Server functions for any privileged reads; browser Supabase client for user-scoped data (RLS).
- shadcn/ui for primitives; framer-motion for the hero and lesson transitions.

## 3. Data model (Lovable Cloud)

```text
profiles            id (=auth.users.id), full_name, vark_primary, vark_scores jsonb, created_at
user_roles          id, user_id, role (enum: student, admin)   -- separate table, has_role() SECDEF function
courses             id, slug, title, summary, cover_url, order_index
topics              id, course_id, slug, title, summary, order_index
lessons             id, topic_id, modality (text|video|audio), title, body_md,
                    media_url, duration_sec, order_index
questions           id, topic_id, prompt, choices jsonb, correct_index,
                    explanation, difficulty (1-5)
quiz_attempts       id, user_id, topic_id, score, total, started_at, finished_at
attempt_answers    id, attempt_id, question_id, selected_index, is_correct, time_ms
progress            id, user_id, lesson_id, completed_at, watched_seconds
vark_responses      id, user_id, answers jsonb, computed_style, created_at
```

RLS: users read/write only their own rows in `profiles`, `quiz_attempts`, `attempt_answers`, `progress`, `vark_responses`. Public read on `courses`, `topics`, `lessons`, `questions` (correct_index excluded from client via a view that strips it; full row only readable server-side when grading).

## 4. Routes

```text
/                       Landing (hero + 5 courses + how-it-works + CTA)
/login, /signup         Email+password and Google (Lovable Cloud auth)
/onboarding/vark        16-question VARK intake (skippable)
/_authenticated/
  dashboard             Recommended next lesson, recent quiz scores, streak
  courses               All 5 courses
  courses/$slug         Topic list for a course
  courses/$slug/$topic  Topic page: modality switcher (text/video/audio) + "Take quiz"
  quiz/$topicId         Quiz runner (randomized, difficulty-scaled)
  quiz/$attemptId/result Per-question review + explanations
  profile               VARK result, scores, retake intake, sign out
```

## 5. Feature behavior

**Auth**
- Email/password + Google. Profile row auto-created via trigger on `auth.users` insert.
- `_authenticated` layout guards protected routes via `beforeLoad`.

**VARK intake**
- 16 questions (4 per style). Scores computed client-side, written to `vark_responses` and `profiles.vark_primary`.
- Result drives the default modality on `/courses/$slug/$topic` (visual→video, aural→audio, read/write→text, kinesthetic→text with interactive code blocks). User can override per-lesson.

**Courses seeded**
1. Data Structures & Algorithms
2. Database Management Systems
3. Computer Networks
4. Software Engineering
5. Introduction to AI

Each ships with 3 topics × 3 modalities × short stub content + 5–8 questions per topic so the flow is demonstrable end-to-end. Audio/video use placeholder hosted URLs (replaceable in admin later).

**Lesson viewer**
- Tabs for Text / Video / Audio; defaults to VARK-preferred modality.
- Tracks `watched_seconds` and marks complete at 80% for media or "Mark complete" for text.

**Quiz engine**
- Server function picks N questions for a topic, randomized; difficulty mix adapts to the user's rolling accuracy on that topic (easy-skewed if <50%, mixed if 50–80%, hard-skewed if >80%).
- Client never receives `correct_index` — grading happens in a server function that writes `quiz_attempts` + `attempt_answers` and returns per-question correctness + explanations.
- Result page: score, breakdown, explanations, retry button.

**Feedback (v1 stub)**
- Rule-based explanations from the `explanation` column. The interface (`generateFeedback(question, user_answer) → string`) is isolated so a future Lovable AI call can replace it without touching the UI.

## 6. Out of scope for v1 (callable later)

- Real ML training of Random Forest / Gradient Boost from interaction logs — interaction data is being captured now so a future job can train against it.
- NLP-generated free-form feedback (Lovable AI Gateway).
- Admin CMS for uploading lessons/questions — for v1, content is seeded via migration.
- Mobile-native app.

## 7. Build order

1. Enable Lovable Cloud, create migrations + seed data, set up RLS and `has_role`.
2. Design tokens, layout shell, landing page, auth pages.
3. VARK onboarding + profile.
4. Courses list, course detail, lesson viewer with modality switching.
5. Quiz runner + server-side grading + result page.
6. Dashboard (recent activity, recommended lesson).
7. Polish: animations, empty states, mobile pass, SEO meta per route.
