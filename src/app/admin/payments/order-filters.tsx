'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { OrderStatus } from '@/generated/prisma/enums'

/**
 * Filters live in the URL rather than in component state, so an operator can
 * bookmark "everything that failed this week" and paste it into a message to
 * whoever needs to look at it.
 */
export function OrderFilters({
  statuses,
  status,
  query,
}: {
  statuses: OrderStatus[]
  status: OrderStatus | null
  query: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [draft, setDraft] = useState(query)

  function apply(next: { status?: string | null; q?: string | null }): void {
    const params = new URLSearchParams(searchParams.toString())

    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    // Any filter change invalidates the page cursor.
    params.delete('page')

    router.push(`/admin/payments?${params.toString()}`)
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={() => apply({ q: draft, status })}
    >
      <div className="min-w-[16rem] flex-1">
        <Input
          label="Search"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Order number, gateway id, student name or email"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="status" className="block text-sm font-medium text-content">
          Status
        </label>
        <select
          id="status"
          name="status"
          value={status ?? ''}
          onChange={(event) => apply({ status: event.target.value || null, q: draft })}
          className="h-10 rounded-brand border border-surface-border bg-surface px-3 text-sm text-content"
        >
          <option value="">All</option>
          {statuses.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary">
        Apply
      </Button>

      {(status || query) && (
        <Button
          variant="ghost"
          onClick={() => {
            setDraft('')
            apply({ status: null, q: null })
          }}
        >
          Clear
        </Button>
      )}
    </form>
  )
}
