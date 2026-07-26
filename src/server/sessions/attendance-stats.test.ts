import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatAttendancePercent, isBelowThreshold, tallyAttendance } from './attendance-stats'

describe('tallyAttendance', () => {
  it('counts LATE as attended', () => {
    const tally = tallyAttendance(['PRESENT', 'LATE', 'ABSENT'], 3)
    assert.equal(tally.attended, 2)
    assert.equal(tally.late, 1)
    assert.equal(tally.percent, 67)
  })

  it('removes EXCUSED from the denominator entirely', () => {
    // 8 present, 2 excused: an approved absence must not reduce the figure that
    // approval was granted to protect.
    const tally = tallyAttendance(
      [...Array<'PRESENT'>(8).fill('PRESENT'), 'EXCUSED', 'EXCUSED'],
      10,
    )
    assert.equal(tally.countable, 8)
    assert.equal(tally.percent, 100)
    assert.equal(tally.excused, 2)
  })

  it('excludes unmarked sessions but reports how many there are', () => {
    // Two of ten classes had a register taken. The student is at 50% of what was
    // marked, with the eight-session gap visible to whoever reads the report.
    const tally = tallyAttendance(['PRESENT', 'ABSENT'], 10)
    assert.equal(tally.unmarked, 8)
    assert.equal(tally.countable, 2)
    assert.equal(tally.percent, 50)
  })

  it('returns null rather than 0% when nothing has been marked', () => {
    const tally = tallyAttendance([], 6)
    assert.equal(tally.percent, null)
    assert.equal(tally.unmarked, 6)
  })

  it('returns null when every record is excused', () => {
    // Denominator is zero, so there is no percentage to state.
    assert.equal(tallyAttendance(['EXCUSED', 'EXCUSED'], 2).percent, null)
  })

  it('reports 0% for a student marked absent throughout', () => {
    const tally = tallyAttendance(['ABSENT', 'ABSENT'], 2)
    assert.equal(tally.percent, 0)
    assert.equal(tally.countable, 2)
  })

  it('never reports negative unmarked when more records exist than expected', () => {
    // Reachable when a session stops tracking attendance after being marked.
    const tally = tallyAttendance(['PRESENT', 'PRESENT'], 1)
    assert.equal(tally.unmarked, 0)
    assert.equal(tally.expected, 2)
  })

  it('reports expected as marked plus unmarked', () => {
    const tally = tallyAttendance(['PRESENT', 'EXCUSED'], 9)
    assert.equal(tally.expected, 9)
    assert.equal(tally.unmarked, 7)
  })

  it('rounds to the nearest whole percent', () => {
    assert.equal(tallyAttendance(['PRESENT', 'PRESENT', 'ABSENT'], 3).percent, 67)
    assert.equal(tallyAttendance(['PRESENT', 'ABSENT', 'ABSENT'], 3).percent, 33)
  })
})

describe('formatAttendancePercent', () => {
  it('renders an unknown percentage as a dash, not a zero', () => {
    assert.equal(formatAttendancePercent(null), '—')
    assert.equal(formatAttendancePercent(0), '0%')
  })
})

describe('isBelowThreshold', () => {
  it('flags a student under the threshold', () => {
    assert.equal(isBelowThreshold(tallyAttendance(['PRESENT', 'ABSENT'], 2), 75), true)
  })

  it('does not flag a student with nothing marked yet', () => {
    // Otherwise every student in a new cohort shows as at risk, and the flag
    // stops meaning anything.
    assert.equal(isBelowThreshold(tallyAttendance([], 5), 75), false)
  })

  it('treats exactly the threshold as acceptable', () => {
    const tally = tallyAttendance(['PRESENT', 'PRESENT', 'PRESENT', 'ABSENT'], 4)
    assert.equal(tally.percent, 75)
    assert.equal(isBelowThreshold(tally, 75), false)
  })
})
