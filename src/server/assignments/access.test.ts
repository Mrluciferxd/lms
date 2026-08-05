import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type AssignmentSubject,
  type AssignmentViewer,
  decideAssignmentVisibility,
  decideCanGrade,
  decideCanSubmit,
} from './access'
import type { PublishStatus, Role, SubmissionStatus } from '@/generated/prisma/enums'

const STAFF_ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF']
const ALL_PUBLISH_STATUSES: readonly PublishStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED']
const ALL_SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'RESUBMIT_REQUESTED',
  'GRADED',
]

function assignment(overrides: Partial<AssignmentSubject> = {}): AssignmentSubject {
  return { status: 'PUBLISHED', courseId: 'course-1', batchId: null, ...overrides }
}

function viewer(overrides: Partial<AssignmentViewer> = {}): AssignmentViewer {
  return {
    id: 'u1',
    role: 'STUDENT',
    courseIds: ['course-1'],
    batchIds: ['batch-1'],
    canManage: false,
    canGrade: false,
    ...overrides,
  }
}

const now = new Date('2026-08-02T09:00:00Z')
const future = new Date('2026-09-01T00:00:00Z')
const past = new Date('2026-07-01T00:00:00Z')

// ─── decideAssignmentVisibility ────────────────────────────────────────────

describe('assignment visibility — staff bypass', () => {
  for (const role of STAFF_ROLES) {
    it(`lets ${role} see any assignment regardless of publish state or scope`, () => {
      for (const status of ALL_PUBLISH_STATUSES) {
        const subject = assignment({ status, courseId: null, batchId: null })
        const decision = decideAssignmentVisibility(subject, viewer({ role }))
        assert.equal(decision.visible, true, `failed for ${role} on ${status}`)
        assert.equal(decision.visible && decision.via, 'STAFF')
      }
    })
  }
})

describe('assignment visibility — DRAFT and ARCHIVED', () => {
  it('hides a DRAFT assignment from a student even if they are enrolled', () => {
    const subject = assignment({ status: 'DRAFT', courseId: 'course-1' })
    const decision = decideAssignmentVisibility(subject, viewer())
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_PUBLISHED')
  })
  it('hides an ARCHIVED assignment from a student (the cohort has finished)', () => {
    const subject = assignment({ status: 'ARCHIVED', courseId: 'course-1' })
    assert.equal(decideAssignmentVisibility(subject, viewer()).visible, false)
  })
  it('hides a DRAFT or ARCHIVED assignment from signed-out visitors', () => {
    assert.equal(
      decideAssignmentVisibility(assignment({ status: 'DRAFT' }), null).visible,
      false,
    )
    assert.equal(
      decideAssignmentVisibility(assignment({ status: 'ARCHIVED' }), null).visible,
      false,
    )
  })
})

describe('assignment visibility — PUBLISHED, course-scoped', () => {
  const subject = assignment({ status: 'PUBLISHED', courseId: 'course-1' })
  it('is visible to a student enrolled in that course', () => {
    const decision = decideAssignmentVisibility(subject, viewer())
    assert.equal(decision.visible, true)
    assert.equal(decision.visible && decision.via, 'ENROLLMENT')
  })
  it('is hidden from a student enrolled only in a different course', () => {
    const decision = decideAssignmentVisibility(subject, viewer({ courseIds: ['course-other'] }))
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_ENROLLED')
  })
  it('is hidden from a signed-out visitor', () => {
    const decision = decideAssignmentVisibility(subject, null)
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

describe('assignment visibility — PUBLISHED, batch-scoped', () => {
  const subject = assignment({ status: 'PUBLISHED', courseId: 'course-1', batchId: 'batch-1' })
  it('is visible to a student in that batch', () => {
    const decision = decideAssignmentVisibility(subject, viewer())
    assert.equal(decision.visible, true)
    assert.equal(decision.visible && decision.via, 'BATCH')
  })
  it('hides from a student enrolled in the course but in a different batch', () => {
    // Batch narrows over course — deadlined cohort work is the point.
    const decision = decideAssignmentVisibility(
      subject,
      viewer({ courseIds: ['course-1'], batchIds: ['batch-other'] }),
    )
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_IN_BATCH')
  })
  it('hides from a student enrolled in the course with no batch at all', () => {
    const decision = decideAssignmentVisibility(
      subject,
      viewer({ courseIds: ['course-1'], batchIds: [] }),
    )
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_IN_BATCH')
  })
})

describe('assignment visibility — no scope', () => {
  it('returns NO_SCOPE for a student when neither course nor batch is attached', () => {
    const subject = assignment({ status: 'PUBLISHED', courseId: null, batchId: null })
    const decision = decideAssignmentVisibility(subject, viewer())
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NO_SCOPE')
  })
})

// ─── decideCanSubmit ─────────────────────────────────────────────────────────

describe('canSubmit — visibility prerequisites', () => {
  it('refuses a signed-out viewer', () => {
    const subject = assignment({ status: 'PUBLISHED', courseId: 'course-1' })
    const decision = decideCanSubmit(
      { ...subject, dueAt: null, allowLateSubmission: true },
      null,
      null,
      now,
    )
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'NOT_AUTHENTICATED')
  })
  it('refuses a DRAFT assignment', () => {
    const subject = assignment({ status: 'DRAFT', courseId: 'course-1' })
    const decision = decideCanSubmit(
      { ...subject, dueAt: null, allowLateSubmission: true },
      null,
      viewer(),
      now,
    )
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'NOT_PUBLISHED')
  })
  it('refuses a student not enrolled in the course', () => {
    const subject = assignment({ status: 'PUBLISHED', courseId: 'course-1' })
    const decision = decideCanSubmit(
      { ...subject, dueAt: null, allowLateSubmission: true },
      null,
      viewer({ courseIds: ['course-other'] }),
      now,
    )
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'NOT_ENROLLED')
  })
  it('refuses a student not in the batch when the assignment is batch-scoped', () => {
    const subject = assignment({
      status: 'PUBLISHED',
      courseId: 'course-1',
      batchId: 'batch-1',
    })
    const decision = decideCanSubmit(
      { ...subject, dueAt: null, allowLateSubmission: true },
      null,
      viewer({ courseIds: ['course-1'], batchIds: ['batch-other'] }),
      now,
    )
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'NOT_IN_BATCH')
  })
  it('refuses with NO_SCOPE when neither course nor batch is attached', () => {
    const subject = assignment({ status: 'PUBLISHED', courseId: null, batchId: null })
    const decision = decideCanSubmit(
      { ...subject, dueAt: null, allowLateSubmission: true },
      null,
      viewer(),
      now,
    )
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'NO_SCOPE')
  })
})

describe('canSubmit — late policy at the boundary', () => {
  const baseSubject = {
    status: 'PUBLISHED' as const,
    courseId: 'course-1' as const,
    batchId: null as string | null,
  }
  it('lets a student submit before the due date', () => {
    const decision = decideCanSubmit(
      { ...baseSubject, dueAt: future, allowLateSubmission: false },
      null,
      viewer(),
      now,
    )
    assert.equal(decision.canSubmit, true)
  })
  it('refuses submission past due when late submission is disabled', () => {
    const decision = decideCanSubmit(
      { ...baseSubject, dueAt: past, allowLateSubmission: false },
      null,
      viewer(),
      now,
    )
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'PAST_DUE_NO_LATE')
  })
  it('lets a student submit past due when late submission is allowed', () => {
    const decision = decideCanSubmit(
      { ...baseSubject, dueAt: past, allowLateSubmission: true },
      null,
      viewer(),
      now,
    )
    assert.equal(decision.canSubmit, true)
  })
  it('treats a null dueAt as no deadline — late policy never triggers', () => {
    const decision = decideCanSubmit(
      { ...baseSubject, dueAt: null, allowLateSubmission: false },
      null,
      viewer(),
      now,
    )
    assert.equal(decision.canSubmit, true)
  })
})

describe('canSubmit — lifecycle of an existing submission', () => {
  const subject = {
    status: 'PUBLISHED' as const,
    courseId: 'course-1' as const,
    batchId: null as string | null,
    dueAt: null,
    allowLateSubmission: true,
  }

  it('lets a student submit when no submission exists yet', () => {
    const decision = decideCanSubmit(subject, null, viewer(), now)
    assert.equal(decision.canSubmit, true)
  })
  it('lets a student re-submit a DRAFT (mid-write)', () => {
    const decision = decideCanSubmit(subject, { status: 'DRAFT' }, viewer(), now)
    assert.equal(decision.canSubmit, true)
  })
  it('lets a student re-submit a RESUBMIT_REQUESTED row after the grader returned it', () => {
    const decision = decideCanSubmit(subject, { status: 'RESUBMIT_REQUESTED' }, viewer(), now)
    assert.equal(decision.canSubmit, true)
  })
  it('refuses to re-submit a SUBMITTED row the grader is reviewing', () => {
    const decision = decideCanSubmit(subject, { status: 'SUBMITTED' }, viewer(), now)
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'RESUBMIT_NOT_REQUESTED')
  })
  it('refuses to re-submit a GRADED row — the grader reopens it', () => {
    const decision = decideCanSubmit(subject, { status: 'GRADED' }, viewer(), now)
    assert.equal(decision.canSubmit, false)
    assert.equal(decision.canSubmit === false && decision.reason, 'ALREADY_GRADED')
  })
})

// ─── decideCanGrade ──────────────────────────────────────────────────────────

describe('canGrade — role matrix', () => {
  it('is true for roles holding assignment:grade', () => {
    for (const role of ['OWNER', 'ADMIN', 'INSTRUCTOR'] as const) {
      assert.equal(
        decideCanGrade(viewer({ role, canGrade: true }), { userId: 'someone-else' }),
        true,
        `${role} should grade`,
      )
    }
  })
  it('is false for a STUDENT regardless of who the submission belongs to', () => {
    assert.equal(decideCanGrade(viewer({ role: 'STUDENT' }), { userId: 'someone-else' }), false)
  })
  it('is false for a viewer with canGrade=false even on someone else submission', () => {
    assert.equal(
      decideCanGrade(viewer({ role: 'INSTRUCTOR', canGrade: false }), { userId: 'other' }),
      false,
    )
  })
  it('refuses a grader grading their own submission', () => {
    // The role split is the load-bearing invariant here — an authoring grader
    // grading themselves would be the one path through which maxScore gets set
    // by the person who wrote the answer. This is the test that pins it.
    assert.equal(
      decideCanGrade(viewer({ role: 'INSTRUCTOR', canGrade: true, id: 'u1' }), { userId: 'u1' }),
      false,
    )
  })
  it('is false for an unauthenticated viewer', () => {
    assert.equal(decideCanGrade(null, { userId: 'other' }), false)
  })
  it('is false for a null submission', () => {
    assert.equal(decideCanGrade(viewer({ role: 'INSTRUCTOR', canGrade: true }), null), false)
  })
})

// ─── exhaustiveness ─────────────────────────────────────────────────────────

describe('submission status coverage', () => {
  it('decideCanSubmit handles every SubmissionStatus without throwing', () => {
    const subject = {
      status: 'PUBLISHED' as const,
      courseId: 'course-1' as const,
      batchId: null as string | null,
      dueAt: null,
      allowLateSubmission: true,
    }
    for (const status of ALL_SUBMISSION_STATUSES) {
      const decision = decideCanSubmit(subject, { status }, viewer(), now)
      // No throw is the property; the result is asserted in dedicated tests above.
      assert.ok(typeof decision.canSubmit === 'boolean')
    }
  })
})
