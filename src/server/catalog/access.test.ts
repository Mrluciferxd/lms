import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type AccessEnrollment, type AccessInput, decideAccess } from './access'
import type { ReleaseRule } from '@/server/batches/release'
import type { Role } from '@/generated/prisma/enums'

const NOW = new Date('2026-07-26T12:00:00Z')

const IMMEDIATE: ReleaseRule = {
  mode: 'IMMEDIATE',
  offsetDays: null,
  releaseAt: null,
  manuallyReleasedAt: null,
  gateSession: null,
}

function enrollment(overrides: Partial<AccessEnrollment> = {}): AccessEnrollment {
  return {
    status: 'ACTIVE',
    enrolledAt: new Date('2026-07-01T00:00:00Z'),
    startsAt: null,
    expiresAt: null,
    batchStartDate: null,
    ...overrides,
  }
}

function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    courseStatus: 'PUBLISHED',
    isPreviewLesson: false,
    viewer: { id: 'u1', role: 'STUDENT' },
    enrollment: enrollment(),
    release: IMMEDIATE,
    now: NOW,
    ...overrides,
  }
}

describe('publish state', () => {
  for (const status of ['DRAFT', 'ARCHIVED'] as const) {
    it(`hides a ${status} course from students as NOT_FOUND, not a permission error`, () => {
      const decision = decideAccess(input({ courseStatus: status }))
      assert.equal(decision.allowed, false)
      // 404 rather than 403: the existence of unreleased content is not disclosed.
      assert.equal(decision.allowed === false && decision.reason, 'NOT_FOUND')
    })
  }

  it('lets staff view a draft course', () => {
    const decision = decideAccess(
      input({ courseStatus: 'DRAFT', viewer: { id: 'a1', role: 'ADMIN' }, enrollment: null }),
    )
    assert.equal(decision.allowed, true)
  })
})

describe('staff bypass', () => {
  const staffRoles: Role[] = ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF']

  for (const role of staffRoles) {
    it(`grants ${role} access without enrollment and past drip`, () => {
      const decision = decideAccess(
        input({
          viewer: { id: 's1', role },
          enrollment: null,
          release: { ...IMMEDIATE, mode: 'MANUAL' },
        }),
      )
      assert.equal(decision.allowed, true)
      assert.equal(decision.allowed && decision.via, 'STAFF')
    })
  }

  it('does not extend that bypass to students', () => {
    const decision = decideAccess(
      input({ viewer: { id: 'u1', role: 'STUDENT' }, release: { ...IMMEDIATE, mode: 'MANUAL' } }),
    )
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'NOT_RELEASED')
  })
})

describe('preview lessons', () => {
  it('are reachable with no account at all', () => {
    const decision = decideAccess(
      input({ isPreviewLesson: true, viewer: null, enrollment: null }),
    )
    assert.equal(decision.allowed, true)
    assert.equal(decision.allowed && decision.via, 'PREVIEW')
  })

  it('are still hidden on an unpublished course', () => {
    const decision = decideAccess(
      input({ isPreviewLesson: true, viewer: null, enrollment: null, courseStatus: 'DRAFT' }),
    )
    assert.equal(decision.allowed, false)
  })

  /** A preview flag must not become a bypass for the rest of the course. */
  it('do not grant access to non-preview lessons', () => {
    const decision = decideAccess(input({ isPreviewLesson: false, viewer: null, enrollment: null }))
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

describe('enrollment lifecycle', () => {
  it('allows ACTIVE', () => {
    assert.equal(decideAccess(input()).allowed, true)
  })

  /**
   * Finishing a course must not revoke the library — time limits are expressed
   * through expiresAt, not by flipping status.
   */
  it('allows COMPLETED', () => {
    const decision = decideAccess(input({ enrollment: enrollment({ status: 'COMPLETED' }) }))
    assert.equal(decision.allowed, true)
  })

  it('denies PENDING, where payment has not settled', () => {
    const decision = decideAccess(input({ enrollment: enrollment({ status: 'PENDING' }) }))
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'NOT_ENROLLED')
  })

  it('denies CANCELLED', () => {
    const decision = decideAccess(input({ enrollment: enrollment({ status: 'CANCELLED' }) }))
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'NOT_ENROLLED')
  })

  it('distinguishes PAUSED as inactive rather than unenrolled', () => {
    const decision = decideAccess(input({ enrollment: enrollment({ status: 'PAUSED' }) }))
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'ENROLLMENT_INACTIVE')
  })

  it('denies EXPIRED', () => {
    const decision = decideAccess(input({ enrollment: enrollment({ status: 'EXPIRED' }) }))
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'ENROLLMENT_EXPIRED')
  })

  it('denies when there is no enrollment', () => {
    const decision = decideAccess(input({ enrollment: null }))
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'NOT_ENROLLED')
  })
})

describe('time-limited access', () => {
  /**
   * Checked independently of status, because the nightly job that flips ACTIVE to
   * EXPIRED may not have run. Relying on status alone would grant a window of
   * free access after expiry.
   */
  it('denies a past expiry even while status is still ACTIVE', () => {
    const decision = decideAccess(
      input({
        enrollment: enrollment({ status: 'ACTIVE', expiresAt: new Date('2026-07-25T00:00:00Z') }),
      }),
    )
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'ENROLLMENT_EXPIRED')
  })

  it('allows a future expiry', () => {
    const decision = decideAccess(
      input({ enrollment: enrollment({ expiresAt: new Date('2026-12-31T00:00:00Z') }) }),
    )
    assert.equal(decision.allowed, true)
  })

  it('treats access starting in the future as inactive', () => {
    const decision = decideAccess(
      input({ enrollment: enrollment({ startsAt: new Date('2026-08-01T00:00:00Z') }) }),
    )
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'ENROLLMENT_INACTIVE')
  })
})

describe('drip is applied last, and only to students', () => {
  it('denies an unreleased lesson and returns the release detail for the UI', () => {
    const decision = decideAccess(
      input({
        release: { ...IMMEDIATE, mode: 'DAYS_AFTER_ENROLLMENT', offsetDays: 60 },
      }),
    )
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.reason, 'NOT_RELEASED')
    assert.equal(decision.allowed === false && decision.release?.reason, 'NOT_YET')
    assert.ok(decision.allowed === false && decision.release?.releasesAt)
  })

  it('allows a released lesson', () => {
    const decision = decideAccess(
      input({ release: { ...IMMEDIATE, mode: 'DAYS_AFTER_ENROLLMENT', offsetDays: 7 } }),
    )
    assert.equal(decision.allowed, true)
    assert.equal(decision.allowed && decision.via, 'ENROLLMENT')
  })

  /**
   * Ordering matters: an expired enrollment must report expiry, not "not
   * released". The security reason has to win over the pacing reason, otherwise
   * the message tells a lapsed student to wait rather than to renew.
   */
  it('reports enrollment problems in preference to drip', () => {
    const decision = decideAccess(
      input({
        enrollment: enrollment({ expiresAt: new Date('2026-01-01T00:00:00Z') }),
        release: { ...IMMEDIATE, mode: 'MANUAL' },
      }),
    )
    assert.equal(decision.allowed === false && decision.reason, 'ENROLLMENT_EXPIRED')
  })

  it('applies the batch anchor from the enrollment', () => {
    const decision = decideAccess(
      input({
        enrollment: enrollment({ batchStartDate: new Date('2026-07-24T00:00:00Z') }),
        release: { ...IMMEDIATE, mode: 'DAYS_AFTER_BATCH_START', offsetDays: 14 },
      }),
    )
    assert.equal(decision.allowed, false)
    assert.equal(decision.allowed === false && decision.release?.reason, 'NOT_YET')
  })
})

describe('unauthenticated viewers', () => {
  it('are denied non-preview lessons even on a published course', () => {
    const decision = decideAccess(input({ viewer: null, enrollment: null }))
    assert.equal(decision.allowed === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})
