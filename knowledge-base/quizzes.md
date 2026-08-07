# Quizzes

## What this subsystem does
A quiz is a list of questions attached to a lesson (`lessonId`) or standalone.
`BrandFeatures.quizzes` defaults to **false** — unlike journals, trackers and
data widgets it is opt-in per brand, so a deployment must explicitly enable it
(see `src/lib/brand/types.ts`).

Question types: **SINGLE_CHOICE**, **MULTI_CHOICE**, **TRUE_FALSE**,
**SHORT_ANSWER**, **LONG_ANSWER**. Grading split:

- SINGLE_CHOICE / MULTI_CHOICE / TRUE_FALSE auto-grade on submit. MULTI_CHOICE
  is full-match only — selecting the exact correct set, no partial credit.
- SHORT_ANSWER / LONG_ANSWER are **subjective**: they store the response with
  `isCorrect: null`, `points: 0`, and the attempt's `passed` stays `null`.
  Manual grading is a later cut — the student sees "Pending grade".

Attempt lifecycle: `maxAttempts` counts *submitted* attempts only; `0` is
unlimited. An in-flight (unsubmitted) attempt is **resumed** on the next
`startAttempt` rather than creating a new one — abandoning a tab does not burn
an attempt. `shuffleQuestions` is display-only: the taker reorders question
ids client-side, answers are still keyed by `questionId`.

## How it is structured
| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `QuestionType`/`PublishStatus` enums, `Quiz` (lessonId?, passPercent 60, maxAttempts 0, shuffleQuestions, status), `Question` (type, options Json `[{id,text,correct}]`, correctAnswer Json?, points, order), `QuizAttempt` (score/maxScore/passed, submittedAt), `QuizAnswer` (`@@unique([attemptId, questionId])`) |
| `src/server/quizzes/validation.ts` | **Pure** `parseQuestion`, `parseResponse`, `scoreAnswer`, `scoreAttempt`, `isSubjective` — the single source of truth for the response shapes and the auto-grading rules |
| `src/server/quizzes/access.ts` | **Pure** `decideQuizRead` (NOT_AUTHENTICATED / QUIZ_NOT_PUBLISHED / QUIZ_ARCHIVED), `decideCanTakeQuiz` (lesson gate), `decideCanStartAttempt` (+ MAX_ATTEMPTS_REACHED); `loadQuizViewer` |
| `src/server/quizzes/quizzes.ts` | DB reads. `ViewableQuiz`/`ViewableQuestion`/`ViewableAttempt`/`QuizWithAttempts`; student shapes **strip `correct` flags**, admin shapes include them; `listQuizzesForStudent`/`loadQuizForStudent`, `listQuizzesForAdmin`/`loadQuizForAdmin`, `countSubmittedAttempts`, `gradeSubmission` |
| `src/server/quizzes/actions.ts` | **`'use server'`** — `startAttempt` (resume-or-create + pre-create answer rows), `submitAttempt` (transactional grade + answers), `saveQuiz`, `setQuizStatus`, `saveQuestion`, `deleteQuestion`, `deleteQuiz` |
| `src/components/quizzes/quiz-taker.tsx` | Client taker — start / take / result phases, one `QuestionField` per type, "answer all questions" gate, `router.refresh()` on submit |
| `src/components/quizzes/quiz-editor.tsx` | Admin editor — settings form + per-question rows (type switch, dynamic options, TRUE_FALSE value switch, subjective types omit options); exports `QuizEditor`, `NewQuizForm`, `QuizStatusButtons`, `DeleteQuizButton` |
| `src/app/app/quizzes/page.tsx` + `[id]/page.tsx` | Student index (badges + best-attempt summary) and detail (metadata, attempt history, `QuizTaker`, exhausted-state) |
| `src/app/admin/quizzes/page.tsx` + `new/page.tsx` + `[id]/page.tsx` | Admin console — list, create, edit |
| `src/app/app/courses/[slug]/lessons/[lessonId]/page.tsx` | Embeds a "Take quiz" link when the lesson has a PUBLISHED quiz |
| `src/lib/nav.ts`, `src/lib/labels.ts` | `/app/quizzes` nav (order 40, feature `quizzes`), `/admin/quizzes` nav (order 45, `course:write`); `nav.quizzes` label |

## Rules that matter
- **Feature flag is the gate.** `isFeatureEnabled('quizzes')` → `notFound()`
  on every student and admin quiz route, and the lesson-page embed link. Nav
  entries are feature-gated too.
- **404 over 403, and DRAFT is invisible.** Students see only PUBLISHED
  quizzes; a DRAFT/ARCHIVED quiz (or a disabled feature) `notFound()`s on
  direct URL. Admin (`course:write`) sees all three statuses.
- **Lesson-attached quizzes ride the lesson gate.** Reachability reuses
  `getLessonAccess(lessonId, userId)` — a locked lesson's quiz is unreachable
  for a student. Standalone quizzes are open to any signed-in member.
- **Re-check on every write.** Every action resolves the viewer from the live
  session. `submitAttempt` verifies the attempt belongs to the caller and is
  not already submitted; `startAttempt` re-runs `decideCanStartAttempt`
  against `countSubmittedAttempts`.
- **Stored Json is untrusted.** `parseQuestion`/`parseResponse` re-validate
  options, correct-answer and the submitted response on every read/write; a
  malformed `options` cell degrades to a safe empty question.
- **The answer row is the shape authority.** `startAttempt` pre-creates one
  `QuizAnswer` per question (`response: {}`, `isCorrect: null`); `submitAttempt`
  is a flat per-question update keyed by the `@@unique([attemptId, questionId])`
  index. A second submit is refused ("already been submitted").
- **`timeLimitMin` is informational.** The schema and UI badge carry it, but
  the taker does not enforce a countdown yet — timer enforcement is a later
  cut, same as manual grading and explanation reveal.
- **`scoreAttempt(passPercent, { grade, maxPoints }[])`** receives max points
  per answer explicitly, because a failed answer stores `points: 0` and the
  max score cannot be reconstructed from stored rows alone. `passPercent` is
  clamped to 60 when outside 0..100.

## Pack contributions
None. Quizzes are authored in the admin console; no pack ships a `quiz` seed.
Nothing in `src/server/quizzes` or `src/app/*/quizzes` imports a pack, and the
lesson-embed query reads the quiz table directly.

## Verification — what to run after touching this
```bash
npm run typecheck
npm test                       # 926 unit; quizzes contribute +27
NEXT_PUBLIC_BRAND=demo-academy npm run build   # 5 quiz routes built
NEXT_PUBLIC_BRAND=nirlep-forex npm run build   # sequential — prisma generate races
```
