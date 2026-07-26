import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type SessionViewer,
  type VisibilitySubject,
  decideSessionVisibility,
} from './visibility'
import type { Role, SessionVisibility } from '@/generated/prisma/enums'

const ALL_VISIBILITIES: readonly SessionVisibility[] = ['PUBLIC', 'ENROLLED', 'BATCH', 'ROLE']
const STAFF_ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF']

function session(overrides: Partial<VisibilitySubject> = {}): VisibilitySubject {
  return { visibility: 'BATCH', batchId: 'batch-1', courseId: 'course-1', ...overrides }
}

function student(overrides: Partial<SessionViewer> = {}): SessionViewer {
  return {
    id: 'u1',
    role: 'STUDENT',
    courseIds: ['course-1'],
    batchIds: ['batch-1'],
    ...overrides,
  }
}

describe('PUBLIC', () => {
  it('is visible to a signed-out visitor', () => {
    const decision = decideSessionVisibility(session({ visibility: 'PUBLIC' }), null)
    assert.equal(decision.visible, true)
    assert.equal(decision.visible && decision.via, 'PUBLIC')
  })

  it('is visible to a student with no enrollments at all', () => {
    const decision = decideSessionVisibility(
      session({ visibility: 'PUBLIC' }),
      student({ courseIds: [], batchIds: [] }),
    )
    assert.equal(decision.visible, true)
  })
})

describe('ENROLLED', () => {
  const enrolledSession = session({ visibility: 'ENROLLED', batchId: null })

  it('is hidden from a signed-out visitor', () => {
    const decision = decideSessionVisibility(enrolledSession, null)
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHENTICATED')
  })

  it('is visible to a student enrolled in that course', () => {
    const decision = decideSessionVisibility(enrolledSession, student())
    assert.equal(decision.visible, true)
    assert.equal(decision.visible && decision.via, 'ENROLLMENT')
  })

  it('is hidden from a student enrolled only in a different course', () => {
    const decision = decideSessionVisibility(
      enrolledSession,
      student({ courseIds: ['course-other'] }),
    )
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_ENROLLED')
  })

  it('with no course attached, reaches any enrolled student', () => {
    // Academy-wide broadcast: "enrolled students" with no course narrowing.
    const decision = decideSessionVisibility(
      session({ visibility: 'ENROLLED', courseId: null, batchId: null }),
      student({ courseIds: ['course-unrelated'] }),
    )
    assert.equal(decision.visible, true)
  })

  it('with no course attached, still excludes someone with no enrollment', () => {
    const decision = decideSessionVisibility(
      session({ visibility: 'ENROLLED', courseId: null, batchId: null }),
      student({ courseIds: [], batchIds: [] }),
    )
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_ENROLLED')
  })
})

describe('BATCH', () => {
  it('is visible to a student in that batch', () => {
    const decision = decideSessionVisibility(session(), student())
    assert.equal(decision.visible, true)
    assert.equal(decision.visible && decision.via, 'BATCH')
  })

  it('is hidden from a student on the same course but a different batch', () => {
    // The case that matters: same course, later cohort, must not see this class.
    const decision = decideSessionVisibility(session(), student({ batchIds: ['batch-2'] }))
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_IN_BATCH')
  })

  it('is hidden from a self-paced student with no batch', () => {
    const decision = decideSessionVisibility(session(), student({ batchIds: [] }))
    assert.equal(decision.visible, false)
  })

  it('is hidden from a signed-out visitor', () => {
    assert.equal(decideSessionVisibility(session(), null).visible, false)
  })

  it('stays hidden, with a warning, when no batch is attached', () => {
    const decision = decideSessionVisibility(session({ batchId: null }), student())
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'MISCONFIGURED')
    assert.ok(decision.visible === false && decision.warning)
  })
})

describe('ROLE', () => {
  it('is hidden from students — no column names the roles, so it is staff-only', () => {
    const decision = decideSessionVisibility(session({ visibility: 'ROLE' }), student())
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'STAFF_ONLY')
  })

  it('is hidden from a signed-out visitor', () => {
    const decision = decideSessionVisibility(session({ visibility: 'ROLE' }), null)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHENTICATED')
  })

  it('is visible to staff', () => {
    const decision = decideSessionVisibility(
      session({ visibility: 'ROLE' }),
      student({ role: 'INSTRUCTOR' }),
    )
    assert.equal(decision.visible, true)
  })
})

describe('staff bypass', () => {
  for (const role of STAFF_ROLES) {
    for (const visibility of ALL_VISIBILITIES) {
      it(`lets ${role} see a ${visibility} session with no enrollment`, () => {
        const decision = decideSessionVisibility(
          session({ visibility, batchId: null, courseId: null }),
          { id: 's1', role, courseIds: [], batchIds: [] },
        )
        assert.equal(decision.visible, true)
        assert.equal(decision.visible && decision.via, 'STAFF')
      })
    }
  }

  it('does not extend that bypass to students', () => {
    for (const visibility of ALL_VISIBILITIES.filter((value) => value !== 'PUBLIC')) {
      const decision = decideSessionVisibility(session({ visibility }), student({ batchIds: [], courseIds: [] }))
      assert.equal(decision.visible, false, `${visibility} leaked to a student`)
    }
  })
})

describe('exhaustiveness', () => {
  it('decides every visibility mode without throwing', () => {
    // The switch has a `never` guard, so a newly added mode fails the build. This
    // asserts the runtime side of the same contract.
    for (const visibility of ALL_VISIBILITIES) {
      assert.doesNotThrow(() => decideSessionVisibility(session({ visibility }), student()))
      assert.doesNotThrow(() => decideSessionVisibility(session({ visibility }), null))
    }
  })
})
