# AceTutor

An adaptive learning platform for CS/IT students. Students work through course
modules, take quizzes, and get a personalized, AI‑assisted study loop driven by
their actual quiz evidence. Lecturers manage one assigned course and see
evidence‑based analytics plus an AI assistant that interprets them.

> **Core principle** — *Performance* determines **what** a student needs to work
> on; *Learning Preferences* determine **how** AceTutor presents it. The two are
> never merged, and course completion is tracked separately from performance.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (SSR) + TanStack Router (flat‑file routing, generated route tree) |
| UI | React 19, Tailwind CSS v4, shadcn/ui components, Framer Motion, Recharts |
| Data / auth | Supabase (Postgres + Row Level Security + SECURITY DEFINER RPCs) |
| Server logic | TanStack server functions (`*.functions.ts`) behind an auth middleware |
| AI | OpenRouter (OpenAI‑compatible), one server‑side key, hedged free‑tier model roster |
| Build / deploy | Vite 7, Cloudflare‑compatible server entry (`wrangler.jsonc`) |

---

## Prerequisites

- **Node.js 20+** (developed on 22.x)
- A **Supabase project** (free tier is fine)
- A free **OpenRouter API key** — <https://openrouter.ai/keys>

---

## Setup

```bash
npm install
cp .env.example .env      # then fill in the values (see below)
```

### Environment variables

Copy `.env.example` to `.env` and set:

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | client + server | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client + server | Supabase anon/publishable key |
| `SUPABASE_URL` | server | same URL, for SSR / server functions |
| `SUPABASE_PUBLISHABLE_KEY` | server | same publishable key, server fallback |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **only** used by the *Delete account* feature (`auth.admin.deleteUser`) |
| `OPENROUTER_API_KEY` | server | required for every AI feature |
| `OPENROUTER_MODEL*`, `OPENROUTER_MODELS`, `OPENROUTER_SITE_URL` | server | optional — the code has working defaults |

The `VITE_`‑prefixed values are injected into the browser bundle (the Supabase
anon key is designed to be public and is protected by RLS). Every other value —
especially `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` — is **server‑only
and must never be exposed to the client**. `.env` is git‑ignored; do not commit a
filled‑in copy.

### Database

Apply the migrations in `supabase/migrations/` to your project (in filename
order), e.g. with the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

The migrations are additive and describe the full schema (tables, RLS policies,
RPCs, triggers). Historical migrations must not be edited.

---

## Run

```bash
npm run dev       # local dev server
npm run build     # production build (client + SSR server bundle)
npm run preview   # serve the production build
npm run lint      # ESLint
```

---

## Architecture

```
Quiz attempts
   │
   ▼
src/lib/quiz-performance.ts        pure model: usable / sufficient attempts,
   │                              module average, weak / strong / insufficient
   │                              state (70% threshold), improvement, trend
   ├────────────► student surfaces (course page, /performance, Study Paths, AI Tutor)
   │
   ▼
src/lib/lecturer-analytics.ts      pure aggregation over the student model:
   │                              per‑module cohorts, assessment coverage,
   │                              deterministic course insights
   │
   ▼
lecturer server functions ───────► /lecturer/performance
                                   + AI Performance Insights + AI Lecturer Assistant
```

**Performance rules (authoritative, in `quiz-performance.ts`):**

- *usable* attempt = finished, has questions, at least one answered.
- *sufficient* attempt = usable **and** ≥ 3 answered **and** ≥ 50 % of the quiz.
- Only **sufficient** attempts affect the module average, the weak/strong state,
  the Study Path anchor, and improvement/trend. Partial and zero‑answer attempts
  stay in history but never drive adaptive decisions.
- weak = sufficient average `< 70 %`; strong = `≥ 70 %`.

**AI features** (all server‑side via `callAI` in `src/lib/course-chat.functions.ts`):

| Feature | Server function |
|---|---|
| Student AI Tutor (course/module + lesson + preference + performance context) | `askCourse` |
| AI games (crossword / word search generation) | `askCourse` (`crossword_json`) |
| Personalized Study Path generation | `generateStudyPath` |
| Lecturer quiz generation | `lecturer-quiz.functions.ts` |
| Lecturer AI Performance Insights (one‑shot report) | `analyseCoursePerformance` |
| AI Lecturer Assistant (grounded Q&A) | `askLecturerAssistant` |

If the AI provider fails or is unconfigured, each feature shows a friendly error
and the rest of the app keeps working.

**Security model:**

- Route guards (`_authenticated.tsx`, `lecturer.tsx`) are UX only.
- **RLS + SECURITY DEFINER RPCs are the real boundary.** Students read only their
  own rows; `study_paths` and `quiz_attempts` have no client write policies —
  all writes go through ownership‑checking RPCs (`grade_quiz`, `save_study_path`,
  `mark_study_path_completed`, `delete_study_path`).
- Lecturer analytics never accept a course id from the client; the course is
  derived server‑side from `current_lecturer_course()` (backed by `lecturer_slots`).
  `get_course_quiz_performance()` / `get_course_students()` return zero rows for
  a non‑lecturer or another lecturer's course, and never expose emails.

---

## Project structure

```
src/
  routes/                 flat‑file routes; _authenticated/* = signed‑in, lecturer.* = lecturer workspace
  routes/routeTree.gen.ts generated by the dev server — do not edit by hand
  lib/                    pure models + server functions (*.functions.ts)
  hooks/                  React Query data hooks (use-auth, use-role, use-study-path, ...)
  components/             ui/ (shadcn), site/ (shell + nav), course/, lecturer/, games/
  integrations/supabase/  client, server (service‑role) client, auth middleware, generated types
supabase/migrations/      full schema history — additive only
```

---

## Known limitations

- **Delete account** requires `SUPABASE_SERVICE_ROLE_KEY` to be configured;
  without it the button shows a configuration error (no data loss, no crash).
- **AI answers** run on free‑tier OpenRouter models — quality and latency vary;
  factual claims about a course's numbers are constrained to the provided
  deterministic analytics, but general prose quality depends on the model.
- **Cohort trend** on the lecturer page uses "mean of students' Nth sufficient
  attempt"; with uneven retake counts later points reflect a smaller subset (each
  point needs ≥ 2 students once more than one student is assessed).
- **Student identity in lecturer aggregates** is the display name — two enrolled
  students with an identical name would merge in the aggregate counts.
- **No AI conversation memory / caching / content grounding** for the Lecturer
  Assistant — each question is answered standalone against a fresh analytics
  snapshot (deliberate: correctness over convenience).
- A separate legacy **Expo / React Native** prototype lives under
  `AceTutor/` and is **not** part of this application.
- The repository tracks both `package-lock.json` and a stale `bun.lock`; use
  `npm`.
