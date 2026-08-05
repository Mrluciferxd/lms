'use client'

import { useState, useTransition } from 'react'

import {
  gradeSubmission,
  reopenSubmission,
  type ActionResult,
  type GradedPayload,
} from '@/server/assignments/actions'
import type { SubmissionStatus } from '@/generated/prisma/enums'

interface GradingFormProps {
  submissionId: string
  maxScore: number
  currentStatus: SubmissionStatus
  currentScore: number | null
  currentFeedback: string | null
  onGraded?: () => void
}

export function GradingForm({
  submissionId,
  maxScore,
  currentStatus,
  currentScore,
  currentFeedback,
  onGraded,
}: GradingFormProps) {
  const [score, setScore] = useState<string>(
    currentScore !== null ? String(currentScore) : '',
  )
  const [feedback, setFeedback] = useState(currentFeedback ?? '')
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{
    status: SubmissionStatus
    score: number | null
  } | null>(null)
  const [pending, startTransition] = useTransition()

  const displayStatus = lastResult?.status ?? currentStatus
  const displayScore = lastResult?.score ?? currentScore

  function handleGrade() {
    const parsed = score.trim() === '' ? null : Number(score)
    if (parsed === null) {
      setError('Enter a score before grading.')
      return
    }
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxScore) {
      setError(`Score must be a whole number between 0 and ${maxScore}.`)
      return
    }
    setError(null)
    startTransition(async () => {
      const result: ActionResult<GradedPayload> = await gradeSubmission({
        submissionId,
        score: parsed,
        feedback: feedback.trim() || undefined,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      setLastResult({ status: result.data!.status, score: parsed })
      onGraded?.()
    })
  }

  function handleReturnForResubmit() {
    setError(null)
    startTransition(async () => {
      const result: ActionResult<GradedPayload> = await reopenSubmission({
        submissionId,
        feedback: feedback.trim() || undefined,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      setLastResult({ status: result.data!.status, score: null })
      setScore('')
      onGraded?.()
    })
  }

  const isGraded = displayStatus === 'GRADED'
  const isResubmitRequested = displayStatus === 'RESUBMIT_REQUESTED'

  return (
    <div className="space-y-3">
      {isGraded && displayScore !== null && (
        <p className="text-sm font-medium text-success">
          Graded: {displayScore} / {maxScore}
        </p>
      )}
      {isResubmitRequested && (
        <p className="text-sm font-medium text-warning">
          Returned for resubmission.
        </p>
      )}

      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Score (0 – {maxScore})</span>
        <input
          type="number"
          min={0}
          max={maxScore}
          step={1}
          value={score}
          onChange={(e) => setScore(e.target.value)}
          disabled={pending}
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Feedback</span>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
          maxLength={10_000}
          disabled={pending}
          placeholder="Optional feedback for the student."
          className="block w-full resize-y rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
      </label>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={handleGrade}
          className="rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Saving…' : isGraded ? 'Re-grade' : 'Grade'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleReturnForResubmit}
          className="rounded-brand border border-surface-border px-4 py-1.5 text-sm text-content-muted hover:bg-surface-muted disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Return for resubmit'}
        </button>
      </div>
    </div>
  )
}
