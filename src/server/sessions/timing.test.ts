import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type TimedSession,
  attendanceOpen,
  canJoin,
  effectiveEnd,
  sessionPhase,
} from './timing'

const MINUTE = 60_000
const START = new Date('2026-07-26T13:30:00Z')

function session(overrides: Partial<TimedSession> = {}): TimedSession {
  return {
    status: 'SCHEDULED',
    scheduledStart: START,
    scheduledEnd: new Date(START.getTime() + 90 * MINUTE),
    actualEnd: null,
    ...overrides,
  }
}

function at(offsetMin: number): Date {
  return new Date(START.getTime() + offsetMin * MINUTE)
}

describe('sessionPhase', () => {
  it('is upcoming well before the start', () => {
    assert.equal(sessionPhase(session(), at(-60)), 'UPCOMING')
  })

  it('becomes joinable 15 minutes before the start', () => {
    assert.equal(sessionPhase(session(), at(-16)), 'UPCOMING')
    assert.equal(sessionPhase(session(), at(-15)), 'JOINABLE')
  })

  it('stays joinable through the scheduled window when nobody pressed start', () => {
    assert.equal(sessionPhase(session(), at(45)), 'JOINABLE')
  })

  it('ends once the scheduled end has passed', () => {
    assert.equal(sessionPhase(session(), at(91)), 'ENDED')
  })

  it('reports LIVE past the scheduled end — classes overrun', () => {
    assert.equal(sessionPhase(session({ status: 'LIVE' }), at(200)), 'LIVE')
  })

  it('treats an actual end as over even while the status says LIVE', () => {
    // The instructor's "end" click is more reliable than the status field, which
    // a failed update may have left behind.
    const ended = session({ status: 'LIVE', actualEnd: at(80) })
    assert.equal(sessionPhase(ended, at(85)), 'ENDED')
  })

  it('reports cancelled regardless of the clock', () => {
    for (const offset of [-60, 0, 500]) {
      assert.equal(sessionPhase(session({ status: 'CANCELLED' }), at(offset)), 'CANCELLED')
    }
  })
})

describe('effectiveEnd', () => {
  it('prefers the actual end', () => {
    assert.equal(effectiveEnd(session({ actualEnd: at(70) })).toISOString(), at(70).toISOString())
  })

  it('falls back to an assumed duration when no end was set', () => {
    // Without this a session with no end time stays joinable forever.
    assert.equal(
      effectiveEnd(session({ scheduledEnd: null })).toISOString(),
      at(60).toISOString(),
    )
  })
})

describe('canJoin', () => {
  it('is closed before the doors open and after the session ends', () => {
    assert.equal(canJoin(session(), at(-30)), false)
    assert.equal(canJoin(session(), at(120)), false)
  })

  it('is open in the window and while live', () => {
    assert.equal(canJoin(session(), at(-5)), true)
    assert.equal(canJoin(session({ status: 'LIVE' }), at(300)), true)
  })

  it('is closed for a cancelled session even during its slot', () => {
    assert.equal(canJoin(session({ status: 'CANCELLED' }), at(10)), false)
  })
})

describe('attendanceOpen', () => {
  it('opens with the doors rather than at the end', () => {
    assert.equal(attendanceOpen({ ...session(), tracksAttendance: true }, at(-10)), true)
  })

  it('stays open after the session has ended, for late marking', () => {
    assert.equal(attendanceOpen({ ...session(), tracksAttendance: true }, at(600)), true)
  })

  it('is closed before the doors open', () => {
    assert.equal(attendanceOpen({ ...session(), tracksAttendance: true }, at(-120)), false)
  })

  it('is closed for a session that does not track attendance', () => {
    assert.equal(attendanceOpen({ ...session(), tracksAttendance: false }, at(30)), false)
  })

  it('is closed for a cancelled class', () => {
    const cancelled = { ...session({ status: 'CANCELLED' }), tracksAttendance: true }
    assert.equal(attendanceOpen(cancelled, at(30)), false)
  })
})
