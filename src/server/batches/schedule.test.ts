import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type SessionRecurrence,
  describeRecurrence,
  generateOccurrences,
  parseSchedule,
} from './schedule'

const IST = 'Asia/Kolkata'

function recurrence(overrides: Partial<SessionRecurrence> = {}): SessionRecurrence {
  return {
    freq: 'WEEKLY',
    interval: 1,
    // Mon, Wed, Fri.
    byDay: [1, 3, 5],
    count: null,
    until: null,
    hour: 19,
    minute: 0,
    durationMin: 90,
    ...overrides,
  }
}

function valid(value: unknown): SessionRecurrence {
  const parsed = parseSchedule(value)
  assert.equal(parsed.status, 'valid')
  assert.ok(parsed.status === 'valid')
  return parsed.recurrence
}

function starts(occurrences: { start: Date }[]): string[] {
  return occurrences.map((occurrence) => occurrence.start.toISOString())
}

describe('parseSchedule — empty', () => {
  for (const value of [{}, null, undefined, 'not-an-object', [], { rrule: '' }]) {
    it(`treats ${JSON.stringify(value) ?? 'undefined'} as no schedule rather than an error`, () => {
      assert.equal(parseSchedule(value).status, 'empty')
    })
  }
})

describe('parseSchedule — rejection', () => {
  const base = { startTime: '19:00', durationMin: 90 }

  it('rejects an unsupported frequency by name instead of approximating it', () => {
    const parsed = parseSchedule({ ...base, rrule: 'FREQ=MONTHLY' })
    assert.equal(parsed.status, 'invalid')
    assert.ok(parsed.status === 'invalid' && parsed.error.includes('FREQ'))
  })

  it('rejects an unsupported rule part rather than silently dropping it', () => {
    // BYMONTHDAY would otherwise generate a plausible but wrong timetable.
    const parsed = parseSchedule({ ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO;BYMONTHDAY=1' })
    assert.equal(parsed.status, 'invalid')
    assert.ok(parsed.status === 'invalid' && parsed.error.includes('BYMONTHDAY'))
  })

  it('requires BYDAY for a weekly rule', () => {
    assert.equal(parseSchedule({ ...base, rrule: 'FREQ=WEEKLY' }).status, 'invalid')
  })

  it('refuses BYDAY on a daily rule, which would read as a weekly one', () => {
    assert.equal(parseSchedule({ ...base, rrule: 'FREQ=DAILY;BYDAY=MO' }).status, 'invalid')
  })

  it('names an unrecognised weekday', () => {
    const parsed = parseSchedule({ ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO,XX' })
    assert.ok(parsed.status === 'invalid' && parsed.error.includes('XX'))
  })

  it('rejects a repeated key', () => {
    assert.equal(
      parseSchedule({ ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO;BYDAY=WE' }).status,
      'invalid',
    )
  })

  for (const startTime of ['7pm', '25:00', '19:60', '19', '']) {
    it(`rejects startTime "${startTime}"`, () => {
      assert.equal(
        parseSchedule({ rrule: 'FREQ=DAILY', startTime, durationMin: 90 }).status,
        'invalid',
      )
    })
  }

  for (const durationMin of [0, 4, 1441, 90.5, '90']) {
    it(`rejects durationMin ${JSON.stringify(durationMin)}`, () => {
      assert.equal(
        parseSchedule({ rrule: 'FREQ=DAILY', startTime: '19:00', durationMin }).status,
        'invalid',
      )
    })
  }
})

describe('parseSchedule — acceptance', () => {
  it('reads the shape documented on Batch.schedule', () => {
    const parsed = valid({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      startTime: '19:00',
      durationMin: 90,
    })
    assert.equal(parsed.freq, 'WEEKLY')
    assert.deepEqual(parsed.byDay, [1, 3, 5])
    assert.equal(parsed.hour, 19)
    assert.equal(parsed.interval, 1)
  })

  it('normalises weekday order and duplicates', () => {
    const parsed = valid({ rrule: 'FREQ=WEEKLY;BYDAY=FR,MO,MO', startTime: '07:30', durationMin: 60 })
    assert.deepEqual(parsed.byDay, [1, 5])
    assert.equal(parsed.minute, 30)
  })

  it('reads COUNT and UNTIL', () => {
    const parsed = valid({
      rrule: 'FREQ=DAILY;COUNT=10;UNTIL=20260731',
      startTime: '06:00',
      durationMin: 45,
    })
    assert.equal(parsed.count, 10)
    // Inclusive of the named day, so a class on the 31st is still generated.
    assert.equal(parsed.until?.toISOString(), '2026-07-31T23:59:59.999Z')
  })
})

describe('generateOccurrences — weekly', () => {
  it('emits each named weekday at the org wall-clock time', () => {
    const occurrences = generateOccurrences(recurrence(), {
      from: new Date('2026-07-26T00:00:00Z'),
      to: new Date('2026-08-02T00:00:00Z'),
      timezone: IST,
    })

    // 19:00 IST is 13:30 UTC — stored UTC, rendered in the org timezone.
    assert.deepEqual(starts(occurrences), [
      '2026-07-27T13:30:00.000Z',
      '2026-07-29T13:30:00.000Z',
      '2026-07-31T13:30:00.000Z',
    ])
  })

  it('applies the duration to the end instant', () => {
    const [first] = generateOccurrences(recurrence({ durationMin: 90 }), {
      from: new Date('2026-07-26T00:00:00Z'),
      to: new Date('2026-07-28T00:00:00Z'),
      timezone: IST,
    })
    assert.equal(first?.end.toISOString(), '2026-07-27T15:00:00.000Z')
  })

  it('counts INTERVAL in whole weeks from Monday, as RFC 5545 does', () => {
    const occurrences = generateOccurrences(recurrence({ interval: 2, byDay: [1, 5] }), {
      // A Monday, so the batch's own first week is week 0 and is generated.
      from: new Date('2026-07-27T00:00:00Z'),
      to: new Date('2026-08-21T00:00:00Z'),
      timezone: IST,
    })

    assert.deepEqual(starts(occurrences), [
      '2026-07-27T13:30:00.000Z',
      '2026-07-31T13:30:00.000Z',
      '2026-08-10T13:30:00.000Z',
      '2026-08-14T13:30:00.000Z',
    ])
  })

  it('skips an occurrence earlier in the day than the window opens', () => {
    const occurrences = generateOccurrences(recurrence({ byDay: [1] }), {
      // 20:00 IST on the Monday — after that day's 19:00 class.
      from: new Date('2026-07-27T14:30:00Z'),
      to: new Date('2026-08-04T00:00:00Z'),
      timezone: IST,
    })
    assert.deepEqual(starts(occurrences), ['2026-08-03T13:30:00.000Z'])
  })
})

describe('generateOccurrences — daily', () => {
  it('emits every day', () => {
    const occurrences = generateOccurrences(
      recurrence({ freq: 'DAILY', byDay: [], hour: 6, minute: 30, durationMin: 60 }),
      {
        from: new Date('2026-07-26T00:00:00Z'),
        to: new Date('2026-07-29T00:00:00Z'),
        timezone: IST,
      },
    )
    assert.deepEqual(starts(occurrences), [
      '2026-07-26T01:00:00.000Z',
      '2026-07-27T01:00:00.000Z',
      '2026-07-28T01:00:00.000Z',
    ])
  })

  it('honours INTERVAL from the window start', () => {
    const occurrences = generateOccurrences(
      recurrence({ freq: 'DAILY', byDay: [], interval: 3, hour: 6, minute: 0 }),
      {
        from: new Date('2026-07-26T00:00:00Z'),
        to: new Date('2026-08-05T00:00:00Z'),
        timezone: IST,
      },
    )
    assert.deepEqual(starts(occurrences), [
      '2026-07-26T00:30:00.000Z',
      '2026-07-29T00:30:00.000Z',
      '2026-08-01T00:30:00.000Z',
      '2026-08-04T00:30:00.000Z',
    ])
  })
})

describe('generateOccurrences — bounds', () => {
  const window = {
    from: new Date('2026-07-26T00:00:00Z'),
    to: new Date('2026-12-31T00:00:00Z'),
    timezone: IST,
  }

  it('stops at COUNT', () => {
    assert.equal(generateOccurrences(recurrence({ count: 4 }), window).length, 4)
  })

  it('stops at UNTIL', () => {
    const occurrences = generateOccurrences(
      recurrence({ until: new Date('2026-08-01T00:00:00Z') }),
      window,
    )
    assert.deepEqual(starts(occurrences), [
      '2026-07-27T13:30:00.000Z',
      '2026-07-29T13:30:00.000Z',
      '2026-07-31T13:30:00.000Z',
    ])
  })

  it('stops at the caller-supplied limit', () => {
    assert.equal(generateOccurrences(recurrence(), { ...window, limit: 2 }).length, 2)
  })

  it('caps a wide window rather than generating unbounded rows', () => {
    const occurrences = generateOccurrences(recurrence({ freq: 'DAILY', byDay: [] }), {
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2046-01-01T00:00:00Z'),
      timezone: IST,
    })
    assert.equal(occurrences.length, 400)
  })

  it('returns nothing for an inverted window', () => {
    assert.deepEqual(
      generateOccurrences(recurrence(), {
        from: new Date('2026-08-01T00:00:00Z'),
        to: new Date('2026-07-01T00:00:00Z'),
        timezone: IST,
      }),
      [],
    )
  })
})

describe('generateOccurrences — daylight saving', () => {
  it('keeps the class at the same wall-clock time across a DST change', () => {
    // New York moves to EDT on 8 March 2026. A 19:00 class must stay 19:00 for
    // the students, which means its UTC instant shifts by an hour.
    const occurrences = generateOccurrences(
      recurrence({ freq: 'DAILY', byDay: [], hour: 19, minute: 0 }),
      {
        from: new Date('2026-03-06T00:00:00Z'),
        to: new Date('2026-03-10T00:00:00Z'),
        timezone: 'America/New_York',
      },
    )

    // The window opens at 19:00 on 5 March local, so that evening's class is the
    // first. The last two are an hour earlier in UTC and unchanged locally.
    assert.deepEqual(starts(occurrences), [
      '2026-03-06T00:00:00.000Z',
      '2026-03-07T00:00:00.000Z',
      '2026-03-08T00:00:00.000Z',
      '2026-03-08T23:00:00.000Z',
      '2026-03-09T23:00:00.000Z',
    ])
  })
})

describe('describeRecurrence', () => {
  it('reads as a sentence an admin can check against what they meant', () => {
    assert.equal(describeRecurrence(recurrence()), 'Every week on Mon, Wed, Fri at 19:00 · 90 min')
  })

  it('spells out an interval and a count', () => {
    assert.equal(
      describeRecurrence(recurrence({ interval: 2, byDay: [2], count: 12 })),
      'Every 2 weeks on Tue at 19:00 · 90 min · 12 sessions',
    )
  })

  it('omits weekdays for a daily rule', () => {
    assert.equal(
      describeRecurrence(recurrence({ freq: 'DAILY', byDay: [], hour: 6, minute: 5 })),
      'Every day at 06:05 · 90 min',
    )
  })
})
