import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDateTime } from '@/lib/utils'
import { QuizTaker } from '@/components/quizzes/quiz-taker'
import { requireUser } from '@/server/auth/rbac'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { loadQuizViewer } from '@/server/quizzes/access'
import {
  loadQuizForStudent,
  type ViewableAttempt,
} from '@/server/quizzes/quizzes'

export const metadata: Metadata = { title: 'Quiz' }

export default async function QuizDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isFeatureEnabled('quizzes'))) notFound()

  const { id } = await params
  const user = await requireUser(`/app/quizzes/${id}`)
  const viewer = await loadQuizViewer(user.id)
  if (!viewer) notFound()

  const data = await loadQuizForStudent(id, viewer)
  if (!data) notFound()

  const { quiz, attempts } = data
  const settings = await getOrgSettings()
  const submittedAttempts = attempts.filter((a) => a.submittedAt !== null).length
  const exhausted = quiz.maxAttempts > 0 && submittedAttempts >= quiz.maxAttempts

  const hasLessonLink = Boolean(quiz.lessonId && quiz.lessonTitle && quiz.courseSlug)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {hasLessonLink && (
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link
            href={`/app/courses/${quiz.courseSlug}/lessons/${quiz.lessonId}`}
            className="text-content-muted hover:text-content"
          >
            ← {quiz.lessonTitle}
          </Link>
        </nav>
      )}

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">{quiz.title}</h1>
        {quiz.description && <p className="text-sm text-content-muted">{quiz.description}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            {quiz.questions.length} {quiz.questions.length === 1 ? 'question' : 'questions'}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            Pass {quiz.passPercent}%
          </span>
          {quiz.timeLimitMin !== null && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
              {quiz.timeLimitMin} min
            </span>
          )}
          {quiz.maxAttempts > 0 && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
              max {quiz.maxAttempts} attempts
            </span>
          )}
        </div>
      </header>

      {attempts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-content-muted">
            Your attempts
          </h2>
          <ul className="space-y-1">
            {attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="flex items-center justify-between rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm"
              >
                <span className="text-content-muted">
                  {formatDateTime(attempt.startedAt, settings.timezone, settings.locale)}
                </span>
                <span className="text-content">{attemptLine(attempt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {exhausted ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          You have used all attempts for this quiz.
        </p>
      ) : (
        <QuizTaker quiz={quiz} />
      )}
    </div>
  )
}

function attemptLine(attempt: ViewableAttempt): string {
  if (attempt.pending) return 'Pending grade'
  const score = attempt.score ?? 0
  const max = attempt.maxScore ?? 0
  const verdict = attempt.passed ? 'Passed' : 'Did not pass'
  return `${score}/${max} · ${verdict}`
}
