/**
 * Database-backed tests for scheduling and delivery.
 *
 * Separate from the `*.test.ts` suite because the property under test lives in
 * query semantics rather than in logic: idempotency is `dedupeKey` being unique
 * plus `createMany({ skipDuplicates })` resolving to `ON CONFLICT DO NOTHING`,
 * and a mocked client would only prove that the mock deduplicates.
 *
 * Run with `npm run test:db`. Unlike ../media/playback.dbtest.ts this suite does
 * not truncate: every fixture is namespaced and removed by id at the end, so it
 * can share a database with another suite rather than racing it.
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, disconnectDb } from '@/server/db'
import { ORG_SETTINGS_ID } from '@/server/org/settings'
import { runScheduler } from './scheduler'
import { runDeliveryWorker } from './worker'

/** Everything this suite creates is findable by this prefix. */
const PREFIX = 'notif-dbtest'

/** 13:00 UTC = 18:30 IST. A -30 minute rule fires at 12:30 UTC. */
const SESSION_START = new Date('2026-07-26T13:00:00Z')
const SESSION_RUN_AT = new Date('2026-07-26T12:35:00Z')

/** 2026-08-01 05:30 IST. A -3 day rule fires 09:00 IST on 29 Jul = 03:30 UTC. */
const INSTALLMENT_DUE = new Date('2026-08-01T00:00:00Z')
const FEE_RUN_AT = new Date('2026-07-29T03:35:00Z')

let courseId: string
let batchId: string
let sessionId: string
let installmentId: string
let classRuleId: string
let feeRuleId: string
let studentAId: string
let studentBId: string

async function cleanup(): Promise<void> {
  // Notifications, enrollments and fee schedules all cascade from these three.
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await db.course.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await db.notificationRule.deleteMany({ where: { key: { startsWith: PREFIX } } })
  await db.notificationTemplate.deleteMany({ where: { key: { startsWith: PREFIX } } })
  await db.auditLog.deleteMany({ where: { action: 'notifications.scheduled' } })
}

before(async () => {
  await cleanup()

  await db.orgSettings.upsert({
    where: { id: ORG_SETTINGS_ID },
    update: { timezone: 'Asia/Kolkata', locale: 'en-IN', currency: 'INR' },
    create: {
      id: ORG_SETTINGS_ID,
      name: 'Test Academy',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      currency: 'INR',
    },
  })

  const studentA = await db.user.create({
    data: { email: `${PREFIX}-a@test.local`, name: 'Asha Menon', role: 'STUDENT', status: 'ACTIVE' },
  })
  studentAId = studentA.id

  const studentB = await db.user.create({
    data: { email: `${PREFIX}-b@test.local`, name: 'Ravi Kumar', role: 'STUDENT', status: 'ACTIVE' },
  })
  studentBId = studentB.id

  const course = await db.course.create({
    data: { slug: `${PREFIX}-course`, title: 'Foundation Programme', status: 'PUBLISHED' },
  })
  courseId = course.id

  const batch = await db.batch.create({
    data: {
      courseId,
      name: 'August Cohort',
      code: `${PREFIX}-AUG`,
      status: 'RUNNING',
      startDate: new Date('2026-07-01T00:00:00Z'),
    },
  })
  batchId = batch.id

  const enrollmentA = await db.enrollment.create({
    data: { userId: studentAId, courseId, batchId, status: 'ACTIVE', source: 'MANUAL' },
  })
  await db.enrollment.create({
    data: { userId: studentBId, courseId, batchId, status: 'ACTIVE', source: 'MANUAL' },
  })

  const session = await db.liveSession.create({
    data: {
      kind: 'CLASS',
      title: 'Week 3 — Risk and Position Sizing',
      batchId,
      courseId,
      scheduledStart: SESSION_START,
      status: 'SCHEDULED',
      joinUrl: 'https://meet.example.com/week-3',
    },
  })
  sessionId = session.id

  const schedule = await db.feeSchedule.create({
    data: { enrollmentId: enrollmentA.id, totalMinor: 2_500_000, currency: 'INR' },
  })
  const installment = await db.feeInstallment.create({
    data: {
      feeScheduleId: schedule.id,
      seq: 2,
      label: 'Installment 2 of 3',
      amountMinor: 1_250_000,
      dueDate: INSTALLMENT_DUE,
      status: 'PENDING',
    },
  })
  installmentId = installment.id

  const classTemplate = await db.notificationTemplate.create({
    data: {
      key: `${PREFIX}-class`,
      name: 'Class reminder',
      subject: '{{session.title}} starts in {{session.minutesUntil}} minutes',
      body: 'Hi {{student.firstName}},\n\n{{session.title}} begins at {{session.startTime}}.\n\n— {{org.name}}',
      channels: ['EMAIL', 'IN_APP'],
    },
  })

  const feeTemplate = await db.notificationTemplate.create({
    data: {
      key: `${PREFIX}-fee`,
      name: 'Fee reminder',
      subject: '{{fee.amount}} due on {{fee.dueDate}}',
      body: 'Hi {{student.firstName}}, {{fee.amount}} is due in {{fee.daysUntilDue}} days.',
      channels: ['IN_APP'],
    },
  })

  const classRule = await db.notificationRule.create({
    data: {
      key: `${PREFIX}-class-reminder`,
      name: 'Remind 30 minutes before class',
      trigger: 'CLASS_REMINDER',
      templateId: classTemplate.id,
      channels: ['EMAIL', 'IN_APP'],
      offsetMinutes: -30,
      enabled: true,
    },
  })
  classRuleId = classRule.id

  const feeRule = await db.notificationRule.create({
    data: {
      key: `${PREFIX}-fee-due`,
      name: 'Remind 3 days before a fee falls due',
      trigger: 'FEE_DUE',
      templateId: feeTemplate.id,
      channels: ['IN_APP'],
      offsetMinutes: -3 * 24 * 60,
      enabled: true,
    },
  })
  feeRuleId = feeRule.id
})

after(async () => {
  await cleanup()
  await disconnectDb()
})

async function countFor(ruleId: string): Promise<number> {
  return db.notification.count({ where: { ruleId } })
}

async function clearNotifications(): Promise<void> {
  await db.notification.deleteMany({ where: { userId: { in: [studentAId, studentBId] } } })
}

describe('idempotency', () => {
  /**
   * The crux. The scheduler is expected to re-run, overlap and retry; a second
   * pass over the same window must insert nothing rather than send a second
   * WhatsApp message to a paying student.
   */
  it('creates one row per recipient and channel, however many times it runs', async () => {
    await clearNotifications()

    const first = await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
    // Two students × two channels.
    assert.equal(first.created, 4)
    assert.equal(first.duplicates, 0)
    assert.equal(await countFor(classRuleId), 4)

    const second = await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
    assert.equal(second.created, 0, 'a re-run must create nothing')
    assert.equal(second.duplicates, 4, 'and must report what it suppressed')
    assert.equal(await countFor(classRuleId), 4, 'the row count must not move')
  })

  /** The realistic case: a five-minute cron over a sixty-minute window. */
  it('stays at one row across overlapping windows', async () => {
    await clearNotifications()

    await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
    await runScheduler({ now: new Date(SESSION_RUN_AT.getTime() + 5 * 60_000), lookbackMinutes: 60 })
    await runScheduler({ now: new Date(SESSION_RUN_AT.getTime() + 20 * 60_000), lookbackMinutes: 60 })

    assert.equal(await countFor(classRuleId), 4)
  })

  it('writes the documented dedupe key', async () => {
    await clearNotifications()
    await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })

    const row = await db.notification.findUnique({
      where: {
        dedupeKey: `rule:${classRuleId}:session:${sessionId}:user:${studentAId}:IN_APP`,
      },
      select: { id: true },
    })
    assert.ok(row, 'the key must be reconstructible from rule, anchor, user and channel')
  })

  it('does not fire for a window the anchor falls outside', async () => {
    await clearNotifications()
    const report = await runScheduler({
      now: new Date('2026-07-26T10:00:00Z'),
      lookbackMinutes: 60,
    })
    assert.equal(report.created, 0)
  })

  it('records what was scheduled, not what was sent', async () => {
    await clearNotifications()
    await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })

    const row = await db.notification.findFirstOrThrow({
      where: { ruleId: classRuleId, channel: 'IN_APP', userId: studentAId },
      select: { status: true, scheduledFor: true, sentAt: true, subject: true, body: true },
    })
    assert.equal(row.status, 'QUEUED')
    assert.equal(row.sentAt, null)
    assert.equal(row.scheduledFor?.toISOString(), '2026-07-26T12:30:00.000Z')
    assert.equal(row.subject, 'Week 3 — Risk and Position Sizing starts in 30 minutes')
    assert.ok(row.body.startsWith('Hi Asha,'))
  })
})

describe('timezone', () => {
  /**
   * A fee due date carries a time of day nobody chose. The reminder must land at
   * 9am in the org's timezone — 03:30 UTC for Asia/Kolkata — and not at 09:00
   * UTC, which would reach an Indian student at half past two in the afternoon.
   */
  it('fires a fee reminder at the org send hour, three local days early', async () => {
    await clearNotifications()
    const report = await runScheduler({ now: FEE_RUN_AT, lookbackMinutes: 60 })

    assert.equal(report.created, 1)
    const row = await db.notification.findFirstOrThrow({
      where: { ruleId: feeRuleId },
      select: { userId: true, scheduledFor: true, body: true },
    })
    assert.equal(row.userId, studentAId, 'only the student who owes it')
    assert.equal(row.scheduledFor?.toISOString(), '2026-07-29T03:30:00.000Z')
    assert.ok(row.body.includes('₹12,500.00'), 'money renders from minor units')
    assert.ok(row.body.includes('due in 3 days'))
  })
})

describe('preferences', () => {
  it('suppresses a channel the student muted', async () => {
    await clearNotifications()
    await db.notificationPreference.create({
      data: { userId: studentBId, channel: 'EMAIL', trigger: null, enabled: false },
    })

    try {
      const report = await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
      assert.equal(report.optedOut, 1)
      assert.equal(report.created, 3)

      const emails = await db.notification.count({
        where: { ruleId: classRuleId, channel: 'EMAIL' },
      })
      assert.equal(emails, 1, 'only the student who did not opt out')
    } finally {
      await db.notificationPreference.deleteMany({ where: { userId: studentBId } })
    }
  })

  /**
   * The person who owes the fee is the one with the strongest incentive to
   * silence the notice. Policy, not schema — see ./preferences.ts.
   */
  it('ignores an opt-out on a fee reminder', async () => {
    await clearNotifications()
    await db.notificationPreference.create({
      data: { userId: studentAId, channel: 'IN_APP', trigger: 'FEE_DUE', enabled: false },
    })

    try {
      const report = await runScheduler({ now: FEE_RUN_AT, lookbackMinutes: 60 })
      assert.equal(report.optedOut, 0)
      assert.equal(await countFor(feeRuleId), 1)
    } finally {
      await db.notificationPreference.deleteMany({ where: { userId: studentAId } })
    }
  })
})

describe('rule state', () => {
  it('ignores a disabled rule', async () => {
    await clearNotifications()
    await db.notificationRule.update({ where: { id: classRuleId }, data: { enabled: false } })

    try {
      const report = await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
      assert.equal(await countFor(classRuleId), 0)
      assert.equal(report.created, 0)
    } finally {
      await db.notificationRule.update({ where: { id: classRuleId }, data: { enabled: true } })
    }
  })

  it('evaluates without writing in a dry run', async () => {
    await clearNotifications()
    const report = await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60, dryRun: true })

    assert.equal(report.fires, 1)
    assert.equal(report.candidates, 4)
    assert.equal(report.created, 0)
    assert.equal(await countFor(classRuleId), 0)
  })
})

describe('delivery', () => {
  it('sends what is due and leaves what is not', async () => {
    await clearNotifications()
    await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })

    // Well after the scheduled time, so everything queued is due.
    const report = await runDeliveryWorker({ now: new Date('2026-07-26T12:40:00Z') })
    assert.equal(report.claimed, 4)
    assert.equal(report.sent, 4)
    assert.equal(report.failed, 0)

    const sent = await db.notification.count({ where: { ruleId: classRuleId, status: 'SENT' } })
    assert.equal(sent, 4)
  })

  /** A second drain must find nothing: SENT rows are not re-claimed. */
  it('does not re-send an already delivered notification', async () => {
    await clearNotifications()
    await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
    await runDeliveryWorker({ now: new Date('2026-07-26T12:40:00Z') })

    const second = await runDeliveryWorker({ now: new Date('2026-07-26T12:45:00Z') })
    assert.equal(second.claimed, 0)
    assert.equal(second.sent, 0)
  })

  it('leaves a notification scheduled for the future alone', async () => {
    await clearNotifications()
    await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })

    const report = await runDeliveryWorker({ now: new Date('2026-07-26T12:00:00Z') })
    assert.equal(report.claimed, 0, 'nothing is due before its scheduled time')
  })

  it('records the delivery timestamp for the inbox to sort on', async () => {
    await clearNotifications()
    await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
    const sentAt = new Date('2026-07-26T12:40:00Z')
    await runDeliveryWorker({ now: sentAt })

    const row = await db.notification.findFirstOrThrow({
      where: { ruleId: classRuleId, channel: 'IN_APP', userId: studentAId },
      select: { sentAt: true, attempts: true, error: true },
    })
    assert.equal(row.sentAt?.toISOString(), sentAt.toISOString())
    assert.equal(row.attempts, 1)
    assert.equal(row.error, null)
  })
})

describe('audience', () => {
  it('reaches only students enrolled in the batch', async () => {
    await clearNotifications()

    const outsider = await db.user.create({
      data: {
        email: `${PREFIX}-outsider@test.local`,
        name: 'Not Enrolled',
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })

    try {
      await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
      const reached = await db.notification.count({
        where: { ruleId: classRuleId, userId: outsider.id },
      })
      assert.equal(reached, 0)
    } finally {
      await db.user.delete({ where: { id: outsider.id } })
    }
  })

  it('does not chase an installment that has been paid', async () => {
    await clearNotifications()
    await db.feeInstallment.update({
      where: { id: installmentId },
      data: { status: 'PAID', paidAt: new Date('2026-07-20T00:00:00Z') },
    })

    try {
      const report = await runScheduler({ now: FEE_RUN_AT, lookbackMinutes: 60 })
      assert.equal(report.created, 0)
      assert.equal(await countFor(feeRuleId), 0)
    } finally {
      await db.feeInstallment.update({
        where: { id: installmentId },
        data: { status: 'PENDING', paidAt: null },
      })
    }
  })

  it('does not remind a student whose enrollment is no longer active', async () => {
    await clearNotifications()
    await db.enrollment.updateMany({
      where: { userId: studentBId, batchId },
      data: { status: 'CANCELLED' },
    })

    try {
      await runScheduler({ now: SESSION_RUN_AT, lookbackMinutes: 60 })
      const reached = await db.notification.count({
        where: { ruleId: classRuleId, userId: studentBId },
      })
      assert.equal(reached, 0)
    } finally {
      await db.enrollment.updateMany({
        where: { userId: studentBId, batchId },
        data: { status: 'ACTIVE' },
      })
    }
  })
})
