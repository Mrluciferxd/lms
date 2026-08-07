'use client'

import { useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import { startAttempt, submitAttempt, type ActionResult } from '@/server/quizzes/actions'
import type { ViewableQuestion, ViewableQuiz } from '@/server/quizzes/quizzes'
import type { QuestionType } from '@/generated/prisma/enums'
import type React from 'react'

interface QuizTakerProps {
  quiz: ViewableQuiz
}

const inputClass =
  'block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm text-content outline-none focus:border-primary disabled:opacity-50'
const buttonClass =
  'rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50'

export function QuizTaker({ quiz }: QuizTakerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [phase, setPhase] = useState<'idle' | 'taking' | 'result'>('idle')
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [responses, setResponses] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    passed: boolean | null
    score: number
    maxScore: number
  } | null>(null)

  const questions = useState<ViewableQuestion[]>(() =>
    quiz.shuffleQuestions ? shuffleOnce(quiz.questions) : [...quiz.questions],
  )[0]

  function handleStart() {
    setError(null)
    startTransition(async () => {
      const res: ActionResult<{ attemptId: string }> = await startAttempt({ quizId: quiz.id })
      if (!res.ok) {
        setError(res.reason)
        return
      }
      setAttemptId(res.data!.attemptId)
      setPhase('taking')
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!attemptId) return

    for (const question of questions) {
      if (!isAnswered(question, responses[question.id])) {
        setError('Please answer all questions.')
        return
      }
    }
    setError(null)

    startTransition(async () => {
      const res: ActionResult<{
        passed: boolean | null
        score: number
        maxScore: number
      }> = await submitAttempt({ attemptId, responses })
      if (!res.ok) {
        setError(res.reason)
        return
      }
      setResult(res.data!)
      setPhase('result')
      router.refresh()
    })
  }

  if (phase === 'result' && result) {
    return (
      <div className="space-y-4 rounded-brand border border-surface-border bg-surface p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-content">Your result</h2>
          <p className="text-sm text-content-muted">
            {result.score} / {result.maxScore}
          </p>
          <p className="text-sm text-content">
            {result.passed === null
              ? 'Pending grade — subjective answers await review.'
              : result.passed
                ? 'Passed'
                : 'Did not pass'}
          </p>
        </div>
        <div>
          <Link
            href="/app/quizzes"
            className="inline-block text-sm font-medium text-primary underline"
          >
            Back to quizzes
          </Link>
        </div>
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <div className="space-y-4 rounded-brand border border-surface-border bg-surface p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium uppercase tracking-wide text-content-muted">
            {quiz.title}
          </h2>
          <p className="text-sm text-content-muted">
            {quiz.questions.length} {quiz.questions.length === 1 ? 'question' : 'questions'}
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className={buttonClass}
          >
            {pending ? 'Starting…' : 'Start attempt'}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-brand border border-surface-border bg-surface p-4">
      <div className="space-y-3">
        {questions.map((question, index) => (
          <QuestionField
            key={question.id}
            question={question}
            index={index}
            value={responses[question.id]}
            disabled={pending}
            onChange={(value) =>
              setResponses((prev) => ({ ...prev, [question.id]: value }))
            }
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </form>
  )
}

function QuestionField({
  question,
  index,
  value,
  disabled,
  onChange,
}: {
  question: ViewableQuestion
  index: number
  value: unknown
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  return (
    <fieldset className="space-y-2 rounded-brand border border-surface-border bg-surface-muted p-3">
      <legend className="text-sm font-medium text-content">
        {index + 1}. {question.prompt}
      </legend>
      <QuestionInput
        type={question.type}
        options={question.options}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </fieldset>
  )
}

function QuestionInput({
  type,
  options,
  value,
  disabled,
  onChange,
}: {
  type: QuestionType
  options: { id: string; text: string }[]
  value: unknown
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  switch (type) {
    case 'SINGLE_CHOICE':
      return (
        <div className="space-y-1">
          {options.map((option) => (
            <label
              key={option.id}
              className={cn(
                'flex items-center gap-2 rounded-brand border px-3 py-1.5 text-sm',
                value === option.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-surface-border text-content',
              )}
            >
              <input
                type="radio"
                name={options[0]?.id ? `sc-${option.id}` : 'sc'}
                checked={value === option.id}
                onChange={() => onChange(option.id)}
                disabled={disabled}
                className="h-4 w-4"
              />
              {option.text}
            </label>
          ))}
        </div>
      )
    case 'MULTI_CHOICE': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="space-y-1">
          {options.map((option) => {
            const checked = selected.includes(option.id)
            return (
              <label
                key={option.id}
                className={cn(
                  'flex items-center gap-2 rounded-brand border px-3 py-1.5 text-sm',
                  checked
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-surface-border text-content',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? Array.from(new Set([...selected, option.id]))
                        : selected.filter((v) => v !== option.id),
                    )
                  }
                  disabled={disabled}
                  className="h-4 w-4 rounded border-surface-border"
                />
                {option.text}
              </label>
            )
          })}
        </div>
      )
    }
    case 'TRUE_FALSE':
      return (
        <div className="space-y-1">
          {[
            { label: 'True', val: true },
            { label: 'False', val: false },
          ].map((opt) => (
            <label
              key={opt.label}
              className={cn(
                'flex items-center gap-2 rounded-brand border px-3 py-1.5 text-sm',
                value === opt.val
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-surface-border text-content',
              )}
            >
              <input
                type="radio"
                name="tf"
                checked={value === opt.val}
                onChange={() => onChange(opt.val)}
                disabled={disabled}
                className="h-4 w-4"
              />
              {opt.label}
            </label>
          ))}
        </div>
      )
    case 'SHORT_ANSWER':
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={inputClass}
        />
      )
    case 'LONG_ANSWER':
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={4}
          className={inputClass}
        />
      )
  }
}

function isAnswered(question: ViewableQuestion, value: unknown): boolean {
  switch (question.type) {
    case 'SINGLE_CHOICE':
      return typeof value === 'string' && value !== ''
    case 'MULTI_CHOICE':
      return Array.isArray(value) && value.length > 0
    case 'TRUE_FALSE':
      return typeof value === 'boolean'
    case 'SHORT_ANSWER':
    case 'LONG_ANSWER':
      return typeof value === 'string' && value.trim() !== ''
  }
}

function shuffleOnce<T>(input: T[]): T[] {
  const out = [...input]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i] as T
    const b = out[j] as T
    out[i] = b
    out[j] = a
  }
  return out
}
