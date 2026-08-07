import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { NewQuizForm } from '@/components/quizzes/quiz-editor'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'

export const metadata: Metadata = { title: 'New quiz' }

export default async function NewQuizPage() {
  if (!(await isFeatureEnabled('quizzes'))) notFound()
  await requirePermission('course:write', '/admin/quizzes/new')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-content-muted">
          <a href="/admin/quizzes" className="hover:text-primary">
            Quizzes
          </a>{' '}
          / New
        </p>
        <h1 className="text-2xl font-semibold text-content">New quiz</h1>
        <p className="text-sm text-content-muted">
          Create the quiz, then add questions in the editor.
        </p>
      </header>

      <div className="rounded-brand border border-surface-border bg-surface p-4">
        <NewQuizForm />
      </div>
    </div>
  )
}
