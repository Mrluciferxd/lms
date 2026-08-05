import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  decideWidgetVisibility,
  isStandaloneWidget,
  type WidgetDefinitionSubject,
  type WidgetViewer,
} from './access'

function definition(
  overrides: Partial<WidgetDefinitionSubject> = {},
): WidgetDefinitionSubject {
  return {
    enabled: true,
    surfaces: ['standalone'],
    ...overrides,
  }
}

function viewer(overrides: Partial<WidgetViewer> = {}): WidgetViewer {
  return { id: 'u1', role: 'STUDENT', isStaff: false, ...overrides }
}

// ─── decideWidgetVisibility ────────────────────────────────────────────────

describe('widget visibility', () => {
  it('is visible to any signed-in member', () => {
    assert.equal(decideWidgetVisibility(definition(), viewer()).visible, true)
  })

  it('is visible to signed-in staff', () => {
    for (const [role, isStaff] of [
      ['STUDENT', false],
      ['INSTRUCTOR', true],
      ['ADMIN', true],
      ['OWNER', true],
    ] as const) {
      assert.equal(
        decideWidgetVisibility(definition(), viewer({ role, isStaff })).visible,
        true,
        `failed for ${role}`,
      )
    }
  })

  it('refuses anonymous viewers', () => {
    assert.deepEqual(decideWidgetVisibility(definition(), null), {
      visible: false,
      reason: 'NOT_AUTHENTICATED',
    })
  })

  it('refuses a disabled widget even when the viewer is signed in', () => {
    assert.deepEqual(
      decideWidgetVisibility(definition({ enabled: false }), viewer()),
      { visible: false, reason: 'WIDGET_DISABLED' },
    )
  })

  it('reports WIDGET_DISABLED over NOT_AUTHENTICATED — disabled wins', () => {
    assert.deepEqual(
      decideWidgetVisibility(definition({ enabled: false }), null),
      { visible: false, reason: 'WIDGET_DISABLED' },
    )
  })
})

// ─── isStandaloneWidget ────────────────────────────────────────────────────

describe('isStandaloneWidget', () => {
  it('is true when the definition declares the standalone surface', () => {
    assert.equal(isStandaloneWidget(definition()), true)
  })

  it('is false for dashboard-only widgets', () => {
    assert.equal(
      isStandaloneWidget(definition({ surfaces: ['student-dashboard'] })),
      false,
    )
  })

  it('is false when no surfaces are declared', () => {
    assert.equal(isStandaloneWidget(definition({ surfaces: [] })), false)
  })
})
