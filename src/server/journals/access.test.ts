import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  decideCanAuthor,
  decideCanComment,
  decideEntryVisibility,
  decideJournalVisibility,
  type JournalDefinitionSubject,
  type JournalEntrySubject,
  type JournalViewer,
} from './access'
import type { JournalVisibility, Role } from '@/generated/prisma/enums'

const STAFF_ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF']

function definition(
  overrides: Partial<JournalDefinitionSubject> = {},
): JournalDefinitionSubject {
  return {
    enabled: true,
    studentAuthored: true,
    ...overrides,
  }
}

function viewer(overrides: Partial<JournalViewer> = {}): JournalViewer {
  return {
    id: 'u1',
    role: 'STUDENT',
    canReview: false,
    canDefine: false,
    batchIds: ['batch-1'],
    ...overrides,
  }
}

function entry(
  overrides: Partial<JournalEntrySubject>,
): JournalEntrySubject {
  return {
    authorId: 'u-author',
    visibility: 'PRIVATE',
    batchId: null,
    ...overrides,
  }
}

// ─── decideJournalVisibility ────────────────────────────────────────────────

describe('journal visibility — enabled journals', () => {
  it('is visible to a signed-in student', () => {
    assert.equal(decideJournalVisibility(definition(), viewer()).visible, true)
  })
  it('is visible to a signed-in staff member', () => {
    for (const role of STAFF_ROLES) {
      assert.equal(
        decideJournalVisibility(definition(), viewer({ role })).visible,
        true,
        `failed for ${role}`,
      )
    }
  })
  it('is hidden from a signed-out visitor', () => {
    const decision = decideJournalVisibility(definition(), null)
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

describe('journal visibility — disabled journals', () => {
  it('is hidden from everyone, including staff', () => {
    for (const role of STAFF_ROLES) {
      const decision = decideJournalVisibility(definition({ enabled: false }), viewer({ role }))
      assert.equal(decision.visible, false, `failed for ${role}`)
      assert.equal(decision.visible === false && decision.reason, 'JOURNAL_DISABLED')
    }
  })
  it('is hidden from a signed-out visitor', () => {
    const decision = decideJournalVisibility(definition({ enabled: false }), null)
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'JOURNAL_DISABLED')
  })
})

// ─── decideCanAuthor ────────────────────────────────────────────────────────

describe('decideCanAuthor — student-authored journals', () => {
  const journal = definition({ studentAuthored: true })
  it('lets any signed-in student author entries', () => {
    assert.equal(decideCanAuthor(journal, viewer()), true)
  })
  it('lets staff author entries too', () => {
    for (const role of STAFF_ROLES) {
      assert.equal(decideCanAuthor(journal, viewer({ role })), true, `failed for ${role}`)
    }
  })
  it('refuses a signed-out visitor', () => {
    assert.equal(decideCanAuthor(journal, null), false)
  })
})

describe('decideCanAuthor — instructor-only journals', () => {
  const journal = definition({ studentAuthored: false })
  it('refuses a student even with canDefine=false', () => {
    assert.equal(
      decideCanAuthor(journal, viewer({ role: 'STUDENT', canDefine: false })),
      false,
    )
  })
  it('lets a staff member with canDefine author entries', () => {
    assert.equal(
      decideCanAuthor(journal, viewer({ role: 'INSTRUCTOR', canDefine: true })),
      true,
    )
  })
  it('refuses staff that lack canDefine', () => {
    // STAFF role does not carry journal:define in the default role matrix
    assert.equal(
      decideCanAuthor(journal, viewer({ role: 'STAFF', canDefine: false })),
      false,
    )
  })
  it('refuses a disabled journal even if the viewer has canDefine', () => {
    const disabled = definition({ studentAuthored: false, enabled: false })
    assert.equal(
      decideCanAuthor(disabled, viewer({ role: 'INSTRUCTOR', canDefine: true })),
      false,
    )
  })
})

// ─── decideEntryVisibility — author + reviewer bypass ───────────────────────

describe('entry visibility — author sees own', () => {
  for (const visibility of ['PRIVATE', 'INSTRUCTORS', 'BATCH', 'PUBLIC'] as const) {
    it(`lets the author see their own ${visibility} entry`, () => {
      const author = viewer({ id: 'u-author', role: 'STUDENT' })
      assert.equal(
        decideEntryVisibility(entry({ authorId: 'u-author', visibility }), author).visible,
        true,
      )
    })
  }
})

describe('entry visibility — reviewer bypass', () => {
  for (const visibility of ['PRIVATE', 'INSTRUCTORS', 'BATCH', 'PUBLIC'] as const) {
    it(`lets a reviewer see a ${visibility} entry they did not author`, () => {
      const reviewer = viewer({ id: 'u-other', role: 'INSTRUCTOR', canReview: true })
      assert.equal(
        decideEntryVisibility(entry({ authorId: 'u-author', visibility }), reviewer)
          .visible,
        true,
      )
    })
  }
})

// ─── decideEntryVisibility — per-visibility rules ───────────────────────────

describe('entry visibility — PRIVATE', () => {
  it('refuses a non-reviewer who is not the author', () => {
    const other = viewer({ id: 'u-other', role: 'STUDENT' })
    const decision = decideEntryVisibility(
      entry({ authorId: 'u-author', visibility: 'PRIVATE' }),
      other,
    )
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHORIZED')
  })
  it('refuses a signed-out visitor', () => {
    const decision = decideEntryVisibility(
      entry({ authorId: 'u-author', visibility: 'PRIVATE' }),
      null,
    )
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

describe('entry visibility — INSTRUCTORS', () => {
  it('lets any staff member see, even without the review permission', () => {
    // An instructor without journal:review still sees student work handed to
    // them — the review permission gates the moderation surface, not the read.
    const instructor = viewer({ id: 'u-other', role: 'INSTRUCTOR', canReview: false })
    assert.equal(
      decideEntryVisibility(
        entry({ authorId: 'u-author', visibility: 'INSTRUCTORS' }),
        instructor,
      ).visible,
      true,
    )
  })
  it('refuses a student who is not the author', () => {
    const student = viewer({ id: 'u-other', role: 'STUDENT' })
    const decision = decideEntryVisibility(
      entry({ authorId: 'u-author', visibility: 'INSTRUCTORS' }),
      student,
    )
    assert.equal(decision.visible, false)
  })
})

describe('entry visibility — BATCH', () => {
  it('lets a batch member see peer work', () => {
    const peer = viewer({ id: 'u-peer', role: 'STUDENT', batchIds: ['batch-1'] })
    assert.equal(
      decideEntryVisibility(
        entry({ authorId: 'u-author', visibility: 'BATCH', batchId: 'batch-1' }),
        peer,
      ).visible,
      true,
    )
  })
  it('refuses a student in a different batch', () => {
    const peer = viewer({ id: 'u-peer', role: 'STUDENT', batchIds: ['batch-2'] })
    const decision = decideEntryVisibility(
      entry({ authorId: 'u-author', visibility: 'BATCH', batchId: 'batch-1' }),
      peer,
    )
    assert.equal(decision.visible, false)
  })
  it('refuses a student in no batch when the entry has one', () => {
    const peer = viewer({ id: 'u-peer', role: 'STUDENT', batchIds: [] })
    const decision = decideEntryVisibility(
      entry({ authorId: 'u-author', visibility: 'BATCH', batchId: 'batch-1' }),
      peer,
    )
    assert.equal(decision.visible, false)
  })
  it('lets staff see a BATCH entry even from another batch', () => {
    const staff = viewer({ id: 'u-staff', role: 'INSTRUCTOR' })
    assert.equal(
      decideEntryVisibility(
        entry({ authorId: 'u-author', visibility: 'BATCH', batchId: 'batch-other' }),
        staff,
      ).visible,
      true,
    )
  })
  it('refuses staff when there is no batch attached', () => {
    // Defensive: the data is malformed if a BATCH entry has no batchId, but
    // the rule degrades to "private" rather than "visible to every staff".
    const staff = viewer({ id: 'u-staff', role: 'STAFF', canReview: false })
    const decision = decideEntryVisibility(
      entry({ authorId: 'u-author', visibility: 'BATCH', batchId: null }),
      staff,
    )
    assert.equal(decision.visible, false)
  })
})

describe('entry visibility — PUBLIC', () => {
  it('is visible to any signed-in member', () => {
    assert.equal(
      decideEntryVisibility(
        entry({ authorId: 'u-author', visibility: 'PUBLIC' }),
        viewer({ id: 'u-other', role: 'STUDENT' }),
      ).visible,
      true,
    )
  })
  it('is visible to staff', () => {
    assert.equal(
      decideEntryVisibility(
        entry({ authorId: 'u-author', visibility: 'PUBLIC' }),
        viewer({ id: 'u-staff', role: 'STAFF' }),
      ).visible,
      true,
    )
  })
  it('refuses a signed-out visitor', () => {
    const decision = decideEntryVisibility(
      entry({ authorId: 'u-author', visibility: 'PUBLIC' }),
      null,
    )
    assert.equal(decision.visible, false)
    assert.equal(decision.visible === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

// ─── decideEntryVisibility — exhaustiveness ────────────────────────────────

describe('entry visibility — exhaustiveness', () => {
  it('decides every JournalVisibility without throwing', () => {
    const journalViewer = viewer()
    for (const visibility of ['PRIVATE', 'INSTRUCTORS', 'BATCH', 'PUBLIC'] as const) {
      const subject = entry({ authorId: 'u-other', visibility })
      const decision = decideEntryVisibility(subject, journalViewer)
      assert.equal(typeof decision.visible, 'boolean')
    }
  })
})

// ─── decideCanComment ──────────────────────────────────────────────────────

describe('comment eligibility — author + reviewer bypass', () => {
  for (const visibility of ['PRIVATE', 'INSTRUCTORS', 'BATCH', 'PUBLIC'] as const) {
    it(`lets the author comment on their own ${visibility} entry`, () => {
      const author = viewer({ id: 'u-author', role: 'STUDENT' })
      const decision = decideCanComment(
        entry({ authorId: 'u-author', visibility }),
        author,
      )
      assert.equal(decision.ok, true)
    })
    it(`lets a reviewer comment on a ${visibility} entry they did not author`, () => {
      const reviewer = viewer({ id: 'u-other', role: 'INSTRUCTOR', canReview: true })
      const decision = decideCanComment(
        entry({ authorId: 'u-author', visibility }),
        reviewer,
      )
      assert.equal(decision.ok, true)
    })
  }
})

describe('comment eligibility — PRIVATE', () => {
  it('refuses a non-reviewer who is not the author', () => {
    const other = viewer({ id: 'u-other', role: 'STUDENT' })
    const decision = decideCanComment(
      entry({ authorId: 'u-author', visibility: 'PRIVATE' }),
      other,
    )
    assert.equal(decision.ok, false)
    assert.equal(decision.ok === false && decision.reason, 'NOT_AUTHORIZED')
  })
  it('refuses a signed-out visitor', () => {
    const decision = decideCanComment(
      entry({ authorId: 'u-author', visibility: 'PRIVATE' }),
      null,
    )
    assert.equal(decision.ok, false)
    assert.equal(decision.ok === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})

describe('comment eligibility — INSTRUCTORS', () => {
  it('lets staff comment, even without the review permission', () => {
    const instructor = viewer({ id: 'u-staff', role: 'INSTRUCTOR', canReview: false })
    assert.equal(
      decideCanComment(
        entry({ authorId: 'u-author', visibility: 'INSTRUCTORS' }),
        instructor,
      ).ok,
      true,
    )
  })
  it('refuses a non-author student', () => {
    const student = viewer({ id: 'u-other', role: 'STUDENT' })
    assert.equal(
      decideCanComment(
        entry({ authorId: 'u-author', visibility: 'INSTRUCTORS' }),
        student,
      ).ok,
      false,
    )
  })
})

describe('comment eligibility — BATCH', () => {
  it('lets a batch member comment alongside the author', () => {
    const peer = viewer({ id: 'u-peer', role: 'STUDENT', batchIds: ['batch-1'] })
    assert.equal(
      decideCanComment(
        entry({ authorId: 'u-author', visibility: 'BATCH', batchId: 'batch-1' }),
        peer,
      ).ok,
      true,
    )
  })
  it('refuses a student in a different batch', () => {
    const peer = viewer({ id: 'u-peer', role: 'STUDENT', batchIds: ['batch-2'] })
    assert.equal(
      decideCanComment(
        entry({ authorId: 'u-author', visibility: 'BATCH', batchId: 'batch-1' }),
        peer,
      ).ok,
      false,
    )
  })
})

describe('comment eligibility — PUBLIC', () => {
  it('lets any signed-in member comment', () => {
    const other = viewer({ id: 'u-other', role: 'STUDENT', batchIds: [] })
    assert.equal(
      decideCanComment(entry({ authorId: 'u-author', visibility: 'PUBLIC' }), other).ok,
      true,
    )
  })
  it('refuses a signed-out visitor', () => {
    const decision = decideCanComment(
      entry({ authorId: 'u-author', visibility: 'PUBLIC' }),
      null,
    )
    assert.equal(decision.ok, false)
    assert.equal(decision.ok === false && decision.reason, 'NOT_AUTHENTICATED')
  })
})
