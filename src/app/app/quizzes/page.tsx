import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadQuizViewer } from '@/server/quizzes/access'
import {
  listQuizzesForStudent,
  type QuizWithAttempts,
  type ViewableAttempt,
} from '@/server/quizzes/quizzes'

export const metadata: Metadata = { title: 'Quizzes' }

export default async function QuizzesPage() {
  if (!(await isFeatureEnabled('quizzes'))) notFound()
  const user = await requireUser('/app/quizzes')
  const viewer = await loadQuizViewer(user.id)
  if (!viewer) notFound()

  const quizzes = await listQuizzesForStudent(viewer)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">{t('nav.quizzes')}</h1>
      </header>

      {quizzes.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No quizzes available.
        </p>
      ) : (
        <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
          {quizzes.map((quiz) => (
            <QuizRow key={quiz.quiz.id} quiz={quiz} />
          ))}
        </ul>
      )}
    </div>
  )
}

function QuizRow({ quiz }: { quiz: QuizWithAttempts }) {
  const { quiz: def, attempts } = quiz
  return (
    <li>
      <Link href={`/app/quizzes/${def.id}`} className="block px-4 py-3 hover:bg-surface-muted">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            {def.questions.length} {def.questions.length === 1 ? 'question' : 'questions'}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            Pass {def.passPercent}%
          </span>
          {def.timeLimitMin !== null && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
              {def.timeLimitMin} min
            </span>
          )}
          {def.maxAttempts > 0 && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
              max {def.maxAttempts} attempts
            </span>
          )}
          <span className="text-sm text-content-muted">·</span>
          <span className="text-sm text-content-muted">{bestAttemptSummary(attempts)}</span>
        </div>
        <p className="text-content">{def.title}</p>
        {def.description && (
          <p className="mt-0.5 truncate text-sm text-content-muted">{def.description}</p>
        )}
      </Link>
    </li>
  )
}

function bestAttemptSummary(attempts: ViewableAttempt[]): string {
  const latest = attempts[0]
  if (!latest) return 'Not attempted'
  if (latest.pending) return 'Pending grade'
  const score = latest.score ?? 0
  const max = latest.maxScore ?? 0
  const verdict = latest.passed ? 'Passed' : 'Did not pass'
  return `${score}/${max} · ${verdict}`
}
