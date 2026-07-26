import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { referencedVariables, renderForChannel, unknownVariables } from './render'
import type { TemplateVariables } from './variables'

/** Shaped like the templates the coaching and forex packs actually ship. */
const CLASS_REMINDER = {
  subject: '{{session.title}} starts in {{session.minutesUntil}} minutes',
  body:
    'Hi {{student.firstName}},\n\n' +
    '{{session.title}} begins at {{session.startTime}} ({{org.timezone}}).\n\n' +
    'Join here: {{session.joinUrl}}\n\n' +
    '— {{org.name}}',
}

const VARIABLES: TemplateVariables = {
  'student.firstName': 'Asha',
  'session.title': 'Week 3 — Risk',
  'session.startTime': '7:00 pm',
  'session.minutesUntil': '30',
  'session.joinUrl': 'https://meet.example.com/week-3',
  'org.timezone': 'Asia/Kolkata',
  'org.name': 'Sunrise Academy',
}

describe('substitution', () => {
  it('resolves dotted placeholders', () => {
    const rendered = renderForChannel(CLASS_REMINDER, 'EMAIL', VARIABLES)
    assert.equal(rendered.subject, 'Week 3 — Risk starts in 30 minutes')
    assert.ok(rendered.body.startsWith('Hi Asha,'))
    assert.ok(rendered.body.includes('https://meet.example.com/week-3'))
  })

  it('tolerates whitespace inside the braces', () => {
    const rendered = renderForChannel({ body: 'Hi {{ student.firstName }}' }, 'EMAIL', VARIABLES)
    assert.equal(rendered.body, 'Hi Asha')
  })

  /**
   * Dropped, not left literal: a student reading `{{fee.amount}}` reads a broken
   * product. The typo surfaces through `missing` and the admin editor instead.
   */
  it('drops an unresolved placeholder and reports it', () => {
    const rendered = renderForChannel({ body: 'Rank {{test.rank}} scored' }, 'EMAIL', VARIABLES)
    assert.equal(rendered.body, 'Rank scored')
    assert.deepEqual(rendered.missing, ['test.rank'])
  })

  it('does not re-resolve a placeholder that arrived inside a value', () => {
    const rendered = renderForChannel(
      { body: 'Hi {{student.firstName}}' },
      'EMAIL',
      { ...VARIABLES, 'student.firstName': '{{org.name}}' },
    )
    // Sanitising values is what strips the braces; nothing here re-renders.
    assert.equal(rendered.body, 'Hi {{org.name}}')
  })
})

describe('EMAIL', () => {
  it('keeps the author’s structure', () => {
    const rendered = renderForChannel(CLASS_REMINDER, 'EMAIL', VARIABLES)
    assert.equal(rendered.body.split('\n').length, 7)
  })

  it('keeps the subject', () => {
    assert.equal(
      renderForChannel(CLASS_REMINDER, 'EMAIL', VARIABLES).subject,
      'Week 3 — Risk starts in 30 minutes',
    )
  })

  it('reports no subject when the template has none', () => {
    assert.equal(renderForChannel({ body: 'Body only' }, 'EMAIL', VARIABLES).subject, null)
  })
})

describe('SMS', () => {
  const rendered = renderForChannel(CLASS_REMINDER, 'SMS', VARIABLES)

  /** Each newline costs a character and the operator bills per 153-char segment. */
  it('collapses to a single line', () => {
    assert.ok(!rendered.body.includes('\n'))
    assert.ok(rendered.body.startsWith('Hi Asha, Week 3'))
  })

  it('carries no subject, because there is nowhere to put one', () => {
    assert.equal(rendered.subject, null)
  })

  it('bounds the body at three segments', () => {
    const long = renderForChannel({ body: 'x'.repeat(2000) }, 'SMS', VARIABLES)
    assert.equal(long.body.length, 480)
    assert.ok(long.body.endsWith('…'))
  })
})

describe('WHATSAPP', () => {
  it('keeps paragraphs but collapses runs the Cloud API rejects', () => {
    const rendered = renderForChannel({ body: 'One\n\n\n\n\nTwo' }, 'WHATSAPP', VARIABLES)
    assert.equal(rendered.body, 'One\n\nTwo')
  })

  it('trims leading and trailing whitespace, which the provider refuses', () => {
    const rendered = renderForChannel({ body: '\n\n  Hello  \n\n' }, 'WHATSAPP', VARIABLES)
    assert.equal(rendered.body, 'Hello')
  })

  it('bounds the body at the template limit', () => {
    const rendered = renderForChannel({ body: 'x'.repeat(2000) }, 'WHATSAPP', VARIABLES)
    assert.equal(rendered.body.length, 1024)
  })
})

describe('PUSH', () => {
  it('bounds title and body to what a phone will show', () => {
    const rendered = renderForChannel(
      { subject: 'x'.repeat(200), body: 'y'.repeat(400) },
      'PUSH',
      VARIABLES,
    )
    assert.equal(rendered.subject?.length, 64)
    assert.equal(rendered.body.length, 178)
  })

  /** A push with no title renders as the app name, which says nothing. */
  it('synthesises a title from the body when the template has none', () => {
    const rendered = renderForChannel(
      { body: 'Your class starts soon. Join from the dashboard.' },
      'PUSH',
      VARIABLES,
    )
    assert.equal(rendered.subject, 'Your class starts soon.')
  })

  it('flattens the body to one line', () => {
    const rendered = renderForChannel(CLASS_REMINDER, 'PUSH', VARIABLES)
    assert.ok(!rendered.body.includes('\n'))
  })
})

describe('IN_APP', () => {
  it('keeps structure and subject, since the inbox can show both', () => {
    const rendered = renderForChannel(CLASS_REMINDER, 'IN_APP', VARIABLES)
    assert.ok(rendered.body.includes('\n'))
    assert.equal(rendered.subject, 'Week 3 — Risk starts in 30 minutes')
  })
})

describe('newline tidying', () => {
  /**
   * The visible symptom of an empty value: the line it occupied collapses, and
   * without this the body renders with a hole three blank lines wide.
   */
  it('collapses the gap left by a placeholder that owned its own line', () => {
    const rendered = renderForChannel(
      { body: 'Hi\n\n{{session.joinUrl}}\n\nBye' },
      'WHATSAPP',
      { 'session.joinUrl': '' },
    )
    assert.equal(rendered.body, 'Hi\n\nBye')
  })
})

describe('unknownVariables', () => {
  it('reports nothing when every placeholder resolves', () => {
    assert.deepEqual(unknownVariables(CLASS_REMINDER, VARIABLES), [])
  })

  it('reports a variable the trigger cannot supply', () => {
    assert.deepEqual(
      unknownVariables({ subject: 'Result: {{test.name}}', body: 'Rank {{test.rank}}' }, VARIABLES),
      ['test.name', 'test.rank'],
    )
  })

  it('deduplicates repeats', () => {
    assert.deepEqual(
      unknownVariables({ body: '{{a.b}} and {{a.b}}' }, VARIABLES),
      ['a.b'],
    )
  })
})

describe('referencedVariables', () => {
  it('lists every placeholder once, in first-seen order', () => {
    assert.deepEqual(referencedVariables(CLASS_REMINDER), [
      'session.title',
      'session.minutesUntil',
      'student.firstName',
      'session.startTime',
      'org.timezone',
      'session.joinUrl',
      'org.name',
    ])
  })
})
