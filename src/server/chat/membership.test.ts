import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type ChannelSubject,
  type ChannelViewer,
  canModerate,
  canPost,
  decideChannelVisibility,
} from './membership'
import type { ChannelType, Role } from '@/generated/prisma/enums'

const ALL_TYPES: readonly ChannelType[] = [
  'GLOBAL',
  'COURSE',
  'BATCH',
  'ANNOUNCEMENT',
  'DIRECT',
  'TOPIC',
]
const STAFF_ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF']

function channel(overrides: Partial<ChannelSubject & { id: string }>): ChannelSubject & {
  id: string
} {
  return {
    id: 'ch-1',
    type: 'TOPIC',
    courseId: null,
    batchId: null,
    archivedAt: null,
    ...overrides,
  }
}

/** canPost additionally needs `readOnly`, which ChannelSubject does not carry. */
function postableChannel(
  overrides: Partial<ChannelSubject & { id: string; readOnly: boolean }>,
): ChannelSubject & { id: string; readOnly: boolean } {
  return {
    id: 'ch-1',
    type: 'TOPIC',
    courseId: null,
    batchId: null,
    archivedAt: null,
    readOnly: false,
    ...overrides,
  }
}

function viewer(overrides: Partial<ChannelViewer> = {}): ChannelViewer {
  return {
    id: 'u1',
    role: 'STUDENT',
    courseIds: ['course-1'],
    batchIds: ['batch-1'],
    memberChannelIds: [],
    ...overrides,
  }
}

const now = new Date('2026-08-02T00:00:00Z')
const future = new Date('2026-09-01T00:00:00Z')

// ─── decideChannelVisibility ────────────────────────────────────────────────

describe('channel visibility — staff bypass', () => {
  for (const role of STAFF_ROLES) {
    it(`lets ${role} see any non-archived channel regardless of membership`, () => {
      for (const type of ALL_TYPES) {
        const subject = channel({ type, courseId: 'course-other', batchId: 'batch-other' })
        const decision = decideChannelVisibility(subject, viewer({ role, memberChannelIds: [] }))
        assert.equal(decision.visible, true, `failed for ${role} on ${type}`)
        assert.equal(decision.visible && decision.via, 'STAFF')
      }
    })
  }
})

describe('channel visibility — GLOBAL', () => {
  const subject = channel({ type: 'GLOBAL' })
  it('is hidden from a signed-out visitor', () => {
    assert.equal(decideChannelVisibility(subject, null).visible, false)
  })
  it('is visible to a signed-in student with no enrollments', () => {
    const v = viewer({ courseIds: [], batchIds: [] })
    assert.equal(decideChannelVisibility(subject, v).visible, true)
  })
  it('is visible to a signed-in student with enrollments', () => {
    assert.equal(decideChannelVisibility(subject, viewer()).visible, true)
  })
})

describe('channel visibility — ANNOUNCEMENT', () => {
  it('with no course is visible to any signed-in student', () => {
    const subject = channel({ type: 'ANNOUNCEMENT', courseId: null })
    assert.equal(
      decideChannelVisibility(subject, viewer({ courseIds: [] })).visible,
      true,
    )
  })
  it('with a course is visible only to students enrolled in that course', () => {
    const subject = channel({ type: 'ANNOUNCEMENT', courseId: 'course-1' })
    assert.equal(decideChannelVisibility(subject, viewer()).visible, true)
    assert.equal(
      decideChannelVisibility(subject, viewer({ courseIds: ['course-other'] })).visible,
      false,
    )
  })
  it('is hidden from signed-out visitors whether or not it has a course', () => {
    assert.equal(decideChannelVisibility(channel({ type: 'ANNOUNCEMENT' }), null).visible, false)
    assert.equal(
      decideChannelVisibility(channel({ type: 'ANNOUNCEMENT', courseId: 'course-1' }), null)
        .visible,
      false,
    )
  })
})

describe('channel visibility — COURSE', () => {
  it('is visible only to students enrolled in that course', () => {
    const subject = channel({ type: 'COURSE', courseId: 'course-1' })
    assert.equal(decideChannelVisibility(subject, viewer()).visible, true)
    assert.equal(
      decideChannelVisibility(subject, viewer({ courseIds: ['course-other'] })).visible,
      false,
    )
  })
  it('with no course is MISCONFIGURED and hidden from students', () => {
    const subject = channel({ type: 'COURSE', courseId: null })
    const decision = decideChannelVisibility(subject, viewer())
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'MISCONFIGURED')
  })
  it('is hidden from signed-out visitors', () => {
    const subject = channel({ type: 'COURSE', courseId: 'course-1' })
    const decision = decideChannelVisibility(subject, null)
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

describe('channel visibility — BATCH', () => {
  it('is visible only to students in that batch', () => {
    const subject = channel({ type: 'BATCH', batchId: 'batch-1' })
    assert.equal(decideChannelVisibility(subject, viewer()).visible, true)
    assert.equal(
      decideChannelVisibility(subject, viewer({ batchIds: ['batch-other'] })).visible,
      false,
    )
  })
  it('with no batch is MISCONFIGURED and hidden from students', () => {
    const subject = channel({ type: 'BATCH', batchId: null })
    const decision = decideChannelVisibility(subject, viewer())
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'MISCONFIGURED')
  })
})

describe('channel visibility — TOPIC and DIRECT', () => {
  for (const type of ['TOPIC', 'DIRECT'] as const) {
    it(`${type} is hidden from a non-member signed-in student`, () => {
      const subject = channel({ type, id: 'ch-1' })
      const decision = decideChannelVisibility(subject, viewer({ memberChannelIds: [] }))
      assert.equal(decision.visible, false)
      assert.equal(decision.visible === false && decision.reason, 'NOT_A_MEMBER')
    })
    it(`${type} is visible to an explicit member`, () => {
      const subject = channel({ type, id: 'ch-1' })
      const decision = decideChannelVisibility(subject, viewer({ memberChannelIds: ['ch-1'] }))
      assert.equal(decision.visible, true)
      assert.equal(decision.visible && decision.via, 'MEMBER')
    })
    it(`${type} is hidden from signed-out visitors`, () => {
      const subject = channel({ type, id: 'ch-1' })
      assert.equal(decideChannelVisibility(subject, null).visible, false)
    })
  }
})

describe('channel visibility — archived', () => {
  it('is hidden from a non-member student', () => {
    const subject = channel({ type: 'TOPIC', id: 'ch-1', archivedAt: future })
    const decision = decideChannelVisibility(subject, viewer({ memberChannelIds: [] }))
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'ARCHIVED')
  })
  it('is visible to staff even when archived', () => {
    const subject = channel({ type: 'TOPIC', id: 'ch-1', archivedAt: future })
    for (const role of STAFF_ROLES) {
      assert.equal(decideChannelVisibility(subject, viewer({ role })).visible, true)
    }
  })
  it('stays visible to a former member so they can read history', () => {
    const subject = channel({ type: 'TOPIC', id: 'ch-1', archivedAt: future })
    const decision = decideChannelVisibility(subject, viewer({ memberChannelIds: ['ch-1'] }))
    assert.equal(decision.visible, true)
    assert.equal(decision.visible && decision.via, 'MEMBER')
  })
  it('hides GLOBAL/COURSE/BATCH/ANNOUNCEMENT from new students once archived', () => {
    for (const type of ['GLOBAL', 'COURSE', 'BATCH', 'ANNOUNCEMENT'] as const) {
      const subject = channel({
        type,
        id: 'ch-1',
        archivedAt: future,
        courseId: 'course-1',
        batchId: 'batch-1',
      })
      const decision = decideChannelVisibility(subject, viewer({ memberChannelIds: [] }))
      assert.equal(decision.visible, false, `${type} should be hidden once archived`)
    }
  })
})

describe('channel visibility — exhaustiveness', () => {
  it('throws on an unhandled channel type', () => {
    const subject = { ...channel({ type: 'GLOBAL' }), type: 'BOGUS' as ChannelType }
    assert.throws(() => decideChannelVisibility(subject, viewer()), /Unhandled channel type/)
  })
})

// ─── canPost ────────────────────────────────────────────────────────────────

describe('canPost — read-only (ANNOUNCEMENT) channels', () => {
  const subject = postableChannel({ type: 'ANNOUNCEMENT', id: 'ch-1', readOnly: true })
  it('lets staff post', () => {
    for (const role of STAFF_ROLES) {
      assert.equal(canPost(subject, viewer({ role }), null, now).canPost, true)
    }
  })
  it('refuses students even if they are members', () => {
    const decision = canPost(subject, viewer(), { role: 'MEMBER', mutedUntil: null }, now)
    assert.equal(decision.canPost, false)
    assert.equal(decision.canPost === false && decision.reason, 'READ_ONLY')
  })
  it('refuses signed-out visitors', () => {
    const decision = canPost(subject, null, null, now)
    assert.equal(decision.canPost, false)
    assert.equal(decision.canPost === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

describe('canPost — archived rooms', () => {
  // Archive freezes the room — even staff cannot add to it. Reopening requires
  // the explicit `unarchiveChannel` action rather than a post sneaking in, so
  // the moderation console is the only entry point to a writable state again.
  it('refuses everyone, including staff, with reason ARCHIVED', () => {
    const subject = postableChannel({ type: 'TOPIC', id: 'ch-1', readOnly: false, archivedAt: future })
    const studentDecision = canPost(subject, viewer(), { role: 'MEMBER', mutedUntil: null }, now)
    const ownerDecision = canPost(
      subject,
      viewer({ role: 'OWNER' }),
      { role: 'MEMBER', mutedUntil: null },
      now,
    )
    assert.equal(studentDecision.canPost, false)
    assert.equal(ownerDecision.canPost, false)
    if (ownerDecision.canPost === false) {
      assert.equal(ownerDecision.reason, 'ARCHIVED')
    } else {
      assert.fail('expected owner to be blocked')
    }
  })
})

describe('canPost — muted students', () => {
  const subject = postableChannel({ type: 'TOPIC', id: 'ch-1', readOnly: false })
  it('lets a member post when not muted', () => {
    const v = viewer({ memberChannelIds: ['ch-1'] })
    assert.equal(canPost(subject, v, { role: 'MEMBER', mutedUntil: null }, now).canPost, true)
  })
  it('refuses a member muted until a future date', () => {
    const v = viewer({ memberChannelIds: ['ch-1'] })
    const decision = canPost(subject, v, { role: 'MEMBER', mutedUntil: future }, now)
    assert.equal(decision.canPost, false)
    assert.equal(decision.canPost === false && decision.reason, 'MUTED')
  })
  it('lets a muted member post after the mute expires', () => {
    const v = viewer({ memberChannelIds: ['ch-1'] })
    const past = new Date(now.getTime() - 1000)
    assert.equal(canPost(subject, v, { role: 'MEMBER', mutedUntil: past }, now).canPost, true)
  })
  it('does not mute staff — they administer mutes', () => {
    const v = viewer({ role: 'INSTRUCTOR', memberChannelIds: ['ch-1'] })
    assert.equal(
      canPost(subject, v, { role: 'MODERATOR', mutedUntil: future }, now).canPost,
      true,
    )
  })
})

describe('canPost — non-readonly membership rooms', () => {
  it('lets a GLOBAL student post without an explicit membership row', () => {
    const subject = postableChannel({ type: 'GLOBAL', id: 'ch-1', readOnly: false })
    assert.equal(canPost(subject, viewer(), null, now).canPost, true)
  })
  it('lets a COURSE student post only if enrolled in the channel course', () => {
    const subject = postableChannel({
      type: 'COURSE',
      id: 'ch-1',
      courseId: 'course-1',
      readOnly: false,
    })
    assert.equal(canPost(subject, viewer(), null, now).canPost, true)
    assert.equal(
      canPost(subject, viewer({ courseIds: ['course-other'] }), null, now).canPost,
      false,
    )
  })
  it('lets a BATCH student post only if in the channel batch', () => {
    const subject = postableChannel({
      type: 'BATCH',
      id: 'ch-1',
      batchId: 'batch-1',
      readOnly: false,
    })
    assert.equal(canPost(subject, viewer(), null, now).canPost, true)
    assert.equal(
      canPost(subject, viewer({ batchIds: ['batch-other'] }), null, now).canPost,
      false,
    )
  })
  it('forces TOPIC/DIRECT to require explicit membership', () => {
    const subject = postableChannel({ type: 'TOPIC', id: 'ch-1', readOnly: false })
    assert.equal(
      canPost(subject, viewer({ memberChannelIds: [] }), null, now).canPost,
      false,
    )
    assert.equal(
      canPost(subject, viewer({ memberChannelIds: ['ch-1'] }), null, now).canPost,
      true,
    )
  })
})

// ─── canModerate ─────────────────────────────────────────────────────────────

describe('canModerate', () => {
  it('is true for every role that holds the chat:moderate permission', () => {
    for (const role of ['OWNER', 'ADMIN', 'INSTRUCTOR'] as const) {
      assert.equal(canModerate(viewer({ role }), null), true, `${role} should moderate`)
    }
  })
  it('is false for a plain STUDENT without membership', () => {
    assert.equal(canModerate(viewer({ role: 'STUDENT' }), null), false)
  })
  it('is true for a student who holds the MODERATOR channel role', () => {
    assert.equal(
      canModerate(viewer({ role: 'STUDENT' }), { role: 'MODERATOR' }),
      true,
    )
  })
  it('is false for a student who is a MEMBER on the channel', () => {
    assert.equal(
      canModerate(viewer({ role: 'STUDENT' }), { role: 'MEMBER' }),
      false,
    )
  })
  it('is false for an unauthenticated viewer', () => {
    assert.equal(canModerate(null, null), false)
  })
  // Staff carries chat:moderate; STAFF is the ops role without it today, so this
  // pins that contract: if STAFF is later granted chat:moderate this test will
  // break loudly and someone will confirm the change rather than miss it.
  it('is currently false for the STAFF role', () => {
    assert.equal(canModerate(viewer({ role: 'STAFF' }), null), false)
  })
})
