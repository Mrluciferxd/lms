'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/server/catalog/actions'

export function AddSectionForm({
  action,
}: {
  action: (formData: FormData) => Promise<ActionResult>
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      ref={formRef}
      action={(formData) => {
        startTransition(async () => {
          const outcome = await action(formData)
          setResult(outcome)
          if (outcome.ok) {
            // Clear so the next section can be added without re-selecting.
            formRef.current?.reset()
            router.refresh()
          }
        })
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-[16rem] flex-1">
        <Input
          label="New section title"
          name="title"
          required
          error={result?.fieldErrors?.title ?? (result?.ok === false ? result.error : undefined)}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Adding…' : 'Add section'}
      </Button>
    </form>
  )
}
