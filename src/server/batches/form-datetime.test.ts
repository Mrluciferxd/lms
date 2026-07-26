import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toLocalDateInput, toLocalDateTimeInput } from './form-datetime'

const IST = 'Asia/Kolkata'

describe('toLocalDateTimeInput', () => {
  it('renders the org wall clock, not UTC', () => {
    // 13:30 UTC is the 19:00 IST class. Showing 13:30 in the form would move it
    // by five and a half hours on the next save.
    assert.equal(toLocalDateTimeInput(new Date('2026-07-27T13:30:00Z'), IST), '2026-07-27T19:00')
  })

  it('rolls the date over when the local day differs from the UTC day', () => {
    assert.equal(toLocalDateTimeInput(new Date('2026-07-27T20:00:00Z'), IST), '2026-07-28T01:30')
  })

  it('renders an absent date as an empty field', () => {
    assert.equal(toLocalDateTimeInput(null, IST), '')
  })
})

describe('toLocalDateInput', () => {
  it('uses the local calendar day', () => {
    // Batch start dates are stored as local midnight; in UTC that is the
    // previous evening, and a naive slice would show the day before.
    assert.equal(toLocalDateInput(new Date('2026-07-31T18:30:00Z'), IST), '2026-08-01')
  })

  it('renders an absent date as an empty field', () => {
    assert.equal(toLocalDateInput(null, IST), '')
  })
})
