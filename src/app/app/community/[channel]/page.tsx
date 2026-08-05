import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { getOrgSettings } from '@/server/org/settings'
import {
  canModerate,
  canPost,
  decideChannelVisibility,
  loadChannelViewer,
  type ChannelViewer,
} from '@/server/chat/membership'
import { loadChannelForViewer, listMessages } from '@/server/chat/channels'
import {
  joinChannel,
  leaveChannel,
  markChannelRead,
} from '@/server/chat/actions'
import { Composer } from '@/components/chat/composer'
import { MessageControls } from '@/components/chat/message-controls'
import type { ViewableMessage } from '@/server/chat/channels'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ channel: string }>
}): Promise<Metadata> {
  const { channel } = await params
  return { title: `#${channel}` }
}

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channel: string }>
}) {
  const { channel: slug } = await params

  if (!(await isFeatureEnabled('chat'))) notFound()

  const user = await requireUser(`/app/community/${slug}`)
  const viewer = await loadChannelViewer(user.id)
  if (!viewer) notFound()

  const access = await loadChannelForViewer(slug, viewer)
  // Visibility decisions are 404s, never 403s — a student who has no business
  // in this room should not learn the slug is taken.
  if (!access.channel) notFound()

  const channel = access.channel

  // The viewer may be a member (TOPIC/DIRECT) or hold access by enrollment
  // (GLOBAL/COURSE/BATCH). For TOPIC/DIRECT they cannot read without being a
  // member; the membership row may still be missing for the others, which is
  // fine — markChannelRead upserts one on first read.
  const settings = await getOrgSettings()
  const membership = await loadMembership(channel.id, user.id)

  // Mark as read on entry. The action upserts a ChannelMember row if one is
  // absent, which is what makes read state work for GLOBAL/COURSE/BATCH/ANNOUNCE
  // rooms that have no membership table to hang on otherwise.
  if (!channel.archivedAt) {
    await markChannelRead({ channelSlug: slug })
  }

  const post = canPost(
    { ...channel, readOnly: channel.readOnly },
    viewer,
    membership,
    new Date(),
  )

  const viewerCanModerate = canModerate(
    viewer,
    membership ? { role: membership.role } : null,
  )

  const page = await listMessages(channel.id, user.id, { take: 50 })

  const format = (date: Date) => formatDateTime(date, settings.timezone, settings.locale)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-content-muted">
          <Link href="/app/community" className="hover:underline">
            {t('nav.community')}
          </Link>{' '}
          /
        </p>
        <h1 className="text-2xl font-semibold text-content">
          <span className="text-content-muted" aria-hidden>
            {channel.readOnly ? '📢 ' : '#'}
          </span>
          {channel.name}
        </h1>
        {channel.description && (
          <p className="text-sm text-content-muted">{channel.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-content-muted">
          <span>{channel.memberCount} members</span>
          {channel.readOnly && <span>· read-only — staff post, students read</span>}
          {channel.archivedAt && <span>· archived (read-only)</span>}
          {(channel.type === 'TOPIC' || channel.type === 'DIRECT') &&
            !channel.isMember &&
            !channel.archivedAt && (
              <form
                action={async () => {
                  'use server'
                  await joinChannel({ channelSlug: slug })
                }}
              >
                <button
                  type="submit"
                  className="rounded-brand bg-primary px-3 py-1 text-primary-foreground"
                >
                  Join channel
                </button>
              </form>
            )}
          {(channel.type === 'TOPIC' || channel.type === 'DIRECT') &&
            channel.isMember &&
            !channel.archivedAt && (
              <form
                action={async () => {
                  'use server'
                  await leaveChannel({ channelSlug: slug })
                }}
              >
                <button
                  type="submit"
                  className="text-content-muted underline hover:text-content"
                >
                  Leave
                </button>
              </form>
            )}
        </div>
      </header>

      <MessageList
        messages={page.messages}
        formats={{ when: format }}
        viewer={{ id: user.id, canModerate: viewerCanModerate }}
        channelSlug={slug}
      />

      {!channel.archivedAt && (
        <Composer
          channelSlug={slug}
          replyTo={null}
          onReplyCleared={() => {}}
          canPost={post.canPost}
          cannotPostReason={post.canPost === false ? denyReason(post.reason) : null}
        />
      )}
    </div>
  )
}

async function loadMembership(channelId: string, userId: string) {
  const { db } = await import('@/server/db')
  const row = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { role: true, mutedUntil: true },
  })
  // Returns the membership shape canPost expects; null when the viewer is not a
  // member (which is fine for GLOBAL/COURSE/BATCH rooms).
  return row
}

interface MessageListProps {
  messages: ViewableMessage[]
  formats: { when: (date: Date) => string }
  viewer: { id: string; canModerate: boolean }
  channelSlug: string
}

function MessageList({ messages, formats, viewer, channelSlug }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
        No messages yet — start the conversation.
      </p>
    )
  }
  return (
    <ol className="space-y-4">
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          formats={formats}
          viewer={viewer}
          channelSlug={channelSlug}
        />
      ))}
    </ol>
  )
}

function MessageRow({
  message,
  formats,
  viewer,
  channelSlug,
}: {
  message: ViewableMessage
  formats: { when: (date: Date) => string }
  viewer: { id: string; canModerate: boolean }
  channelSlug: string
}) {
  const isAuthor = message.authorId === viewer.id
  const showPinned = message.pinned

  return (
    <li
      className={
        showPinned
          ? 'rounded-brand border border-primary/30 bg-primary/5 px-4 py-3'
          : 'px-1 py-2'
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-medium uppercase text-content-muted">
          {message.authorName.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-medium text-content">{message.authorName}</span>
            <span className="text-xs text-content-muted">{message.authorRole}</span>
            <time
              dateTime={message.createdAt.toISOString()}
              className="text-xs text-content-muted"
            >
              {formats.when(message.createdAt)}
            </time>
            {message.editedAt && (
              <span className="text-[10px] text-content-muted">(edited)</span>
            )}
            {showPinned && (
              <span className="text-[10px] uppercase tracking-wide text-primary">pinned</span>
            )}
          </p>
          {message.deletedAt ? (
            <p className="text-sm italic text-content-muted">Message deleted</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-content">
              {message.body}
            </p>
          )}
          {message.reactions.length > 0 && !message.deletedAt && (
            <div className="mt-1 flex flex-wrap gap-1">
              {message.reactions.map((reaction) => (
                <span
                  key={reaction.emoji}
                  className={
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ' +
                    (reaction.reactedByMe
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-surface-border bg-surface-muted text-content-muted')
                  }
                >
                  <span aria-hidden>{reaction.emoji}</span>
                  <span>{reaction.count}</span>
                </span>
              ))}
            </div>
          )}
          <MessageControls
            channelSlug={channelSlug}
            messageId={message.id}
            authorId={message.authorId}
            isAuthor={isAuthor}
            deletedAt={message.deletedAt}
            pinned={message.pinned}
            viewerCanModerate={viewer.canModerate}
            onReply={() => {}}
          />
        </div>
      </div>
    </li>
  )
}

function denyReason(reason: string): string {
  const reasons: Record<string, string> = {
    READ_ONLY: 'This channel is read-only — only staff can post.',
    NOT_A_MEMBER: 'Join this channel to post in it.',
    MUTED: 'You have been muted in this channel.',
    ARCHIVED: 'This channel has been archived.',
    NOT_AUTHENTICATED: 'You must be signed in.',
    NOT_FOUND: 'Channel not found.',
  }
  return reasons[reason] ?? 'You cannot post in this channel.'
}
