import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SEAT_OCCUPYING, describeSeats, seatState } from './capacity'

describe('seatState', () => {
  it('reports remaining seats below capacity', () => {
    const state = seatState(18, 20)
    assert.equal(state.remaining, 2)
    assert.equal(state.full, false)
    assert.equal(state.overSubscribed, false)
    assert.equal(state.percentFull, 90)
  })

  it('is full at exactly capacity', () => {
    const state = seatState(20, 20)
    assert.equal(state.full, true)
    assert.equal(state.remaining, 0)
    assert.equal(state.overSubscribed, false)
  })

  it('flags over-subscription rather than reporting negative seats', () => {
    const state = seatState(23, 20)
    assert.equal(state.remaining, 0)
    assert.equal(state.overSubscribed, true)
    // Capped so a progress bar cannot overflow its track.
    assert.equal(state.percentFull, 100)
  })

  it('treats a null capacity as uncapped', () => {
    const state = seatState(400, null)
    assert.equal(state.full, false)
    assert.equal(state.remaining, null)
    assert.equal(state.percentFull, null)
  })

  it('treats a zero capacity as uncapped rather than permanently full', () => {
    // 0 reaches here from an admin clearing the field; locking every enrollment
    // out would be a worse reading of "no limit set".
    assert.equal(seatState(5, 0).full, false)
  })
})

describe('SEAT_OCCUPYING', () => {
  it('excludes departed students so a seat can be resold', () => {
    assert.equal(SEAT_OCCUPYING.includes('CANCELLED'), false)
    assert.equal(SEAT_OCCUPYING.includes('EXPIRED'), false)
  })

  it('counts students who have not paid yet', () => {
    // A PENDING enrollment is a held seat: the student is mid-checkout.
    assert.equal(SEAT_OCCUPYING.includes('PENDING'), true)
  })
})

describe('describeSeats', () => {
  it('omits the denominator when uncapped', () => {
    assert.equal(describeSeats(seatState(7, null)), '7 enrolled')
    assert.equal(describeSeats(seatState(7, 30)), '7 / 30 seats')
  })
})
