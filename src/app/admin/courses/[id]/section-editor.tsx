'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  createLesson,
  deleteLesson,
  reorderLesson,
  setManualRelease,
  updateLesson,
} from '@/server/catalog/actions'
import { LessonForm, type LessonFormValues, type SessionOption } from './lesson-form'

export interface AdminLesson extends LessonFormValues {
  id: string
  order: number
  progressCount: number
  manuallyReleased: boolean
  assetStatus: string | null
}

const MODE_LABELS: Record<string, string> = {
  IMMEDIATE: 'Immediate',
  DAYS_AFTER_ENROLLMENT: 'After enrollment',
  DAYS_AFTER_BATCH_START: 'After batch start',
  FIXED_DATE: 'Fixed date',
  AFTER_SESSION: 'After session',
  MANUAL: 'Manual',
}

export function SectionEditor({
  sectionId,
  title,
  lessons,
  sessions,
}: {
  sectionId: string
  title: string
  lessons: AdminLesson[]
  sessions: SessionOption[]
}) {
  const router = useRouter()
  const [addingLesson, setAddingLesson] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work()
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-brand border border-surface-border p-4">
      <h3 className="text-sm font-semibold text-content">{title}</h3>

      {notice && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {notice}
        </p>
      )}

      {lessons.length === 0 ? (
        <p className="text-sm text-content-muted">No lessons in this section yet.</p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {lessons.map((lesson, index) => (
            <li key={lesson.id} className="py-2">
              {editingId === lesson.id ? (
                <LessonForm
                  action={(formData) => updateLesson(lesson.id, formData)}
                  initial={lesson}
                  sessions={sessions}
                  submitLabel="Save lesson"
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-content">{lesson.title}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
                      <span>{lesson.type}</span>
                      <span aria-hidden>·</span>
                      <span>{MODE_LABELS[lesson.releaseMode] ?? lesson.releaseMode}</span>
                      {lesson.isPreview && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="text-primary">preview</span>
                        </>
                      )}
                      {lesson.videoAssetId && lesson.assetStatus !== 'READY' && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="text-warning">video {lesson.assetStatus}</span>
                        </>
                      )}
                      {lesson.progressCount > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{lesson.progressCount} watching</span>
                        </>
                      )}
                    </span>
                  </span>

                  {lesson.releaseMode === 'MANUAL' && (
                    <Button
                      variant={lesson.manuallyReleased ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={() =>
                        run(() => setManualRelease(lesson.id, !lesson.manuallyReleased))
                      }
                    >
                      {lesson.manuallyReleased ? 'Unrelease' : 'Release'}
                    </Button>
                  )}

                  <Button variant="ghost" size="sm" onClick={() => setEditingId(lesson.id)}>
                    Edit
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    aria-label={`Move ${lesson.title} up`}
                    onClick={() => run(() => reorderLesson(lesson.id, 'up'))}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === lessons.length - 1}
                    aria-label={`Move ${lesson.title} down`}
                    onClick={() => run(() => reorderLesson(lesson.id, 'down'))}
                  >
                    ↓
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => run(() => deleteLesson(lesson.id))}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {addingLesson ? (
        <div className="rounded-brand bg-surface-muted p-3">
          <LessonForm
            action={(formData) => createLesson(sectionId, formData)}
            sessions={sessions}
            submitLabel="Add lesson"
            onDone={() => setAddingLesson(false)}
          />
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAddingLesson(true)}>
          Add lesson
        </Button>
      )}
    </section>
  )
}
