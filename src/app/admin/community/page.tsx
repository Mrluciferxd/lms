import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { db } from '@/server/db'
import { archiveChannel, unarchiveChannel } from '@/server/chat/actions'
import type { ChannelType } from '@/generated/prisma/enums'

export const metadata: Metadata = { title: 'Community · Admin' }

interface AdminChannel {
  id: string
  slug: string
  name: string
  type: ChannelType
  readOnly: boolean
  archivedAt: Date | null
  courseId: string | null
  batchId: string | null
  description: string | null
  _count: { members: number; messages: number }
  course: { title: string } | null
  batch: { name: string } | null
}

export default async function AdminCommunityPage() {
  if (!(await isFeatureEnabled('chat'))) notFound()

  // requirePermission rather than requireStaff, so a STAFF role without
  // chat:moderate sees a 404 instead of an "access denied" leak that the route
  // exists. The role check happens server-side here and again in each action.
  await requirePermission('chat:moderate', '/admin/community')

  const channels = await db.channel.findMany({
    orderBy: [{ archivedAt: 'asc' }, { type: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      readOnly: true,
      archivedAt: true,
      courseId: true,
      batchId: true,
      description: true,
      course: { select: { title: true } },
      batch: { select: { name: true } },
      _count: { select: { members: true, messages: true } },
    },
  })

  const active = channels.filter((channel) => !channel.archivedAt)
  const archived = channels.filter((channel) => channel.archivedAt)

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">Community</h1>
        <p className="text-sm text-content-muted">
          Channels, memberships and moderation. Channels tied to a cohort are created from the
          batch tools — create GLOBAL, ANNOUNCEMENT, or TOPIC rooms by hand here.
        </p>
      </header>

      <section aria-labelledby="new-channel" className="space-y-3">
        <h2
          id="new-channel"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          New channel
        </h2>
        <CreateChannelForm />
      </section>

      <section aria-labelledby="active-channels" className="space-y-3">
        <h2
          id="active-channels"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Active ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No active channels. Pack-seeded rooms (e.g. #market-talk) appear after running{' '}
            <code className="rounded bg-surface px-1 py-0.5">npm run packs:install</code>.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {active.map((channel) => (
              <ChannelAdminRow key={channel.id} channel={channel} />
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section aria-labelledby="archived-channels" className="space-y-3">
          <h2
            id="archived-channels"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            Archived ({archived.length})
          </h2>
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {archived.map((channel) => (
              <ChannelAdminRow key={channel.id} channel={channel} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ChannelAdminRow({ channel }: { channel: AdminChannel }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link
          href={`/app/community/${channel.slug}`}
          className="block truncate text-sm font-medium text-content hover:text-primary"
        >
          {channel.readOnly ? '📢 ' : '#'}
          {channel.name}
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 uppercase tracking-wide">
            {channel.type}
          </span>
          {channel.readOnly && <span>read-only</span>}
          {channel.course && <span>· {channel.course.title}</span>}
          {channel.batch && <span>· {channel.batch.name}</span>}
          <span>· {channel._count.members} members</span>
          <span>· {channel._count.messages} messages</span>
        </div>
        {channel.description && (
          <p className="mt-0.5 truncate text-xs text-content-muted">{channel.description}</p>
        )}
      </div>
      <form
        action={async () => {
          'use server'
          if (channel.archivedAt) {
            await unarchiveChannel({ channelSlug: channel.slug })
          } else {
            await archiveChannel({ channelSlug: channel.slug })
          }
        }}
      >
        <button
          type="submit"
          className="rounded-brand border border-surface-border px-3 py-1 text-xs text-content-muted hover:bg-surface-muted"
        >
          {channel.archivedAt ? 'Unarchive' : 'Archive'}
        </button>
      </form>
    </li>
  )
}

function CreateChannelForm() {
  // The create action validates name, slug and description; here we only
  // constrain inputs at the HTML layer (maxlength, required) so a click without
  // a name fails fast.
  return (
    <form
      action={async (formData: FormData) => {
        'use server'
        const { createChannel } = await import('@/server/chat/actions')
        // String-typed form values coerce to the typed action input. The action
        // re-validates every field, so a malformed `type` here surfaces as an
        // inline error rather than reaching Prisma.
        const name = String(formData.get('name') ?? '')
        const descriptionValue = formData.get('description')
        const description =
          descriptionValue === null || String(descriptionValue).length === 0
            ? null
            : String(descriptionValue)
        const slugValue = formData.get('slug')
        const slug =
          slugValue === null || String(slugValue).length === 0 ? null : String(slugValue)
        const type = String(formData.get('type') ?? 'TOPIC') as ChannelType
        const readOnly = String(formData.get('readOnly') ?? 'false') === 'true'
        await createChannel({ name, description, slug, type, readOnly })
      }}
      className="grid gap-3 rounded-brand border border-surface-border bg-surface p-4 sm:grid-cols-2"
    >
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Name</span>
        <input
          name="name"
          required
          maxLength={80}
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          placeholder="Market Talk"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Slug (optional — derived from name)</span>
        <input
          name="slug"
          maxLength={40}
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          placeholder="market-talk"
        />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-content-muted">Description</span>
        <input
          name="description"
          maxLength={280}
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Type</span>
        <select
          name="type"
          defaultValue="TOPIC"
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="GLOBAL">Global — every signed-in member</option>
          <option value="ANNOUNCEMENT">Announcement — staff post, students read</option>
          <option value="TOPIC">Topic — students join from the channel list</option>
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Read-only</span>
        <select
          name="readOnly"
          defaultValue="false"
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="false">Anyone who can see the channel can post</option>
          <option value="true">Only staff can post</option>
        </select>
      </label>
      <div className="sm:col-span-2 flex justify-end">
        <button
          type="submit"
          className="rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Create channel
        </button>
      </div>
    </form>
  )
}
