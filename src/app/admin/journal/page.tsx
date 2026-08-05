import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadJournalViewer } from '@/server/journals/access'
import { listJournalDefinitions } from '@/server/journals/journals'
import { db } from '@/server/db'

export const metadata: Metadata = { title: 'Journal Review · Admin' }

export default async function AdminJournalPage() {
  if (!(await isFeatureEnabled('journals'))) notFound()
  await requirePermission('journal:review', '/admin/journal')

  const viewer = await loadJournalViewer(null)
  if (!viewer) notFound()

  const definitions = await listJournalDefinitions(viewer)
  // Definitions visible to a reviewer include both student-authored and
  // instructor-only ones — reviewers can audit instructor logs too. This second
  // query brings in instructor-only journals that listJournalDefinitions already
  // returns (the viewer visibility check passes for any signed-in member on an
  // enabled journal), but kept defensively in case the visibility rule tightens.
  const extraForStaff = await db.journalDefinition.findMany({
    where: { enabled: true, studentAuthored: false },
    select: {
      id: true,
      key: true,
      name: true,
      singular: true,
      description: true,
    },
  })

  const allDefs = [
    ...definitions,
    ...extraForStaff.filter((row) => !definitions.some((d) => d.id === row.id)),
  ]

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">Journal Review</h1>
        <p className="text-sm text-content-muted">
          Review student journal entries across every journal. Open the journal to
          see its entries; private entries are visible to you as a reviewer.
        </p>
      </header>

      <ul className="space-y-3">
        {allDefs.map((definition) => {
          return (
            <li key={definition.id}>
              <Link
                href={`/admin/journal/${definition.key}`}
                className="block rounded-brand border border-surface-border px-4 py-3 hover:bg-surface-muted"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-content">{definition.name}</span>
                  <span className="text-xs text-content-muted">
                    · {definition.singular}
                  </span>
                </div>
                {definition.description && (
                  <p className="mt-1 text-xs text-content-muted">
                    {definition.description}
                  </p>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
