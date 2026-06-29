# AceTutor — Mobile App (Expo)

Native iOS / Android (and web) build of AceTutor, ported from the TanStack web
app. It talks to the **same Supabase backend**, so accounts, courses, progress
and quiz attempts are shared across web and mobile.

## Stack

- **Expo SDK 56** + **expo-router** (file-based routing in `src/app`)
- **Supabase** (`@supabase/supabase-js`) with session persistence via
  `@react-native-async-storage/async-storage`
- **@tanstack/react-query** for data fetching/caching
- **expo-linear-gradient**, **@expo/vector-icons**, **expo-image** for the UI

## Run it

```bash
cd AceTutor
npm install
npx expo start          # then press i (iOS), a (Android), or w (web)
```

Supabase keys live in `.env` (`EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`) with safe in-code fallbacks.

## Screens (`src/app`)

| Route | Screen |
|---|---|
| `index` | Auth gate → redirects to login or the app |
| `login`, `signup` | Email/password + Google OAuth + forgot-password |
| `onboarding-vark` | 16-question VARK learning-style intake |
| `(tabs)/dashboard` | Greeting, continue-learning hero, stats, recent quizzes |
| `(tabs)/courses` | Enrolled courses + explore catalog |
| `(tabs)/analytics` | KPIs, time-by-course & score-trend charts |
| `(tabs)/profile` | Name edit, stats, VARK, sign out |
| `course/[slug]` | Enroll, progress, modules, performance |
| `topic/[topicId]` | Lesson viewer with Read / Watch / Listen modality switch |
| `quiz/[topicId]` | Adaptive quiz runner (`get_quiz_questions` / `grade_quiz`) |
| `result/[attemptId]` | Score + per-question review |

## Shared modules

- `src/theme.ts` — brand palette (violet) + light/dark colors
- `src/components/ui.tsx` — Screen, Card, Button, GradientButton, TextField, etc.
- `src/components/brand-splash.tsx` — animated logo splash on cold start
- `src/lib/auth.tsx` — auth context + session auto-refresh
- `src/lib/queries.ts`, `src/lib/use-learning.ts` — Supabase fetchers + derived stats
- `src/integrations/supabase/*` — client + generated DB types (shared with web)

## Notes

- The **AI Course Tutor** chat is web-only — it runs through a server function
  with a server-side OpenRouter key that the mobile client can't call directly.
  The course screen links users to the web app for it.
- **Google sign-in** requires the Google provider and the `acetutor://` redirect
  to be enabled in Supabase Auth settings.
- Permanent **account deletion** is handled on the web (privileged server
  function); the mobile profile screen signs out and points users there.
- Lesson video/audio open in the system browser (no in-app iframe on native);
  lesson text renders as plain text.
