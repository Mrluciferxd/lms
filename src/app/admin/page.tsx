import type { Metadata } from 'next'

import { checkIntegrationEnv } from '@/env'
import { activePacks, brand } from '@/lib/brand'
import { orphanedPackLabels } from '@/lib/labels'
import { requireStaff } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { resolveFeatures } from '@/server/org/settings'

export const metadata: Metadata = { title: 'Admin' }

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-brand border border-surface-border p-4">
      <p className="text-xs uppercase tracking-wide text-content-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-content">{value}</p>
    </div>
  )
}

export default async function AdminOverviewPage() {
  await requireStaff('/admin')

  const [students, courses, batches, features] = await Promise.all([
    db.user.count({ where: { role: 'STUDENT', status: 'ACTIVE' } }),
    db.course.count({ where: { status: 'PUBLISHED' } }),
    db.batch.count({ where: { status: { in: ['ENROLLING', 'RUNNING'] } } }),
    resolveFeatures(),
  ])

  /**
   * Setup checklist. During per-client onboarding the most common failure is a
   * declared integration with no credentials — this surfaces exactly which
   * variables are still missing instead of leaving it to a runtime 500.
   */
  const missingIntegrations = checkIntegrationEnv(brand)
  const orphanedLabels = orphanedPackLabels()

  const enabledFeatures = Object.entries(features).filter(([, on]) => on)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-content">Overview</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Active students" value={students} />
        <Stat label="Published courses" value={courses} />
        <Stat label="Running batches" value={batches} />
      </div>

      {missingIntegrations.length > 0 && (
        <section
          aria-labelledby="setup-heading"
          className="rounded-brand border border-warning/40 bg-warning/10 p-4"
        >
          <h2 id="setup-heading" className="text-sm font-semibold text-content">
            Setup incomplete
          </h2>
          <p className="mt-1 text-sm text-content-muted">
            This deployment declares integrations that have no credentials configured.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {missingIntegrations.map((requirement) => (
              <li key={requirement.integration}>
                <span className="font-medium text-content">{requirement.integration}</span>
                <span className="text-content-muted"> — missing {requirement.missing.join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {orphanedLabels.length > 0 && (
        <section className="rounded-brand border border-surface-border p-4">
          <h2 className="text-sm font-semibold text-content">Stale pack labels</h2>
          <p className="mt-1 text-sm text-content-muted">
            These pack label overrides no longer match a core label key, so they have no
            effect. Usually left behind by a core rename.
          </p>
          <ul className="mt-2 font-mono text-xs text-content-muted">
            {orphanedLabels.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="deployment-heading" className="space-y-3">
        <h2
          id="deployment-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Deployment
        </h2>
        <dl className="grid gap-x-6 gap-y-2 rounded-brand border border-surface-border p-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:contents">
            <dt className="text-content-muted">Brand</dt>
            <dd className="font-mono text-content">{brand.key}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:contents">
            <dt className="text-content-muted">Vertical packs</dt>
            <dd className="text-content">
              {activePacks.length > 0
                ? activePacks.map((pack) => `${pack.name} v${pack.version}`).join(', ')
                : 'None — running the neutral core'}
            </dd>
          </div>
          <div className="flex justify-between gap-4 sm:contents">
            <dt className="text-content-muted">Payments</dt>
            <dd className="text-content">{brand.integrations.payments}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:contents">
            <dt className="text-content-muted">Video</dt>
            <dd className="text-content">{brand.integrations.video}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:contents">
            <dt className="text-content-muted">Enabled features</dt>
            <dd className="text-content">{enabledFeatures.length}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
