import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decideCanUpdateRecord, decideTrackerRead } from './access'
import type { TrackerViewer } from './access'

const STUDENT = (id: string, batchIds: readonly string[] = []): TrackerViewer => ({
  id,
  role: 'STUDENT',
  canManage: false,
  batchIds,
})

const ADMIN = (id: string): TrackerViewer => ({
  id,
  role: 'ADMIN',
  canManage: true,
  batchIds: [],
})

describe('decideTrackerRead', () => {
  it('denies anonymous viewers', () => {
    const def = { enabled: true, scope: 'STUDENT', type: 'COUNTER' } as const
    assert.equal(decideTrackerRead(def, null).ok, false)
  })

  it('denies disabled trackers even for signed-in users', () => {
    const def = { enabled: false, scope: 'STUDENT', type: 'COUNTER' } as const
    assert.equal(decideTrackerRead(def, STUDENT('u1')).ok, false)
  })

  it('allows signed-in users on enabled trackers', () => {
    const def = { enabled: true, scope: 'STUDENT', type: 'COUNTER' } as const
    assert.equal(decideTrackerRead(def, STUDENT('u1')).ok, true)
  })
})

describe('decideCanUpdateRecord', () => {
  it('lets tracker:manage update any record', () => {
    assert.equal(
      decideCanUpdateRecord({ scope: 'GLOBAL', type: 'GAUGE', userId: null, batchId: null }, ADMIN('a1')).ok,
      true,
    )
    assert.equal(
      decideCanUpdateRecord({ scope: 'BATCH', type: 'COUNTER', userId: null, batchId: 'b1' }, ADMIN('a1')).ok,
      true,
    )
    assert.equal(
      decideCanUpdateRecord({ scope: 'STUDENT', type: 'EXPIRY', userId: 'u1', batchId: null }, ADMIN('a1')).ok,
      true,
    )
  })

  it('lets a student update their own STUDENT record for non-EXPIRY types', () => {
    for (const type of ['COUNTER', 'CHECKLIST', 'GAUGE', 'BOOLEAN'] as const) {
      assert.equal(
        decideCanUpdateRecord({ scope: 'STUDENT', type, userId: 'u1', batchId: null }, STUDENT('u1')).ok,
        true,
      )
    }
  })

  it('denies a student updating someone else STUDENT record', () => {
    assert.equal(
      decideCanUpdateRecord({ scope: 'STUDENT', type: 'COUNTER', userId: 'u2', batchId: null }, STUDENT('u1')).ok,
      false,
    )
  })

  it('denies a student updating their own EXPIRY record', () => {
    assert.equal(
      decideCanUpdateRecord({ scope: 'STUDENT', type: 'EXPIRY', userId: 'u1', batchId: null }, STUDENT('u1')).ok,
      false,
    )
  })

  it('denies students writing BATCH or GLOBAL records', () => {
    assert.equal(
      decideCanUpdateRecord({ scope: 'BATCH', type: 'COUNTER', userId: null, batchId: 'b1' }, STUDENT('u1')).ok,
      false,
    )
    assert.equal(
      decideCanUpdateRecord({ scope: 'GLOBAL', type: 'GAUGE', userId: null, batchId: null }, STUDENT('u1')).ok,
      false,
    )
  })
})
