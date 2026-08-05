'use client'

import { useTransition, useState } from 'react'

import {
  deleteMessage,
  togglePin,
  toggleReaction,
} from '@/server/chat/actions'

interface MessageControlsProps {
  channelSlug: string
  messageId: string
  authorId: string
  isAuthor: boolean
  deletedAt: Date | null
  pinned: boolean
  // The viewer's moderator status is resolved server-side and passed in. The
  // client never decides authorization; the controls are only rendered when the
  // viewer can use them, and the server action re-checks anyway.
  viewerCanModerate: boolean
  onReply: () => void
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '🤔', '👀']

/**
 * Small affordance row beneath a message: reply, react, and (for the author or
 * a moderator) delete and pin. Each action routes to a server action that
 * re-checks authorization, so the worst a tampered client can do is fail with
 * an inline error.
 */
export function MessageControls({
  channelSlug,
  messageId,
  authorId,
  deletedAt,
  pinned,
  isAuthor,
  viewerCanModerate,
  onReply,
}: MessageControlsProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (deletedAt) return null

  function run(
    action: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  ) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) setError(result.reason)
    })
  }

  return (
    <div className="mt-1 flex items-center gap-1 text-xs text-content-muted">
      <button
        type="button"
        disabled={pending}
        onClick={onReply}
        className="rounded px-1.5 py-0.5 hover:bg-surface-muted"
      >
        Reply
      </button>

      <div className="relative group">
        <button
          type="button"
          disabled={pending}
          className="rounded px-1.5 py-0.5 hover:bg-surface-muted"
        >
          React
        </button>
        <div className="absolute left-0 top-full hidden group-hover:flex bg-surface border border-surface-border rounded-brand shadow-sm z-10">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => toggleReaction({ channelSlug, messageId, emoji }))
              }
              className="px-2 py-1 text-base hover:bg-surface-muted"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {viewerCanModerate && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => togglePin({ channelSlug, messageId }))}
          className="rounded px-1.5 py-0.5 hover:bg-surface-muted"
        >
          {pinned ? 'Unpin' : 'Pin'}
        </button>
      )}

      {(isAuthor || viewerCanModerate) && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteMessage({ channelSlug, messageId }))}
          className="rounded px-1.5 py-0.5 text-danger hover:bg-surface-muted"
        >
          Delete
        </button>
      )}

      {error && <span className="text-danger">{error}</span>}
    </div>
  )
}
