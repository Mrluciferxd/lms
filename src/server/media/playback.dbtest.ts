/**
 * Database-backed tests for playback authorization.
 *
 * Separate from the `*.test.ts` suite because these need a real Postgres: the
 * concurrency logic lives in query semantics (distinct-on-device, revocation
 * ordering, expiry windows), and a mocked client would test the mock rather than
 * the behaviour that protects revenue.
 *
 * Run with `npm run test:db`. Requires DATABASE_URL pointed at a throwaway
 * database — every table this touches is truncated on setup.
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, disconnectDb } from '@/server/db'
import { ORG_SETTINGS_ID } from '@/server/org/settings'
import { effectiveStreamLimit, issuePlayback, releasePlayback } from './playback'

const DEVICE_A = 'device-fingerprint-aaa'
const DEVICE_B = 'device-fingerprint-bbb'

let studentId: string
let outsiderId: string
let instructorId: string
let releasedLessonId: string
let lockedLessonId: string
let noVideoLessonId: string
let processingLessonId: string

async function reset(): Promise<void> {
  // Order matters only where cascades do not cover it.
  await db.playbackGrant.deleteMany()
  await db.device.deleteMany()
  await db.auditLog.deleteMany()
  await db.enrollment.deleteMany()
  await db.lesson.deleteMany()
  await db.section.deleteMany()
  await db.course.deleteMany()
  await db.mediaAsset.deleteMany()
  await db.user.deleteMany()
  await db.orgSettings.deleteMany()
}

before(async () => {
  await reset()

  await db.orgSettings.create({
    data: {
      id: ORG_SETTINGS_ID,
      name: 'Test Academy',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      currency: 'INR',
      watermarkTemplate: '{{name}} · {{email}}',
    },
  })

  const student = await db.user.create({
    data: { email: 'student@test.local', name: 'Asha Menon', role: 'STUDENT', status: 'ACTIVE' },
  })
  studentId = student.id

  const outsider = await db.user.create({
    data: { email: 'outsider@test.local', name: 'Ravi Kumar', role: 'STUDENT', status: 'ACTIVE' },
  })
  outsiderId = outsider.id

  const instructor = await db.user.create({
    data: { email: 'teacher@test.local', name: 'Meera Rao', role: 'INSTRUCTOR', status: 'ACTIVE' },
  })
  instructorId = instructor.id

  const readyAsset = await db.mediaAsset.create({
    data: {
      provider: 'LOCAL',
      providerAssetId: 'local-ready-asset',
      playbackId: 'local-ready-asset',
      type: 'VIDEO',
      status: 'READY',
      title: 'Ready lecture',
      drmEnabled: false,
      watermarkEnabled: true,
      // 0 = inherit the brand limit, which is what we want to exercise.
      maxConcurrentStreams: 0,
    },
  })

  const processingAsset = await db.mediaAsset.create({
    data: {
      provider: 'LOCAL',
      providerAssetId: 'local-processing-asset',
      type: 'VIDEO',
      status: 'PROCESSING',
      title: 'Still transcoding',
    },
  })

  const course = await db.course.create({
    data: {
      slug: 'test-course',
      title: 'Test Course',
      status: 'PUBLISHED',
      sections: {
        create: {
          title: 'Section 1',
          order: 0,
          lessons: {
            create: [
              {
                title: 'Released lesson',
                order: 0,
                type: 'VIDEO',
                releaseMode: 'IMMEDIATE',
                videoAssetId: readyAsset.id,
              },
              {
                title: 'Locked lesson',
                order: 1,
                type: 'VIDEO',
                // Never released until an instructor says so.
                releaseMode: 'MANUAL',
                videoAssetId: readyAsset.id,
              },
              { title: 'Text lesson', order: 2, type: 'TEXT', releaseMode: 'IMMEDIATE' },
              {
                title: 'Processing lesson',
                order: 3,
                type: 'VIDEO',
                releaseMode: 'IMMEDIATE',
                videoAssetId: processingAsset.id,
              },
            ],
          },
        },
      },
    },
    include: { sections: { include: { lessons: { orderBy: { order: 'asc' } } } } },
  })

  const lessons = course.sections[0]!.lessons
  releasedLessonId = lessons[0]!.id
  lockedLessonId = lessons[1]!.id
  noVideoLessonId = lessons[2]!.id
  processingLessonId = lessons[3]!.id

  await db.enrollment.create({
    data: { userId: studentId, courseId: course.id, status: 'ACTIVE', source: 'MANUAL' },
  })
})

after(async () => {
  await reset()
  await disconnectDb()
})

/** Grants accumulate across tests, so clear them between concurrency cases. */
async function clearGrants(): Promise<void> {
  await db.playbackGrant.deleteMany()
}

describe('effectiveStreamLimit', () => {
  it('prefers a per-asset limit so one sensitive recording can be tighter', () => {
    assert.equal(effectiveStreamLimit(3, 1), 3)
  })

  it('inherits the brand limit when the asset does not set one', () => {
    assert.equal(effectiveStreamLimit(0, 2), 2)
  })

  it('treats zero at both levels as unlimited', () => {
    assert.equal(effectiveStreamLimit(0, 0), 0)
  })
})

describe('authorization', () => {
  it('issues a signed token, a grant and a watermark for an enrolled student', async () => {
    await clearGrants()
    const result = await issuePlayback({
      lessonId: releasedLessonId,
      viewerId: studentId,
      deviceFingerprint: DEVICE_A,
      ip: '203.0.113.9',
      userAgent: 'test-agent',
    })

    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.ok(result.playback.url.length > 0)
    assert.equal(result.watermark, 'Asha Menon · student@test.local')
    assert.ok(result.expiresAt.getTime() > Date.now())
    // Renewal must happen strictly before expiry or playback stutters.
    assert.ok(result.renewAfterSec * 1000 < result.expiresAt.getTime() - Date.now() + 1000)

    const grant = await db.playbackGrant.findUnique({ where: { id: result.grantId } })
    assert.ok(grant, 'grant should be recorded for forensics')
    assert.equal(grant.userId, studentId)
    assert.equal(grant.ip, '203.0.113.9')
    assert.equal(grant.revokedAt, null)
  })

  it('requires a device fingerprint, without which concurrency cannot be counted', async () => {
    const result = await issuePlayback({
      lessonId: releasedLessonId,
      viewerId: studentId,
      deviceFingerprint: null,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'DEVICE_REQUIRED')
  })

  it('rejects an unauthenticated request', async () => {
    const result = await issuePlayback({
      lessonId: releasedLessonId,
      viewerId: null,
      deviceFingerprint: DEVICE_A,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok === false && result.code, 'NOT_AUTHENTICATED')
  })

  /** A non-enrolled user must not learn that the lesson exists. */
  it('reports 404 rather than 403 for someone with no enrollment', async () => {
    const result = await issuePlayback({
      lessonId: releasedLessonId,
      viewerId: outsiderId,
      deviceFingerprint: DEVICE_A,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.status, 404)
    assert.equal(result.ok === false && result.code, 'NOT_FOUND')
  })

  /**
   * The reason drip had to move into Week 2: without this check the API would
   * hand out a playable URL for content the UI shows as locked.
   */
  it('refuses a lesson that has not been released', async () => {
    await clearGrants()
    const result = await issuePlayback({
      lessonId: lockedLessonId,
      viewerId: studentId,
      deviceFingerprint: DEVICE_A,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'LOCKED')
    assert.equal(result.ok === false && result.status, 403)
  })

  it('lets an instructor through the same drip lock', async () => {
    await clearGrants()
    const result = await issuePlayback({
      lessonId: lockedLessonId,
      viewerId: instructorId,
      deviceFingerprint: DEVICE_A,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok, true)
  })

  it('reports a lesson with no video distinctly from a missing lesson', async () => {
    const result = await issuePlayback({
      lessonId: noVideoLessonId,
      viewerId: studentId,
      deviceFingerprint: DEVICE_A,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok === false && result.code, 'NO_VIDEO')
  })

  it('refuses a video that is still processing, with a retryable message', async () => {
    const result = await issuePlayback({
      lessonId: processingLessonId,
      viewerId: studentId,
      deviceFingerprint: DEVICE_A,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok === false && result.code, 'NOT_READY')
    assert.equal(result.ok === false && result.status, 409)
  })

  it('refuses an unknown lesson id', async () => {
    const result = await issuePlayback({
      lessonId: 'does-not-exist',
      viewerId: studentId,
      deviceFingerprint: DEVICE_A,
      ip: null,
      userAgent: null,
    })
    assert.equal(result.ok === false && result.status, 404)
  })
})

describe('concurrency enforcement', () => {
  const play = (device: string) =>
    issuePlayback({
      lessonId: releasedLessonId,
      viewerId: studentId,
      deviceFingerprint: device,
      ip: '203.0.113.9',
      userAgent: 'test-agent',
    })

  it('blocks a second device when the limit is one', async () => {
    await clearGrants()
    assert.equal((await play(DEVICE_A)).ok, true)

    const second = await play(DEVICE_B)
    assert.equal(second.ok, false)
    assert.equal(second.ok === false && second.code, 'CONCURRENCY_LIMIT')
    assert.equal(second.ok === false && second.status, 409)
    assert.deepEqual(second.ok === false && second.detail, { activeStreams: 1, limit: 1 })
  })

  /**
   * The bug this guards against: the player renews its token before expiry, and
   * if a renewal counted as an additional stream a single legitimate viewer would
   * lock themselves out mid-lesson.
   */
  it('treats a renewal from the same device as one stream, not two', async () => {
    await clearGrants()
    assert.equal((await play(DEVICE_A)).ok, true)
    assert.equal((await play(DEVICE_A)).ok, true)
    assert.equal((await play(DEVICE_A)).ok, true)

    const live = await db.playbackGrant.count({
      where: { userId: studentId, revokedAt: null, expiresAt: { gt: new Date() } },
    })
    assert.equal(live, 1, 'renewals must revoke the prior grant for that device')
  })

  it('frees the slot when the first device releases', async () => {
    await clearGrants()
    const first = await play(DEVICE_A)
    assert.equal(first.ok, true)
    if (!first.ok) return

    assert.equal((await play(DEVICE_B)).ok, false)

    await releasePlayback(first.grantId, studentId)

    assert.equal((await play(DEVICE_B)).ok, true, 'slot should free immediately on release')
  })

  /** Otherwise one student could free another student's slot by guessing an id. */
  it('does not let one student release another student\'s grant', async () => {
    await clearGrants()
    const first = await play(DEVICE_A)
    assert.equal(first.ok, true)
    if (!first.ok) return

    await releasePlayback(first.grantId, outsiderId)

    const grant = await db.playbackGrant.findUnique({ where: { id: first.grantId } })
    assert.equal(grant?.revokedAt, null, 'grant must survive a release by the wrong user')
  })

  it('ignores expired grants when counting', async () => {
    await clearGrants()
    // A grant that has already lapsed must not occupy a slot.
    const device = await db.device.create({
      data: { userId: studentId, fingerprint: 'stale-device' },
    })
    await db.playbackGrant.create({
      data: {
        userId: studentId,
        assetId: (await db.mediaAsset.findFirstOrThrow({ where: { status: 'READY' } })).id,
        deviceId: device.id,
        issuedAt: new Date(Date.now() - 3_600_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    })

    assert.equal((await play(DEVICE_A)).ok, true, 'an expired grant should not block')
  })

  it('records an audit entry when a stream is blocked', async () => {
    await clearGrants()
    await db.auditLog.deleteMany()
    await play(DEVICE_A)
    await play(DEVICE_B)

    const blocked = await db.auditLog.findFirst({
      where: { action: 'playback.concurrency_blocked', actorId: studentId },
    })
    assert.ok(blocked, 'a blocked stream should be auditable')
  })

  it('allows a second device once the asset raises its own limit', async () => {
    await clearGrants()
    const asset = await db.mediaAsset.findFirstOrThrow({ where: { status: 'READY' } })
    await db.mediaAsset.update({
      where: { id: asset.id },
      data: { maxConcurrentStreams: 2 },
    })

    try {
      assert.equal((await play(DEVICE_A)).ok, true)
      assert.equal((await play(DEVICE_B)).ok, true)
      assert.equal((await play('device-fingerprint-ccc')).ok, false)
    } finally {
      await db.mediaAsset.update({ where: { id: asset.id }, data: { maxConcurrentStreams: 0 } })
    }
  })
})

describe('device blocking', () => {
  it('refuses playback from a revoked device', async () => {
    await clearGrants()
    await db.device.updateMany({
      where: { userId: studentId, fingerprint: DEVICE_A },
      data: { revokedAt: new Date() },
    })

    try {
      const result = await issuePlayback({
        lessonId: releasedLessonId,
        viewerId: studentId,
        deviceFingerprint: DEVICE_A,
        ip: null,
        userAgent: null,
      })
      assert.equal(result.ok, false)
      assert.equal(result.ok === false && result.code, 'FORBIDDEN')
    } finally {
      await db.device.updateMany({
        where: { userId: studentId, fingerprint: DEVICE_A },
        data: { revokedAt: null },
      })
    }
  })
})
