import type { Metadata } from 'next'
import Link from 'next/link'

import { formatDate, formatMoney } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { CouponList, type AdminCoupon } from './coupon-list'

export const metadata: Metadata = { title: 'Discount codes' }

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone suffix. */
function toDatetimeLocal(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 16) : null
}

export default async function AdminCouponsPage() {
  await requirePermission('payment:manage', '/admin/coupons')
  const settings = await getOrgSettings()

  const [coupons, courses] = await Promise.all([
    db.coupon.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        maxRedemptions: true,
        usedCount: true,
        minOrderMinor: true,
        validFrom: true,
        validTo: true,
        courseIds: true,
        active: true,
        _count: { select: { orders: true } },
      },
    }),
    db.course.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true },
    }),
  ])

  const money = (amountMinor: number) =>
    formatMoney(amountMinor, settings.currency, settings.locale)

  /**
   * Windows are rendered in the org timezone here rather than in the client
   * component: a coupon that expires at midnight on the 31st does so on the
   * academy's clock, and formatting it in the viewer's browser would tell a
   * student in another country the wrong day.
   */
  function windowLabel(validFrom: Date | null, validTo: Date | null): string | null {
    const from = validFrom ? formatDate(validFrom, settings.timezone, settings.locale) : null
    const to = validTo ? formatDate(validTo, settings.timezone, settings.locale) : null

    if (from && to) return `${from} — ${to}`
    if (from) return `From ${from}`
    if (to) return `Until ${to}`
    return null
  }

  const rows: AdminCoupon[] = coupons.map((coupon) => ({
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    // Percent is stored as a percent; a flat discount is minor units and the form
    // takes rupees.
    value: coupon.type === 'PERCENT' ? coupon.value : coupon.value / 100,
    valueLabel: coupon.type === 'PERCENT' ? `${coupon.value}%` : money(coupon.value),
    maxRedemptions: coupon.maxRedemptions,
    minOrder: coupon.minOrderMinor !== null ? coupon.minOrderMinor / 100 : null,
    minOrderLabel: coupon.minOrderMinor !== null ? money(coupon.minOrderMinor) : null,
    validFrom: toDatetimeLocal(coupon.validFrom),
    validTo: toDatetimeLocal(coupon.validTo),
    windowLabel: windowLabel(coupon.validFrom, coupon.validTo),
    courseIds: coupon.courseIds,
    active: coupon.active,
    usedCount: coupon.usedCount,
    orderCount: coupon._count.orders,
  }))

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/payments" className="text-content-muted hover:text-content">
          ← Payments
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-content">Discount codes</h1>
        <p className="mt-1 text-sm text-content-muted">
          Redemptions are counted when an order is paid, so an abandoned checkout never uses one up.
        </p>
      </div>

      <CouponList coupons={rows} courses={courses} />
    </div>
  )
}
