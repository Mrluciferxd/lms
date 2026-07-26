/**
 * Database-backed tests for lead capture.
 *
 * Separate from the `*.test.ts` suite because the parts worth testing here live
 * in query semantics: duplicate suppression is a time-windowed `findFirst` whose
 * filter is built conditionally, and the course a lead attaches to is resolved by
 * a publish-state lookup. A mocked client would assert the mock.
 *
 * The sanitization and rate-limit policy this action composes are covered purely
 * in ./attribution.test.ts and ./rate-limit.test.ts.
 *
 * Run with `npm run test:db`. Requires DATABASE_URL pointed at a throwaway
 * database — every table this touches is truncated on setup.
 */

import assert from 'node:assert/strict'
import { before, beforeEach, describe, it } from 'node:test'

import { db } from '@/server/db'
import { ORG_SETTINGS_ID } from '@/server/org/settings'
import { HONEYPOT_FIELD, landingSource, LEAD_SOURCE_HUB } from './attribution'
import { landingPages } from './content'
import { submitLead } from './leads'
import { resetRateLimits } from './rate-limit'

/**
 * Read from the active brand rather than hardcoded, so this suite is not pinned
 * to whichever client `test:db` happens to build. Every brand ships at least one
 * landing page; the draft case needs a second and is skipped without it.
 */
const PUBLISHED_LANDING = landingPages()[0]!
const DRAFT_LANDING = landingPages()[1] ?? null

let publishedCourseId: string

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

function validEnquiry(overrides: Record<string, string> = {}): FormData {
  return form({
    name: 'Asha Menon',
    email: 'asha@example.test',
    message: 'When does the next batch start?',
    consent: 'on',
    source: LEAD_SOURCE_HUB,
    ...overrides,
  })
}

before(async () => {
  await db.lead.deleteMany()
  await db.auditLog.deleteMany()
  await db.course.deleteMany()
  await db.orgSettings.deleteMany()

  await db.orgSettings.create({
    data: {
      id: ORG_SETTINGS_ID,
      name: 'Test Academy',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      currency: 'INR',
    },
  })

  const published = await db.course.create({
    data: { slug: PUBLISHED_LANDING.courseSlug, title: 'Published Programme', status: 'PUBLISHED' },
    select: { id: true },
  })
  publishedCourseId = published.id

  if (DRAFT_LANDING) {
    await db.course.create({
      data: { slug: DRAFT_LANDING.courseSlug, title: 'Unpublished Programme', status: 'DRAFT' },
    })
  }
})

beforeEach(async () => {
  await db.lead.deleteMany()
  resetRateLimits()
})

describe('accepted enquiries', () => {
  it('stores the enquiry', async () => {
    const result = await submitLead({}, validEnquiry())
    assert.equal(result.ok, true)

    const lead = await db.lead.findFirstOrThrow()
    assert.equal(lead.name, 'Asha Menon')
    assert.equal(lead.email, 'asha@example.test')
    assert.equal(lead.message, 'When does the next batch start?')
    assert.equal(lead.status, 'NEW')
  })

  it('accepts a phone number with no email', async () => {
    const result = await submitLead({}, validEnquiry({ email: '', phone: '+91 98765 43210' }))
    assert.equal(result.ok, true)

    const lead = await db.lead.findFirstOrThrow()
    assert.equal(lead.email, null)
    assert.equal(lead.phone, '+91 98765 43210')
  })

  it('lowercases the email so duplicates and admin search agree', async () => {
    await submitLead({}, validEnquiry({ email: 'Asha.Menon@Example.Test' }))
    const lead = await db.lead.findFirstOrThrow()
    assert.equal(lead.email, 'asha.menon@example.test')
  })

  it('records an audit entry for the enquiry', async () => {
    await db.auditLog.deleteMany()
    await submitLead({}, validEnquiry())

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.captured' } })
    assert.equal(entry.entityType, 'Lead')
    assert.equal(entry.actorId, null)
  })
})

describe('attribution', () => {
  it('stores whitelisted campaign parameters as data', async () => {
    await submitLead(
      {},
      validEnquiry({ utm_source: 'google', utm_medium: 'cpc', gclid: 'abc123' }),
    )

    const lead = await db.lead.findFirstOrThrow()
    assert.deepEqual(lead.utm, { utm_source: 'google', utm_medium: 'cpc', gclid: 'abc123' })
  })

  it('drops fields that are not campaign parameters', async () => {
    // A crafted POST must not smuggle arbitrary keys into the column.
    await submitLead({}, validEnquiry({ utm_source: 'google', role: 'ADMIN', status: 'CONVERTED' }))

    const lead = await db.lead.findFirstOrThrow()
    assert.deepEqual(lead.utm, { utm_source: 'google' })
    assert.equal(lead.status, 'NEW')
  })
})

describe('course attribution', () => {
  it('attaches the course behind a configured landing page', async () => {
    await submitLead({}, validEnquiry({ source: landingSource(PUBLISHED_LANDING.slug) }))

    const lead = await db.lead.findFirstOrThrow()
    assert.equal(lead.source, landingSource(PUBLISHED_LANDING.slug))
    assert.equal(lead.courseId, publishedCourseId)
  })

  it('attaches nothing when the landing page sells an unpublished course', { skip: !DRAFT_LANDING }, async () => {
    await submitLead({}, validEnquiry({ source: landingSource(DRAFT_LANDING!.slug) }))

    const lead = await db.lead.findFirstOrThrow()
    assert.equal(lead.courseId, null)
  })

  it('records a forged source as unknown and attaches no course', async () => {
    await submitLead({}, validEnquiry({ source: 'landing:competitor-page' }))

    const lead = await db.lead.findFirstOrThrow()
    assert.equal(lead.source, 'unknown')
    assert.equal(lead.courseId, null)
  })
})

describe('spam and abuse controls', () => {
  it('silently discards a submission that filled the honeypot', async () => {
    const result = await submitLead({}, validEnquiry({ [HONEYPOT_FIELD]: 'Acme Corp' }))

    // Reports success so a bot gets no signal about which field caught it.
    assert.equal(result.ok, true)
    assert.equal(await db.lead.count(), 0)
  })

  it('writes one row for the same email submitted twice in the window', async () => {
    assert.equal((await submitLead({}, validEnquiry())).ok, true)
    assert.equal((await submitLead({}, validEnquiry({ message: 'Second try' }))).ok, true)
    assert.equal(await db.lead.count(), 1)
  })

  it('treats a different person from the same page as a new lead', async () => {
    await submitLead({}, validEnquiry())
    await submitLead({}, validEnquiry({ name: 'Ravi Kumar', email: 'ravi@example.test' }))
    assert.equal(await db.lead.count(), 2)
  })

  it('does not suppress every enquiry when one arrives with no email', async () => {
    // Regression guard: an undefined value in a Prisma `where` means "no filter",
    // which would make the duplicate check match any recent row.
    await submitLead({}, validEnquiry({ email: '', phone: '+919876543210' }))
    await submitLead({}, validEnquiry({ email: '', phone: '+919999999999', name: 'Ravi Kumar' }))
    assert.equal(await db.lead.count(), 2)
  })

  it('rate limits a flood from one client', async () => {
    const outcomes: boolean[] = []
    for (let index = 0; index < 7; index += 1) {
      const result = await submitLead({}, validEnquiry({ email: `flood${index}@example.test` }))
      outcomes.push(result.ok === true)
    }

    assert.deepEqual(outcomes, [true, true, true, true, true, false, false])
    assert.equal(await db.lead.count(), 5)
  })
})

describe('validation', () => {
  it('rejects an enquiry with neither an email nor a phone number', async () => {
    const result = await submitLead({}, validEnquiry({ email: '' }))
    assert.equal(result.ok, undefined)
    assert.ok(result.fieldErrors?.email)
    assert.equal(await db.lead.count(), 0)
  })

  it('rejects an enquiry without consent', async () => {
    const result = await submitLead({}, validEnquiry({ consent: '' }))
    assert.ok(result.fieldErrors?.consent)
    assert.equal(await db.lead.count(), 0)
  })

  it('rejects a malformed email address', async () => {
    const result = await submitLead({}, validEnquiry({ email: 'not-an-email' }))
    assert.ok(result.fieldErrors?.email)
    assert.equal(await db.lead.count(), 0)
  })

  it('rejects a name too short to be one', async () => {
    const result = await submitLead({}, validEnquiry({ name: 'A' }))
    assert.ok(result.fieldErrors?.name)
    assert.equal(await db.lead.count(), 0)
  })
})
