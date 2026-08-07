import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import {
  DeleteQuizButton,
  QuizEditor,
  QuizStatusButtons,
} from '@/components/quizzes/quiz-editor'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadQuizViewer } from '@/server/quizzes/access'
import { loadQuizForAdmin } from '@/server/quizzes/quizzes'

export const metadata: Metadata = { title: 'Edit quiz' }

export default async function EditQuizPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isFeatureEnabled('quizzes'))) notFound()
  const user = await requirePermission('course:write', '/admin/quizzes')

  const { id } = await params
  const viewer = await loadQuizViewer(user.id)
  if (!viewer) notFound()

  const quiz = await loadQuizForAdmin(id, viewer)
  if (!quiz) notFound()

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-content-muted">
          <a href="/admin/quizzes" className="hover:text-primary">
            Quizzes
          </a>{' '}
          / {quiz.title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-content">{quiz.title}</h1>
          <StatusBadge status={quiz.status} />
        </div>
        {quiz.description && (
          <p className="text-sm text-content-muted">{quiz.description}</p>
        )}
      </header>

      <section aria-labelledby="status-heading" className="space-y-2">
        <h2
          id="status-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Status
        </h2>
        <QuizStatusButtons quizId={quiz.id} currentStatus={quiz.status} />
      </section>

      <QuizEditor quiz={quiz} />

      <section aria-labelledby="danger-heading" className="space-y-2">
        <h2
          id="danger-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Danger zone
        </h2>
        <div className="rounded-brand border border-danger/30 bg-danger/5 p-4">
          <p className="mb-2 text-sm text-content-muted">
            Deleting a quiz removes it and every question permanently.
          </p>
          <DeleteQuizButton quizId={quiz.id} />
        </div>
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }) {
  const tone =
    status === 'PUBLISHED'
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-surface-border bg-surface-muted text-content-muted'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  )
}
