'use client'

import { useState, useTransition } from 'react'

import {
  addJournalEntryComment,
  type ActionResult,
  type CreatedComment,
} from '@/server/journals/actions'

interface CommentEditorProps {
  entryId: string
}

export function CommentEditor({ entryId }: CommentEditorProps) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [posts, setPosts] = useState(0)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (body.trim() === '') {
      setError('Comment cannot be empty.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result: ActionResult<CreatedComment> = await addJournalEntryComment({
        entryId,
        body,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      setBody('')
      setPosts(0)
      // Force a route refresh server-render; the comment list lives in the
      // server component, so a refresh is the cleanest way to re-read it.
      window.location.reload()
    })
  }

  return (
    <div className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          setPosts(0)
        }}
        rows={3}
        maxLength={5_000}
        disabled={pending}
        placeholder="Write a comment…"
        className="block w-full resize-y rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending || body.trim() === ''}
          onClick={submit}
          className="rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Comment'}
        </button>
      </div>
      {posts > 0 && <p className="text-xs text-success">Comment posted.</p>}
    </div>
  )
}
