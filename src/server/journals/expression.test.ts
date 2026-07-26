import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ExpressionError,
  evaluateExpression,
  validateExpression,
} from './expression'

/** A closed long: entry 1.1000, stop 1.0950, target 1.1150, exit 1.1100. */
const CLOSED_LONG = {
  direction: 'LONG',
  entryPrice: 1.1,
  stopLoss: 1.095,
  takeProfit: 1.115,
  exitPrice: 1.11,
  lotSize: 0.1,
  contractSize: 100000,
}

/** A closed short, mirrored so R-multiple must come out identical. */
const CLOSED_SHORT = {
  direction: 'SHORT',
  entryPrice: 1.1,
  stopLoss: 1.105,
  takeProfit: 1.085,
  exitPrice: 1.09,
  lotSize: 0.1,
  contractSize: 100000,
}

const PLANNED_RR = 'abs(takeProfit - entryPrice) / abs(entryPrice - stopLoss)'
const R_MULTIPLE = '(exitPrice - entryPrice) / (entryPrice - stopLoss)'
const PNL =
  '(exitPrice - entryPrice) * lotSize * contractSize * (direction == "LONG" ? 1 : -1)'

function near(actual: unknown, expected: number, tolerance = 1e-9) {
  assert.equal(typeof actual, 'number')
  assert.ok(
    Math.abs((actual as number) - expected) < tolerance,
    `expected ~${expected}, got ${actual}`,
  )
}

describe('forex trade journal expressions', () => {
  it('computes planned risk-to-reward', () => {
    near(evaluateExpression(PLANNED_RR, CLOSED_LONG), 3)
    near(evaluateExpression(PLANNED_RR, CLOSED_SHORT), 3)
  })

  it('computes R-multiple identically for longs and shorts', () => {
    near(evaluateExpression(R_MULTIPLE, CLOSED_LONG), 2)
    near(evaluateExpression(R_MULTIPLE, CLOSED_SHORT), 2)
  })

  it('computes signed P&L from direction', () => {
    // Long: +0.0100 * 0.1 * 100000 = +100
    near(evaluateExpression(PNL, CLOSED_LONG), 100, 1e-6)
    // Short: (1.0900 - 1.1000) = -0.0100, negated by direction = +100
    near(evaluateExpression(PNL, CLOSED_SHORT), 100, 1e-6)
  })

  it('yields null for an open position rather than NaN', () => {
    const { exitPrice: _omitted, ...open } = CLOSED_LONG
    assert.equal(evaluateExpression(PNL, open), null)
    assert.equal(evaluateExpression(R_MULTIPLE, open), null)
    // The plan is knowable before the exit is.
    near(evaluateExpression(PLANNED_RR, open), 3)
  })

  it('treats an empty string like an absent value', () => {
    assert.equal(evaluateExpression(PNL, { ...CLOSED_LONG, exitPrice: '' }), null)
  })

  it('parses numeric strings, since form input arrives as text', () => {
    const asStrings = {
      ...CLOSED_LONG,
      entryPrice: '1.1000',
      exitPrice: '1.1100',
      lotSize: '0.1',
      contractSize: '100000',
    }
    near(evaluateExpression(PNL, asStrings), 100, 1e-6)
  })

  it('returns null on division by zero instead of Infinity', () => {
    const noRisk = { ...CLOSED_LONG, stopLoss: 1.1 }
    assert.equal(evaluateExpression(PLANNED_RR, noRisk), null)
  })
})

describe('operators and helpers', () => {
  it('respects arithmetic precedence', () => {
    near(evaluateExpression('2 + 3 * 4', {}), 14)
    near(evaluateExpression('(2 + 3) * 4', {}), 20)
    near(evaluateExpression('-3 + 1', {}), -2)
  })

  it('supports comparison and boolean operators', () => {
    assert.equal(evaluateExpression('3 > 2', {}), true)
    assert.equal(evaluateExpression('3 <= 2', {}), false)
    assert.equal(evaluateExpression('1 < 2 && 2 < 3', {}), true)
    assert.equal(evaluateExpression('1 > 2 || 2 < 3', {}), true)
  })

  it('nests ternaries right-associatively', () => {
    const expr = 'r >= 2 ? "great" : r >= 1 ? "ok" : "poor"'
    assert.equal(evaluateExpression(expr, { r: 3 }), 'great')
    assert.equal(evaluateExpression(expr, { r: 1.5 }), 'ok')
    assert.equal(evaluateExpression(expr, { r: 0.2 }), 'poor')
  })

  it('propagates null through an indeterminate ternary condition', () => {
    assert.equal(evaluateExpression('missing > 1 ? 10 : 20', {}), null)
  })

  it('compares an absent field as false, not null', () => {
    assert.equal(evaluateExpression('direction == "LONG"', {}), false)
  })

  it('exposes the whitelisted helpers', () => {
    near(evaluateExpression('abs(-5)', {}), 5)
    near(evaluateExpression('round(1.2345, 2)', {}), 1.23)
    near(evaluateExpression('min(3, 1, 2)', {}), 1)
    near(evaluateExpression('max(3, 1, 2)', {}), 3)
    near(evaluateExpression('sqrt(9)', {}), 3)
    near(evaluateExpression('floor(1.9)', {}), 1)
    near(evaluateExpression('ceil(1.1)', {}), 2)
  })
})

describe('sandbox containment', () => {
  /**
   * Each of these is a documented escape route in general-purpose expression
   * libraries. They must fail at the grammar level, not at a denylist.
   */
  const attacks = [
    // Property access — the character is not in the grammar at all.
    'constructor.constructor("return process")()',
    'x.constructor',
    '__proto__.polluted',
    'x["__proto__"]',
    // Prototype pollution via assignment.
    '__proto__.isAdmin = true',
    'x = 1',
    // Reaching host globals or requiring modules.
    'process.env.DATABASE_URL',
    'require("fs")',
    'eval("1+1")',
    'Function("return 1")()',
    // Object construction.
    'new Date()',
    // Unknown callables.
    'exec("ls")',
  ]

  for (const attack of attacks) {
    it(`rejects: ${attack}`, () => {
      assert.throws(() => evaluateExpression(attack, {}), ExpressionError)
    })
  }

  /**
   * A bare host identifier is contained rather than rejected: identifiers only
   * ever resolve out of the entry's own data, so an unknown name is null. That
   * permissiveness is required — absent fields are normal — and typos are caught
   * separately by validateExpression at definition-save time.
   */
  it('resolves host globals to null rather than the real object', () => {
    for (const name of ['globalThis', 'process', 'window', 'Function', 'Object']) {
      assert.equal(evaluateExpression(name, {}), null)
    }
  })

  it('does not resolve inherited properties as identifiers', () => {
    // `toString` exists on Object.prototype but must be invisible.
    assert.equal(evaluateExpression('toString', { entryPrice: 1 }), null)
    assert.equal(evaluateExpression('hasOwnProperty', {}), null)
  })

  it('cannot be polluted by a crafted data key', () => {
    const hostile = JSON.parse('{"__proto__": {"isAdmin": true}, "entryPrice": 2}')
    near(evaluateExpression('entryPrice * 2', hostile), 4)
    assert.equal(({} as Record<string, unknown>).isAdmin, undefined)
  })

  it('bounds expression length', () => {
    assert.throws(() => evaluateExpression('1 +'.repeat(400) + '1', {}), ExpressionError)
  })

  it('bounds nesting depth', () => {
    const deep = '('.repeat(64) + '1' + ')'.repeat(64)
    assert.throws(() => evaluateExpression(deep, {}), ExpressionError)
  })

  it('rejects unterminated strings and stray characters', () => {
    assert.throws(() => evaluateExpression('"abc', {}), ExpressionError)
    assert.throws(() => evaluateExpression('1 @ 2', {}), ExpressionError)
    assert.throws(() => evaluateExpression('1 2', {}), ExpressionError)
  })
})

describe('validateExpression', () => {
  const fields = ['entryPrice', 'exitPrice', 'stopLoss', 'takeProfit', 'lotSize', 'contractSize', 'direction']

  it('accepts the shipped forex expressions', () => {
    for (const expr of [PLANNED_RR, R_MULTIPLE, PNL]) {
      const result = validateExpression(expr, fields)
      assert.equal(result.ok, true, `${expr} -> ${result.error}`)
      assert.deepEqual(result.unknownReferences, [])
    }
  })

  it('reports a misspelled field instead of silently yielding null', () => {
    const result = validateExpression('entryPirce * 2', fields)
    assert.equal(result.ok, false)
    assert.deepEqual(result.unknownReferences, ['entryPirce'])
  })

  it('reports a syntax error', () => {
    const result = validateExpression('entryPrice *', fields)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Unexpected|Expected/)
  })

  it('does not count helpers or literals as field references', () => {
    const result = validateExpression('abs(entryPrice) + 1', fields)
    assert.equal(result.ok, true)
    assert.deepEqual(result.references, ['entryPrice'])
  })
})
