'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/server/catalog/actions'
import { CourseForm } from './course-form'

/**
 * Collapsed by default so the course list stays the focus. Client-side because
 * the disclosure state and the post-create navigation are interactive.
 */
export function NewCourseSection({
  action,
}: {
  action: (formData: FormData) => Promise<ActionResult>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New course
      </Button>
    )
  }

  return (
    <section
      aria-labelledby="new-course-heading"
      className="space-y-4 rounded-brand border border-surface-border p-4"
    >
      <div className="flex items-center justify-between">
        <h2 id="new-course-heading" className="text-sm font-semibold text-content">
          New course
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      <CourseForm
        action={action}
        submitLabel="Create course"
        onSaved={(id) => {
          if (id) router.push(`/admin/courses/${id}`)
        }}
      />
    </section>
  )
}
