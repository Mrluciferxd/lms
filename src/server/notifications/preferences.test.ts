import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type PreferenceRow, isChannelAllowed, isMandatory } from './preferences'

describe('default posture', () => {
  /** Opt-out, not opt-in: a student who never opens settings still gets told. */
  it('allows every channel when the student has no preferences', () => {
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'EMAIL', []), true)
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'WHATSAPP', []), true)
  })
})

describe('channel-wide opt-out', () => {
  const preferences: PreferenceRow[] = [{ channel: 'WHATSAPP', trigger: null, enabled: false }]

  it('mutes the whole channel', () => {
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'WHATSAPP', preferences), false)
  })

  it('leaves other channels alone', () => {
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'EMAIL', preferences), true)
  })
})

describe('precedence', () => {
  /**
   * A student who muted WhatsApp but kept class reminders on it means exactly
   * that; the more specific row has to win or the setting is a lie.
   */
  it('prefers a trigger-specific row over a channel-wide one', () => {
    const preferences: PreferenceRow[] = [
      { channel: 'WHATSAPP', trigger: null, enabled: false },
      { channel: 'WHATSAPP', trigger: 'CLASS_REMINDER', enabled: true },
    ]
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'WHATSAPP', preferences), true)
    assert.equal(isChannelAllowed('ASSIGNMENT_DUE', 'WHATSAPP', preferences), false)
  })

  it('works in the other direction too', () => {
    const preferences: PreferenceRow[] = [
      { channel: 'EMAIL', trigger: null, enabled: true },
      { channel: 'EMAIL', trigger: 'CALENDAR_EVENT', enabled: false },
    ]
    assert.equal(isChannelAllowed('CALENDAR_EVENT', 'EMAIL', preferences), false)
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'EMAIL', preferences), true)
  })

  it('ignores rows belonging to another channel', () => {
    const preferences: PreferenceRow[] = [
      { channel: 'SMS', trigger: 'CLASS_REMINDER', enabled: false },
    ]
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'EMAIL', preferences), true)
  })
})

describe('mandatory triggers', () => {
  it('names fee reminders and nothing else', () => {
    assert.equal(isMandatory('FEE_DUE'), true)
    assert.equal(isMandatory('FEE_OVERDUE'), true)
    assert.equal(isMandatory('CLASS_REMINDER'), false)
    assert.equal(isMandatory('ENROLLMENT_EXPIRING'), false)
  })

  /**
   * The person with the strongest incentive to silence a payment notice is the
   * person who owes the money. Letting them, and then relying on having given
   * notice, is a commercial hole rather than a preference.
   */
  it('overrides an explicit opt-out by the person who owes the fee', () => {
    const preferences: PreferenceRow[] = [
      { channel: 'WHATSAPP', trigger: 'FEE_OVERDUE', enabled: false },
      { channel: 'EMAIL', trigger: null, enabled: false },
    ]
    assert.equal(isChannelAllowed('FEE_OVERDUE', 'WHATSAPP', preferences), true)
    assert.equal(isChannelAllowed('FEE_DUE', 'EMAIL', preferences), true)
  })

  it('applies on every channel, including the in-app copy', () => {
    const preferences: PreferenceRow[] = [{ channel: 'IN_APP', trigger: null, enabled: false }]
    assert.equal(isChannelAllowed('FEE_DUE', 'IN_APP', preferences), true)
    assert.equal(isChannelAllowed('CLASS_REMINDER', 'IN_APP', preferences), false)
  })
})
