/**
 * Invoice issuance.
 *
 * The numbering guarantee — sequential per year, no gaps, no collisions under
 * concurrency — and the reasoning behind it live in ./numbering.ts. This module
 * is the thin transactional wrapper that makes the guarantee hold: the number is
 * allocated and the row is written inside the same transaction, which is the
 * whole basis of the no-gap claim.
 *
 * Issuance is idempotent on `Invoice.orderId` (unique in the schema). A webhook
 * retry, a checkout callback arriving after the webhook, and an operator marking
 * an order paid by hand all converge here and all get the same invoice.
 */

import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { allocateDocumentNumber, seriesYear } from './numbering'

export interface IssuedInvoice {
  id: string
  number: string
  issuedAt: Date
}

/**
 * Issues the invoice for a paid order, or returns the one already issued.
 *
 * Callers should treat a failure here as non-fatal to the payment: the money has
 * moved and the enrollment is credited by the time this runs. An order without an
 * invoice shows up in the admin order list as such and can be reissued, which is
 * a better failure than rolling back an enrollment over a document.
 */
export async function issueInvoice(orderId: string): Promise<IssuedInvoice> {
  const settings = await getOrgSettings()
  const issuedAt = new Date()
  const year = seriesYear(issuedAt, settings.timezone)

  return db.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { orderId },
      select: { id: true, number: true, issuedAt: true },
    })
    if (existing) return existing

    const number = await allocateDocumentNumber(tx, 'INVOICE', year)

    // Re-check under the lock. Two settlements for one order serialise here, and
    // the second must return the first's invoice rather than fail on the unique
    // constraint — a retried webhook is a normal event, not an error.
    const raced = await tx.invoice.findUnique({
      where: { orderId },
      select: { id: true, number: true, issuedAt: true },
    })
    if (raced) return raced

    return tx.invoice.create({
      data: { orderId, number, issuedAt },
      select: { id: true, number: true, issuedAt: true },
    })
  })
}
