import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  compareNumbers,
  formatDocumentNumber,
  nextDocumentNumber,
  parseDocumentNumber,
  seriesPrefix,
  seriesYear,
} from './numbering'

describe('formatDocumentNumber', () => {
  it('pads to four digits', () => {
    assert.equal(formatDocumentNumber('INVOICE', 2026, 1), 'INV-2026-0001')
    assert.equal(formatDocumentNumber('ORDER', 2026, 42), 'ORD-2026-0042')
  })

  it('does not truncate once a series passes the padding', () => {
    assert.equal(formatDocumentNumber('INVOICE', 2026, 10_000), 'INV-2026-10000')
  })

  it('refuses a zero or fractional sequence', () => {
    assert.throws(() => formatDocumentNumber('INVOICE', 2026, 0), RangeError)
    assert.throws(() => formatDocumentNumber('INVOICE', 2026, 1.5), RangeError)
  })
})

describe('parseDocumentNumber', () => {
  it('round-trips', () => {
    assert.deepEqual(parseDocumentNumber('INV-2026-0007'), {
      kind: 'INVOICE',
      year: 2026,
      sequence: 7,
    })
    assert.deepEqual(parseDocumentNumber('ORD-2025-12345'), {
      kind: 'ORDER',
      year: 2025,
      sequence: 12_345,
    })
  })

  it('rejects anything that is not one of our numbers', () => {
    for (const value of ['', 'INV-2026', 'XYZ-2026-0001', 'INV-26-0001', 'INV-2026-0000', 'inv-2026-0001']) {
      assert.equal(parseDocumentNumber(value), null, value)
    }
  })
})

describe('nextDocumentNumber', () => {
  it('starts a series at one', () => {
    assert.equal(nextDocumentNumber('INVOICE', 2026, null), 'INV-2026-0001')
  })

  it('increments the highest committed number', () => {
    assert.equal(nextDocumentNumber('INVOICE', 2026, 'INV-2026-0041'), 'INV-2026-0042')
  })

  it('crosses the padding width without losing a digit', () => {
    assert.equal(nextDocumentNumber('INVOICE', 2026, 'INV-2026-9999'), 'INV-2026-10000')
  })

  /** A new year restarts at one; the year is part of the series, not a suffix. */
  it('restarts when the year changes', () => {
    assert.equal(nextDocumentNumber('INVOICE', 2027, 'INV-2026-0500'), 'INV-2027-0001')
  })

  it('restarts rather than continuing another kind\'s numbering', () => {
    assert.equal(nextDocumentNumber('INVOICE', 2026, 'ORD-2026-0500'), 'INV-2026-0001')
  })

  it('restarts on an unparseable predecessor, so the unique index catches it', () => {
    assert.equal(nextDocumentNumber('INVOICE', 2026, 'garbage'), 'INV-2026-0001')
  })
})

describe('compareNumbers', () => {
  /**
   * Lexicographic ordering breaks exactly here: "INV-2026-10000" sorts before
   * "INV-2026-9999" as a string. That is why the SQL orders by length first.
   */
  it('orders numerically past the padding width', () => {
    assert.ok(compareNumbers('INV-2026-10000', 'INV-2026-9999') > 0)
    assert.ok('INV-2026-10000' < 'INV-2026-9999', 'the naive string comparison is the wrong one')
  })

  it('orders by year first', () => {
    assert.ok(compareNumbers('INV-2027-0001', 'INV-2026-9999') > 0)
  })

  it('sorts a series into sequence', () => {
    const sorted = ['INV-2026-0010', 'INV-2026-0002', 'INV-2026-10000', 'INV-2026-0001'].sort(
      compareNumbers,
    )
    assert.deepEqual(sorted, [
      'INV-2026-0001',
      'INV-2026-0002',
      'INV-2026-0010',
      'INV-2026-10000',
    ])
  })
})

describe('seriesPrefix', () => {
  it('scopes the SQL LIKE to one kind and one year', () => {
    assert.equal(seriesPrefix('INVOICE', 2026), 'INV-2026-')
    assert.equal(seriesPrefix('ORDER', 2026), 'ORD-2026-')
  })
})

describe('seriesYear', () => {
  /**
   * The rollover this protects: an invoice issued just after midnight on 1
   * January IST is still 31 December in UTC, and numbering it into last year's
   * series files a January invoice at the end of the previous year's books.
   */
  it('reads the year in the org timezone, not UTC', () => {
    const justAfterNewYearIst = new Date('2025-12-31T19:00:00Z') // 1 Jan 00:30 IST
    assert.equal(seriesYear(justAfterNewYearIst, 'Asia/Kolkata'), 2026)
    assert.equal(seriesYear(justAfterNewYearIst, 'UTC'), 2025)
  })

  it('handles a timezone behind UTC at the other end of the year', () => {
    const stillNewYearsEveInNy = new Date('2026-01-01T04:00:00Z') // 31 Dec 23:00 EST
    assert.equal(seriesYear(stillNewYearsEveInNy, 'America/New_York'), 2025)
    assert.equal(seriesYear(stillNewYearsEveInNy, 'UTC'), 2026)
  })
})
