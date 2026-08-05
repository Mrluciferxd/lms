import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseSnapshotPayload } from './widgets'

// ─── parseSnapshotPayload ──────────────────────────────────────────────────

describe('parseSnapshotPayload', () => {
  it('returns an empty widget for null, undefined and non-objects', () => {
    for (const raw of [null, undefined, 'nope', 42, []]) {
      assert.deepEqual(parseSnapshotPayload(raw), {
        items: [],
        generatedAt: null,
        unavailable: null,
      })
    }
  })

  it('parses a valid envelope and sorts items by time ascending', () => {
    const parsed = parseSnapshotPayload({
      generatedAt: '2026-08-05T10:00:00.000Z',
      items: [
        { id: 'b', at: '2026-08-05T09:00:00.000Z', title: 'later' },
        { id: 'a', at: '2026-08-05T08:00:00.000Z', title: 'earlier' },
      ],
    })

    assert.equal(parsed.generatedAt?.toISOString(), '2026-08-05T10:00:00.000Z')
    assert.equal(parsed.unavailable, null)
    assert.deepEqual(
      parsed.items.map((item) => item.id),
      ['a', 'b'],
    )
  })

  it('keeps badge, detail and url when present', () => {
    const parsed = parseSnapshotPayload({
      items: [
        {
          id: 'a',
          at: '2026-08-05T08:00:00.000Z',
          title: 'NFP',
          badge: 'HIGH',
          detail: 'USD · actual 200K',
          url: 'https://example.com/event',
        },
      ],
    })

    const first = parsed.items[0]
    assert.ok(first)
    assert.equal(first.badge, 'HIGH')
    assert.equal(first.detail, 'USD · actual 200K')
    assert.equal(first.url, 'https://example.com/event')
  })

  it('drops an item whose title or timestamp is missing or invalid', () => {
    const parsed = parseSnapshotPayload({
      items: [
        { id: 'a', at: '2026-08-05T08:00:00.000Z', title: 'ok' },
        { id: 'b', at: 'not-a-date', title: 'bad date' },
        { id: 'c', at: '2026-08-05T08:00:00.000Z', title: '' },
        { id: 'd', title: 'no time' },
        'garbage',
        { id: 'e', at: '2026-08-05T08:00:00.000Z', title: 42 },
      ],
    })

    assert.equal(parsed.items.length, 1)
    const first = parsed.items[0]
    assert.ok(first)
    assert.equal(first.id, 'a')
  })

  it('assigns a stable fallback id when the feed omits one', () => {
    const parsed = parseSnapshotPayload({
      items: [
        { at: '2026-08-05T08:00:00.000Z', title: 'no id' },
        { at: '2026-08-05T09:00:00.000Z', title: 'also no id' },
      ],
    })

    const [first, second] = parsed.items
    assert.ok(first)
    assert.ok(second)
    assert.equal(first.id, 'item-0')
    assert.equal(second.id, 'item-1')
  })

  it('reads a string unavailable reason and falls back for a malformed one', () => {
    const withReason = parseSnapshotPayload({
      items: [],
      unavailable: { reason: 'Feed is not configured.' },
    })
    assert.equal(withReason.unavailable?.reason, 'Feed is not configured.')

    const malformed = parseSnapshotPayload({
      items: [],
      unavailable: { reason: 42 },
    })
    assert.equal(malformed.unavailable?.reason, 'Feed unavailable.')

    const noReason = parseSnapshotPayload({ items: [], unavailable: true })
    assert.equal(noReason.unavailable, null)
  })

  it('ignores an invalid generatedAt', () => {
    const parsed = parseSnapshotPayload({ generatedAt: 'nonsense', items: [] })
    assert.equal(parsed.generatedAt, null)
  })

  it('treats non-array items as an empty list', () => {
    const parsed = parseSnapshotPayload({ items: { not: 'an array' } })
    assert.deepEqual(parsed.items, [])
  })
})
