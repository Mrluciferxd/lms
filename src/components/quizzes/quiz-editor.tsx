'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import {
  deleteQuestion,
  deleteQuiz,
  saveQuestion,
  saveQuiz,
  setQuizStatus,
  type ActionResult,
  type QuestionInput,
} from '@/server/quizzes/actions'
import type {
  ViewableQuiz,
  ViewableQuestion,
} from '@/server/quizzes/quizzes'
import type { PublishStatus, QuestionType } from '@/generated/prisma/enums'
import type React from 'react'

const inputClass =
  'block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm text-content outline-none focus:border-primary disabled:opacity-50'
const buttonClass =
  'rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50'
const ghostButtonClass =
  'text-sm text-primary underline disabled:opacity-50'
const dangerButtonClass =
  'text-sm text-danger underline disabled:opacity-50'
const labelClass = 'space-y-1 text-sm'

type ChipTone = 'success' | 'muted' | 'danger'

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const toneClass: Record<ChipTone, string> = {
    success: 'border-primary bg-primary/10 text-primary',
    muted: 'border-surface-border bg-surface-muted text-content-muted',
    danger: 'border-danger/40 bg-danger/10 text-danger',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium',
        toneClass[tone],
      )}
    >
      {children}
    </span>
  )
}

// ─── NewQuizForm ────────────────────────────────────────────────────────────

export function NewQuizForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (title.trim() === '') {
      setError('Title is required.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result: ActionResult<{ quizId: string }> = await saveQuiz({
        title,
        description: description.trim() === '' ? null : description,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.push(`/admin/quizzes/${result.data!.quizId}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className={labelClass}>
        <span className="text-content-muted">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          disabled={pending}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        <span className="text-content-muted">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={pending}
          className={inputClass}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <a href="/admin/quizzes" className={ghostButtonClass}>
          Cancel
        </a>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Creating…' : 'Create quiz'}
        </button>
      </div>
    </form>
  )
}

// ─── QuizStatusButtons ──────────────────────────────────────────────────────

const STATUS_ORDER: PublishStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED']
const STATUS_LABEL: Record<PublishStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Publish',
  ARCHIVED: 'Archive',
}

export function QuizStatusButtons({
  quizId,
  currentStatus,
}: {
  quizId: string
  currentStatus: PublishStatus
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function apply(status: PublishStatus) {
    setError(null)
    startTransition(async () => {
      const result: ActionResult = await setQuizStatus({ quizId, status })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((status) => {
          const active = status === currentStatus
          const tone =
            status === 'PUBLISHED' && active
              ? 'border-primary bg-primary/10 text-primary'
              : active
                ? 'border-surface-border bg-surface-muted text-content'
                : 'border-surface-border bg-surface text-content-muted'
          return (
            <button
              key={status}
              type="button"
              disabled={pending}
              onClick={() => apply(status)}
              className={cn(
                'rounded-brand border px-3 py-1.5 text-sm disabled:opacity-50',
                tone,
              )}
            >
              {STATUS_LABEL[status]}
            </button>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── DeleteQuizButton ───────────────────────────────────────────────────────

export function DeleteQuizButton({ quizId }: { quizId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    if (!confirm('Delete this quiz and all its questions? This cannot be undone.')) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result: ActionResult = await deleteQuiz({ quizId })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.push('/admin/quizzes')
    })
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className={dangerButtonClass}
      >
        {pending ? 'Deleting…' : 'Delete quiz'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── QuizEditor ─────────────────────────────────────────────────────────────

export function QuizEditor({ quiz }: { quiz: ViewableQuiz }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [title, setTitle] = useState(quiz.title)
  const [description, setDescription] = useState(quiz.description ?? '')
  const [timeLimitMin, setTimeLimitMin] = useState(
    quiz.timeLimitMin == null ? '' : String(quiz.timeLimitMin),
  )
  const [passPercent, setPassPercent] = useState(String(quiz.passPercent))
  const [maxAttempts, setMaxAttempts] = useState(String(quiz.maxAttempts))
  const [shuffleQuestions, setShuffleQuestions] = useState(quiz.shuffleQuestions)

  function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (title.trim() === '') {
      setError('Title is required.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result: ActionResult<{ quizId: string }> = await saveQuiz({
        quizId: quiz.id,
        title,
        description: description.trim() === '' ? null : description,
        timeLimitMin: timeLimitMin.trim() === '' ? null : Number(timeLimitMin),
        passPercent: Number(passPercent),
        maxAttempts: Number(maxAttempts),
        shuffleQuestions,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="settings-heading" className="space-y-4">
        <h2
          id="settings-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Settings
        </h2>
        <form
          onSubmit={handleSettingsSubmit}
          className="space-y-3 rounded-brand border border-surface-border bg-surface p-4"
        >
          <label className={labelClass}>
            <span className="text-content-muted">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={pending}
              className={inputClass}
            />
          </label>

          <label className={labelClass}>
            <span className="text-content-muted">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={pending}
              className={inputClass}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span className="text-content-muted">Time limit (minutes)</span>
              <input
                type="number"
                min={1}
                step={1}
                value={timeLimitMin}
                onChange={(e) => setTimeLimitMin(e.target.value)}
                placeholder="none"
                disabled={pending}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span className="text-content-muted">Pass percentage</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={passPercent}
                onChange={(e) => setPassPercent(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span className="text-content-muted">Max attempts (0 = unlimited)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </label>

            <label className={cn(labelClass, 'flex items-center gap-2 pt-5')}>
              <input
                type="checkbox"
                checked={shuffleQuestions}
                onChange={(e) => setShuffleQuestions(e.target.checked)}
                disabled={pending}
                className="h-4 w-4 rounded border-surface-border"
              />
              <span className="text-content-muted">Shuffle questions</span>
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={pending} className={buttonClass}>
              {pending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="questions-heading" className="space-y-4">
        <h2
          id="questions-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Questions ({quiz.questions.length})
        </h2>

        {quiz.questions.length === 0 && !addingQuestion && (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No questions yet. Add one to start building the quiz.
          </p>
        )}

        <ul className="space-y-3">
          {quiz.questions.map((question) => (
            <li key={question.id}>
              {editingId === question.id ? (
                <QuestionRow
                  quizId={quiz.id}
                  question={question}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => setEditingId(null)}
                />
              ) : (
                <QuestionSummary
                  question={question}
                  onEdit={() => setEditingId(question.id)}
                />
              )}
            </li>
          ))}
        </ul>

        {addingQuestion ? (
          <QuestionRow
            quizId={quiz.id}
            question={null}
            onCancel={() => setAddingQuestion(false)}
            onSaved={() => setAddingQuestion(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingId(null)
              setAddingQuestion(true)
            }}
            className={buttonClass}
          >
            Add question
          </button>
        )}
      </section>
    </div>
  )
}

// ─── QuestionSummary + QuestionRow ──────────────────────────────────────────

function QuestionSummary({
  question,
  onEdit,
}: {
  question: ViewableQuestion
  onEdit: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    if (!confirm('Delete this question?')) return
    setError(null)
    startTransition(async () => {
      const result: ActionResult = await deleteQuestion({ questionId: question.id })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="rounded-brand border border-surface-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-content-muted">
          {labelForType(question.type)}
        </span>
        <span className="text-xs text-content-muted">· {question.points} pts</span>
        {question.order !== 0 && (
          <span className="text-xs text-content-muted">· order {question.order}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-content">{question.prompt}</p>

      {question.options.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-content-muted">
          {question.options.map((option) => (
            <li key={option.id} className="truncate">
              <span className="text-content-muted/70">○</span> {option.text}
            </li>
          ))}
        </ul>
      )}

      {question.explanation && (
        <p className="mt-2 text-xs text-content-muted/80">
          Explanation: {question.explanation}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className={dangerButtonClass}
        >
          Delete
        </button>
        <button type="button" onClick={onEdit} disabled={pending} className={ghostButtonClass}>
          Edit
        </button>
      </div>
    </div>
  )
}

interface OptionDraft {
  id: string
  text: string
  correct: boolean
}

function QuestionRow({
  quizId,
  question,
  onCancel,
  onSaved,
}: {
  quizId: string
  question: ViewableQuestion | null
  onCancel: () => void
  onSaved: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)

  const [type, setType] = useState<QuestionType>(question?.type ?? 'SINGLE_CHOICE')
  const [prompt, setPrompt] = useState(question?.prompt ?? '')
  const [explanation, setExplanation] = useState(question?.explanation ?? '')
  const [points, setPoints] = useState(String(question?.points ?? 1))
  const [order, setOrder] = useState(String(question?.order ?? 0))

  const hasChoice = type === 'SINGLE_CHOICE' || type === 'MULTI_CHOICE'
  const isTrueFalse = type === 'TRUE_FALSE'

  const [options, setOptions] = useState<OptionDraft[]>(() => {
    if (!question) {
      return [
        { id: 'a', text: '', correct: false },
        { id: 'b', text: '', correct: false },
      ]
    }
    return question.options.map((o) => ({ id: o.id, text: o.text, correct: false }))
  })

  const [correctBool, setCorrectBool] = useState<boolean | null>(
    question?.type === 'TRUE_FALSE' ? false : null,
  )

  const isMulti = type === 'MULTI_CHOICE'

  function patchOption(id: string, patch: Partial<OptionDraft>) {
    setOptions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    )
  }

  function setSingleCorrect(id: string, correct: boolean) {
    setOptions((prev) =>
      prev.map((o) => ({ ...o, correct: o.id === id ? correct : false })),
    )
  }

  function toggleMultiCorrect(id: string, correct: boolean) {
    patchOption(id, { correct })
  }

  function addOption() {
    setOptions((prev) => {
      const n = prev.length
      const id = String.fromCharCode('a'.charCodeAt(0) + n)
      return [...prev, { id, text: '', correct: false }]
    })
  }

  function removeOption(id: string) {
    setOptions((prev) => prev.filter((o) => o.id !== id))
  }

  function handleDelete() {
    if (!question) return
    if (!confirm('Delete this question?')) return
    setError(null)
    setClientError(null)
    startTransition(async () => {
      const result: ActionResult = await deleteQuestion({ questionId: question.id })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.refresh()
      onSaved()
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setClientError(null)
    setError(null)

    if (prompt.trim() === '') {
      setClientError('Question prompt is required.')
      return
    }

    const pointsNum = Number(points)
    if (!Number.isInteger(pointsNum) || pointsNum < 1) {
      setClientError('Points must be a whole number of 1 or more.')
      return
    }

    const orderNum = Number(order)
    const orderVal = Number.isInteger(orderNum) ? orderNum : 0

    const input: QuestionInput = {
      questionId: question?.id,
      type,
      prompt,
      explanation: explanation.trim() === '' ? null : explanation,
      points: pointsNum,
      order: orderVal,
    }

    if (hasChoice) {
      const cleaned = options
        .map((o) => ({ id: o.id.trim(), text: o.text.trim(), correct: o.correct }))
        .filter((o) => o.id !== '' && o.text !== '')
      const seen = new Set<string>()
      const deduped = cleaned.filter((o) =>
        seen.has(o.id) ? false : (seen.add(o.id), true),
      )
      if (deduped.length < 2) {
        setClientError('Choice questions need at least two options.')
        return
      }
      if (!deduped.some((o) => o.correct)) {
        setClientError('Mark at least one option as correct.')
        return
      }
      input.options = deduped.map((o) => ({
        id: o.id,
        text: o.text,
        correct: o.correct,
      }))
    } else if (isTrueFalse) {
      if (correctBool === null) {
        setClientError('Set the correct answer for true/false.')
        return
      }
      input.correctAnswer = { value: correctBool }
    }

    startTransition(async () => {
      const result: ActionResult<{ questionId: string }> = await saveQuestion({
        quizId,
        question: input,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.refresh()
      onSaved()
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-brand border border-surface-border bg-surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span className="text-content-muted">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as QuestionType)}
            disabled={pending}
            className={inputClass}
          >
            <option value="SINGLE_CHOICE">Single choice</option>
            <option value="MULTI_CHOICE">Multi choice</option>
            <option value="TRUE_FALSE">True / False</option>
            <option value="SHORT_ANSWER">Short answer</option>
            <option value="LONG_ANSWER">Long answer</option>
          </select>
        </label>

        <label className={labelClass}>
          <span className="text-content-muted">Points</span>
          <input
            type="number"
            min={1}
            step={1}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          <span className="text-content-muted">Order</span>
          <input
            type="number"
            min={0}
            step={1}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span className="text-content-muted">Prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          required
          disabled={pending}
          className={inputClass}
        />
      </label>

      {hasChoice && (
        <div className={labelClass}>
          <div className="flex items-center justify-between">
            <span className="text-content-muted">Options</span>
            <button
              type="button"
              onClick={addOption}
              disabled={pending}
              className={ghostButtonClass}
            >
              Add option
            </button>
          </div>
          <ul className="space-y-2">
            {options.map((option, index) => (
              <li key={option.id} className="flex items-start gap-2">
                <label className="flex items-center gap-2 pt-1.5 text-xs text-content-muted">
                  <input
                    type={isMulti ? 'checkbox' : 'radio'}
                    name="question-correct"
                    checked={option.correct}
                    onChange={(e) =>
                      isMulti
                        ? toggleMultiCorrect(option.id, e.target.checked)
                        : setSingleCorrect(option.id, e.target.checked)
                    }
                    disabled={pending}
                    className="h-4 w-4 rounded border-surface-border"
                  />
                  correct
                </label>
                <input
                  type="text"
                  value={option.id}
                  onChange={(e) => patchOption(option.id, { id: e.target.value })}
                  disabled={pending}
                  aria-label={`Option ${index + 1} id`}
                  className={cn(inputClass, 'w-16')}
                />
                <input
                  type="text"
                  value={option.text}
                  onChange={(e) => patchOption(option.id, { text: e.target.value })}
                  disabled={pending}
                  aria-label={`Option ${index + 1} text`}
                  className={cn(inputClass, 'flex-1')}
                />
                <button
                  type="button"
                  onClick={() => removeOption(option.id)}
                  disabled={pending}
                  className={dangerButtonClass + ' pt-1.5'}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-content-muted">
            At least two options and one correct.
          </p>
        </div>
      )}

      {isTrueFalse && (
        <div className={labelClass}>
          <span className="text-content-muted">Correct answer</span>
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-content">
              <input
                type="radio"
                name="true-false-correct"
                checked={correctBool === true}
                onChange={() => setCorrectBool(true)}
                disabled={pending}
                className="h-4 w-4 rounded border-surface-border"
              />
              True
            </label>
            <label className="flex items-center gap-2 text-sm text-content">
              <input
                type="radio"
                name="true-false-correct"
                checked={correctBool === false}
                onChange={() => setCorrectBool(false)}
                disabled={pending}
                className="h-4 w-4 rounded border-surface-border"
              />
              False
            </label>
          </div>
        </div>
      )}

      <label className={labelClass}>
        <span className="text-content-muted">Explanation (optional)</span>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={2}
          disabled={pending}
          className={inputClass}
        />
      </label>

      {clientError && (
        <p role="alert" className="text-sm text-danger">
          {clientError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        {question ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className={dangerButtonClass}
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={ghostButtonClass}
          >
            Cancel
          </button>
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? 'Saving…' : 'Save question'}
          </button>
        </div>
      </div>
    </form>
  )
}

function labelForType(type: QuestionType): string {
  switch (type) {
    case 'SINGLE_CHOICE':
      return 'Single choice'
    case 'MULTI_CHOICE':
      return 'Multi choice'
    case 'TRUE_FALSE':
      return 'True / False'
    case 'SHORT_ANSWER':
      return 'Short answer'
    case 'LONG_ANSWER':
      return 'Long answer'
  }
}
