'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  createCoupon,
  deleteCoupon,
  setCouponActive,
  updateCoupon,
} from '@/server/payments/actions'
import { CouponForm, type CourseOption, type CouponFormValues } from './coupon-form'

export interface AdminCoupon extends CouponFormValues {
  id: string
  usedCount: number
  /** Preformatted in the org currency; the pure layer never formats money. */
  valueLabel: string
  minOrderLabel: string | null
  windowLabel: string | null
  orderCount: number
}

export function CouponList({
  coupons,
  courses,
}: {
  coupons: AdminCoupon[]
  courses: CourseOption[]
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; error?: string }>): void {
    startTransition(async () => {
      const result = await work()
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {notice && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {notice}
        </p>
      )}

      {coupons.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No discount codes yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {coupons.map((coupon) => (
            <li key={coupon.id} className="rounded-brand border border-surface-border p-4">
              {editingId === coupon.id ? (
                <CouponForm
                  action={(formData) => updateCoupon(coupon.id, formData)}
                  initial={coupon}
                  courses={courses}
                  submitLabel="Save code"
                  onDone={() => {
                    setEditingId(null)
                    router.refresh()
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-mono text-sm font-semibold text-content">
                      {coupon.code}
                      {!coupon.active && (
                        <span className="ml-2 rounded bg-surface-muted px-2 py-0.5 font-sans text-xs font-medium text-content-muted">
                          Inactive
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-content-muted">
                      {coupon.valueLabel} off
                      {coupon.minOrderLabel && ` · min ${coupon.minOrderLabel}`}
                      {coupon.courseIds.length > 0
                        ? ` · ${coupon.courseIds.length} course(s)`
                        : ' · all courses'}
                    </p>
                    {coupon.windowLabel && (
                      <p className="text-xs text-content-muted">{coupon.windowLabel}</p>
                    )}
                    <p className="text-xs text-content-muted">
                      Redeemed {coupon.usedCount}
                      {coupon.maxRedemptions !== null && ` of ${coupon.maxRedemptions}`} ·{' '}
                      {coupon.orderCount} order(s)
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingId(coupon.id)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => run(() => setCouponActive(coupon.id, !coupon.active))}
                    >
                      {coupon.active ? 'Deactivate' : 'Activate'}
                    </Button>
                    {/* Deleting is refused server-side once a code has been used;
                        the button is hidden here so the refusal is rare rather
                        than the normal outcome of clicking it. */}
                    {coupon.usedCount === 0 && coupon.orderCount === 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => run(() => deleteCoupon(coupon.id))}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <section
          aria-labelledby="new-coupon-heading"
          className="space-y-4 rounded-brand border border-surface-border p-4"
        >
          <h2 id="new-coupon-heading" className="text-sm font-semibold text-content">
            New discount code
          </h2>
          <CouponForm
            action={createCoupon}
            courses={courses}
            submitLabel="Create code"
            onDone={() => {
              setCreating(false)
              router.refresh()
            }}
          />
        </section>
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          New discount code
        </Button>
      )}
    </div>
  )
}
