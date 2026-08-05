'use client'

import { useState, useRef, useTransition } from 'react'

import {
  postMessage,
  type ActionResult,
} from '@/server/chat/actions'

interface ComposerProps {
  channelSlug: string
  /**
   * Reply target. Cleared locally after a successful send; the parent owns the
   * pointer because the server action flattens depth itself.
   */
  replyTo: { id: string; author: string } | null
  onReplyCleared: () => void
  canPost: boolean
  cannotPostReason: string | null
}

/**
 * The message composer. A controlled textarea plus a send button; optimistic UI
 * is intentionally absent — chat here is cohort-paced, not real-time-critical,
 * and an optimistic send that fails reconciliation would be more confusing than
 * a brief pending state. The server action is the source of truth.
 */
export function Composer({
  channelSlug,
  replyTo,
  onReplyCleared,
  canPost,
  cannotPostReason,
}: ComposerProps) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  if (!canPost) {
    return (
      <div className="rounded-brand border border-surface-border bg-surface-muted px-4 py-3 text-sm text-content-muted">
        {cannotPostReason ?? 'You cannot post in this channel.'}
      </div>
    )
  }

  function submit(formData: FormData) {
    const text = (formData.get('body') as string | null)?.trim() ?? ''
    if (!text) return
    setError(null)
    startTransition(async () => {
      const replyToId = (formData.get('replyToId') as string | null) ?? null
      const result: ActionResult<{ id: string; createdAt: Date }> = await postMessage({
        channelSlug,
        body: text,
        replyToId: replyToId || null,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      setBody('')
      onReplyCleared()
      formRef.current?.reset()
    })
  }

  return (
    <form ref={formRef} action={submit} className="space-y-2">
      {replyTo && (
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <span>Replying to {replyTo.author}</span>
          <button
            type="button"
            onClick={onReplyCleared}
            className="text-primary hover:underline"
          >
            cancel
          </button>
          <input type="hidden" name="replyToId" value={replyTo.id} />
        </div>
      )}
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a message…"
        maxLength={4000}
        disabled={pending}
        className="block w-full resize-y rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content outline-none focus:border-primary disabled:opacity-50"
        rows={3}
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          className="rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
