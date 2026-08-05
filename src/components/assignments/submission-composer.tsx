'use client'

import { useState, useRef, useTransition } from 'react'

import { saveSubmission, type ActionResult, type SubmittedPayload } from '@/server/assignments/actions'

interface SubmissionComposerProps {
  assignmentId: string
  initial: { contentText: string; attachmentIds: string[] }
  canSubmit: boolean
  cannotSubmitReason: string | null
  /** Submission status when entering the page; the action re-checks anyway. */
  currentStatus: 'DRAFT' | 'SUBMITTED' | 'RESUBMIT_REQUESTED' | 'GRADED' | null
  maxScore: number
  showScoreBlock: { score: number | null; feedback: string | null; gradedByName: string | null } | null
}

/**
 * The submission composer. Two submit affordances share one action:
 *  - Save draft: keeps the row in DRAFT, never opens the grader queue.
 *  - Submit: moves the row to SUBMITTED; the grader sees it.
 *
 * No optimistic UI: a save attempt that succeeded locally then failed
 * server-side would let the student walk off believing the work is in.
 */
export function SubmissionComposer({
  assignmentId,
  initial,
  canSubmit,
  cannotSubmitReason,
  currentStatus,
  maxScore,
  showScoreBlock,
}: SubmissionComposerProps) {
  const [text, setText] = useState(initial.contentText)
  const [error, setError] = useState<string | null>(null)
  const [lastStatus, setLastStatus] = useState<SubmittedPayload['status'] | null>(
    currentStatus ?? null,
  )
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function submit(formData: FormData, submitFlag: boolean) {
    const value = (formData.get('contentText') as string | null)?.trim() ?? ''
    if (!value && (formData.get('attachmentIds') as string | null) === null) {
      setError('A submission must have text or an attachment.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result: ActionResult<SubmittedPayload> = await saveSubmission({
        assignmentId,
        contentText: value,
        submit: submitFlag,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      if (result.data) setLastStatus(result.data.status)
    })
  }

  const showGradedBlock = currentStatus === 'GRADED' && showScoreBlock !== null
  const isLocked = showGradedBlock || !canSubmit

  return (
    <form ref={formRef} className="space-y-3">
      {showGradedBlock && showScoreBlock && (
        <div className="rounded-brand border border-success/30 bg-success/5 p-4 space-y-2">
          <p className="flex items-baseline gap-2 text-sm font-medium text-content">
            <span className="text-success">
              {showScoreBlock.score} / {maxScore}
            </span>
            <span>graded</span>
            {showScoreBlock.gradedByName && (
              <span className="text-xs text-content-muted">
                by {showScoreBlock.gradedByName}
              </span>
            )}
          </p>
          {showScoreBlock.feedback && (
            <p className="whitespace-pre-wrap break-words text-sm text-content">
              {showScoreBlock.feedback}
            </p>
          )}
        </div>
      )}

      {!showGradedBlock && (
        <>
          <textarea
            name="contentText"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your submission here. Attachments upload separately."
            maxLength={50_000}
            disabled={pending || isLocked}
            rows={10}
            className="block w-full resize-y rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content outline-none focus:border-primary disabled:opacity-50"
          />
          {currentStatus === 'RESUBMIT_REQUESTED' && (
            <p className="text-xs text-content-muted">
              The grader returned this with feedback above. Re-submit when ready.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          {isLocked ? (
            <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-3 text-sm text-content-muted">
              {cannotSubmitReason ?? 'You cannot submit here right now.'}
            </p>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={pending || text.trim().length === 0}
                onClick={() => {
                  const formData = new FormData(formRef.current ?? undefined)
                  submit(formData, false)
                }}
                className="rounded-brand border border-surface-border px-4 py-1.5 text-sm text-content-muted hover:bg-surface-muted disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Save draft'}
              </button>
              <button
                type="button"
                disabled={pending || text.trim().length === 0}
                onClick={() => {
                  const formData = new FormData(formRef.current ?? undefined)
                  submit(formData, true)
                }}
                className="rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {pending ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          )}
          {lastStatus === 'SUBMITTED' && (
            <p className="text-xs text-success">Submitted — waiting on grading.</p>
          )}
        </>
      )}
    </form>
  )
}
