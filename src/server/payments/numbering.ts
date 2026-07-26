/**
 * Sequential document numbers for orders and invoices.
 *
 * ── THE REQUIREMENT ──────────────────────────────────────────────────────────
 * Invoice numbers must be sequential per year with **no gaps and no collisions**,
 * concurrently. Gaps are not a cosmetic concern: a tax auditor reading
 * INV-2026-0007 followed by INV-2026-0009 asks what happened to 0008, and
 * "our checkout crashed" is not an answer that ends the conversation.
 *
 * ── WHY NOT A POSTGRES SEQUENCE ──────────────────────────────────────────────
 * A sequence is the obvious tool and it is the wrong one here, twice over.
 * `nextval` is explicitly non-transactional — it does not roll back — so every
 * abandoned transaction burns a number and leaves exactly the gap this has to
 * avoid. And a per-year sequence needs DDL each January, which on a white-label
 * product means N client databases needing a migration on a date nobody diarised.
 *
 * ── WHAT THIS DOES INSTEAD ───────────────────────────────────────────────────
 * Allocation and insertion happen in one transaction, under a Postgres advisory
 * lock keyed on (document kind, year):
 *
 *   1. `pg_advisory_xact_lock(kind, year)` — held until the transaction ends,
 *      released automatically on commit *or* rollback, including if the process
 *      dies. There is no lock to leak.
 *   2. Read the highest committed number in that year's series.
 *   3. Insert the row carrying `max + 1`.
 *
 * Correctness follows from two properties:
 *
 *   **No collisions.** Step 2 and step 3 are inside the lock, so no two
 *   transactions can read the same maximum and both commit. The `@unique` on
 *   `number` is the backstop: if a future caller allocates outside this function,
 *   Postgres refuses the write rather than silently duplicating an invoice number.
 *
 *   **No gaps.** The number is derived from committed rows, so a transaction that
 *   rolls back leaves the maximum unchanged and the next allocation reuses the
 *   number it did not commit. This is precisely the property a sequence cannot
 *   offer, and it is why the read is a `MAX` rather than a counter.
 *
 * ── THE COST, STATED HONESTLY ────────────────────────────────────────────────
 * Invoice issuance for a given year is serialised. That is a hard ceiling of
 * roughly one invoice per round-trip to the database, which for a cohort academy
 * issuing thousands of invoices a year is several orders of magnitude of
 * headroom. If a deployment ever outgrows it, the fix is batching, not a
 * sequence — the gapless requirement does not go away.
 *
 * Order numbers use the same machinery for collision safety. Gaps in *order*
 * numbers are expected and fine — an abandoned checkout is a real order that was
 * never paid — so they are allocated on a separate lock key and never block
 * invoice issuance.
 */

import { Prisma } from '@/generated/prisma/client'
import { formatDate } from '@/lib/utils'

export type DocumentKind = 'ORDER' | 'INVOICE'

/**
 * Advisory-lock keys. Arbitrary but they must stay stable for the life of a
 * deployment and must not collide with any other advisory lock in this database.
 * Nothing else in the codebase takes one today.
 */
const LOCK_KEY: Record<DocumentKind, number> = {
  ORDER: 74_100_001,
  INVOICE: 74_100_002,
}

const PREFIX: Record<DocumentKind, string> = {
  ORDER: 'ORD',
  INVOICE: 'INV',
}

/** Table each series lives in. Literal union — never interpolated from input. */
const TABLE: Record<DocumentKind, 'Order' | 'Invoice'> = {
  ORDER: 'Order',
  INVOICE: 'Invoice',
}

/** Zero padding. Wider numbers still sort correctly — see `compareNumbers`. */
const PAD_WIDTH = 4

export function seriesPrefix(kind: DocumentKind, year: number): string {
  return `${PREFIX[kind]}-${year}-`
}

/**
 * The series year an instant belongs to, read in the org timezone.
 *
 * An invoice issued at 02:00 on 1 January in Asia/Kolkata is 31 December in UTC.
 * Numbering it into the previous year's series would file a January invoice at
 * the end of last year's books — a reconciliation problem that surfaces once a
 * year, in the week nobody wants to be debugging it.
 */
export function seriesYear(instant: Date, timezone: string): number {
  const year = Number(formatDate(instant, timezone, 'en-US', { year: 'numeric' }))
  if (!Number.isSafeInteger(year)) {
    throw new RangeError(`Could not resolve a document year in timezone "${timezone}".`)
  }
  return year
}

export function formatDocumentNumber(kind: DocumentKind, year: number, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError(`Document sequence must be a positive integer, got ${sequence}.`)
  }
  return `${seriesPrefix(kind, year)}${String(sequence).padStart(PAD_WIDTH, '0')}`
}

export interface ParsedDocumentNumber {
  kind: DocumentKind
  year: number
  sequence: number
}

export function parseDocumentNumber(value: string): ParsedDocumentNumber | null {
  const match = /^(ORD|INV)-(\d{4})-(\d+)$/.exec(value)
  if (!match) return null

  const kind: DocumentKind = match[1] === 'ORD' ? 'ORDER' : 'INVOICE'
  const year = Number(match[2] ?? '')
  const sequence = Number(match[3] ?? '')
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null

  return { kind, year, sequence }
}

/**
 * Next number in a series given the highest one already committed.
 *
 * A `latest` that does not parse is treated as "series is empty" and restarts at
 * 1. That cannot happen through this module — the SQL filters on the series
 * prefix — and if it ever does, colliding on a unique constraint is a better
 * failure than silently continuing someone else's numbering.
 */
export function nextDocumentNumber(
  kind: DocumentKind,
  year: number,
  latest: string | null,
): string {
  const parsed = latest ? parseDocumentNumber(latest) : null
  const sequence = parsed && parsed.kind === kind && parsed.year === year ? parsed.sequence + 1 : 1
  return formatDocumentNumber(kind, year, sequence)
}

/**
 * Numeric ordering over zero-padded numbers, for tests and in-memory sorting.
 * `INV-2026-10000` is greater than `INV-2026-9999` even though it sorts lower
 * lexicographically, which is why the SQL below orders by length first.
 */
export function compareNumbers(a: string, b: string): number {
  const left = parseDocumentNumber(a)
  const right = parseDocumentNumber(b)
  if (!left || !right) return a.localeCompare(b)
  return left.year - right.year || left.sequence - right.sequence
}

/**
 * Allocates the next number in a series. MUST be called inside an interactive
 * transaction that also writes the row — the no-gap guarantee is exactly the
 * claim that allocation and insertion share a transaction.
 */
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  kind: DocumentKind,
  year: number,
): Promise<string> {
  // Two-int form: (classid, objid). Both are cast explicitly because a bind
  // parameter of unknown type will not resolve the int4 overload on its own.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY[kind]}::int4, ${year}::int4)`

  /**
   * Raw because Prisma cannot express `ORDER BY length(...)`, and that ordering
   * is what makes this numerically correct once a series passes 9,999: with a
   * fixed-width pad, a longer number is always a larger one, and equal lengths
   * compare lexicographically the same way they compare numerically.
   */
  const rows = await tx.$queryRaw<Array<{ number: string }>>`
    SELECT "number"
    FROM ${Prisma.raw(`"${TABLE[kind]}"`)}
    WHERE "number" LIKE ${`${seriesPrefix(kind, year)}%`}
    ORDER BY length("number") DESC, "number" DESC
    LIMIT 1
  `

  return nextDocumentNumber(kind, year, rows[0]?.number ?? null)
}
