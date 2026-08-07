import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadQuizViewer } from '@/server/quizzes/access'
import { listQuizzesForAdmin, type ViewableQuiz } from '@/server/quizzes/quizzes'

export const metadata: Metadata = { title: 'Quizzes' }

const buttonClass =
  'inline-flex items-center rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50'

const STATUS_TONE: Record<ViewableQuiz['status'], 'success' | 'muted' | 'danger'> = {
  PUBLISHED: 'success',
  DRAFT: 'muted',
  ARCHIVED: 'muted',
}

const CHIP_TONE: Record<'success' | 'muted' | 'danger', string> = {
  success: 'border-primary bg-primary/10 text-primary',
  muted: 'border-surface-border bg-surface-muted text-content-muted',
  danger: 'border-danger/40 bg-danger/10 text-danger',
}

function StatusChip({ status }: { status: ViewableQuiz['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium',
        CHIP_TONE[STATUS_TONE[status]],
      )}
    >
      {status}
    </span>
  )
}

export default async function AdminQuizzesPage() {
  if (!(await isFeatureEnabled('quizzes'))) notFound()
  const user = await requirePermission('course:write', '/admin/quizzes')

  const viewer = await loadQuizViewer(user.id)
  if (!viewer) notFound()

  const quizzes = await listQuizzesForAdmin(viewer)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">{t('nav.quizzes')}</h1>
        <p className="text-sm text-content-muted">
          Author quizzes, draft questions, and publish them for students to attempt.
        </p>
      </header>

      <div>
        <Link href="/admin/quizzes/new" className={buttonClass}>
          New quiz
        </Link>
      </div>

      {quizzes.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No quizzes yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {quizzes.map((quiz) => (
            <li key={quiz.id}>
              <Link
                href={`/admin/quizzes/${quiz.id}`}
                className="block rounded-brand border border-surface-border px-4 py-3 hover:bg-surface-muted"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-content">{quiz.title}</span>
                  <StatusChip status={quiz.status} />
                  <span className="text-xs text-content-muted">· —</span>
                  {quiz.lessonTitle && (
                    <span className="text-xs text-content-muted">· {quiz.lessonTitle}</span>
                  )}
                </div>
                {quiz.description && (
                  <p className="mt-1 text-xs text-content-muted">{quiz.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
