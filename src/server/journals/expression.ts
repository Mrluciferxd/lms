/**
 * Sandboxed expression evaluator for journal computed fields.
 *
 * WHY THIS IS HAND-WRITTEN
 * ------------------------
 * Computed-field expressions are authored by admins and stored in the database
 * (JournalDefinition.computedFields), then evaluated server-side on every entry
 * read. That makes the evaluator a trust boundary: anything it can reach, a
 * compromised admin account can reach.
 *
 * The obvious pick, `expr-eval`, carries two unfixed high-severity advisories
 * against every published version — GHSA-8gw3-rxh4-v6jx (prototype pollution)
 * and GHSA-jc85-fpwf-qm7x (arbitrary code execution via unrestricted function
 * references). `npm audit` reports no fix available. Other general-purpose
 * evaluators have a similar history, because their goal is expressiveness and
 * ours is containment.
 *
 * The grammar we actually need is tiny, so this is a ~200-line recursive-descent
 * parser with hard guarantees rather than a dependency with a CVE feed:
 *
 *   - No property access. There is no `.` or `[]` operator in the grammar, so
 *     `__proto__`, `constructor` and `prototype` are unreachable by construction.
 *   - No function values. Callables exist only as a fixed name -> implementation
 *     table consulted at call sites; an identifier can never resolve to one.
 *   - No assignment, no statements, no `new`, no globals.
 *   - Identifiers resolve solely from the entry's own data via `Object.hasOwn`,
 *     so inherited properties are invisible.
 *   - Bounded input length and recursion depth, so a pathological expression
 *     cannot hang or blow the stack.
 *
 * NULL SEMANTICS
 * --------------
 * Partially-filled entries are normal: an open trade has no exit price. Rather
 * than rendering NaN or Infinity, any arithmetic touching an absent value yields
 * null and the UI shows an em dash. Division by zero is null for the same reason.
 */

export type ExprValue = number | string | boolean | null

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExpressionError'
  }
}

const MAX_LENGTH = 500
const MAX_DEPTH = 32

/**
 * The complete set of callables. Variadic where it is useful; every entry is
 * pure, total, and returns null on absent input so null propagates.
 */
const FUNCTIONS: Record<string, (args: ExprValue[]) => ExprValue> = {
  abs: ([a]) => (isNum(a) ? Math.abs(a) : null),
  round: ([a, p]) => {
    if (!isNum(a)) return null
    const places = isNum(p) ? Math.min(Math.max(Math.trunc(p), 0), 12) : 0
    const factor = 10 ** places
    return Math.round(a * factor) / factor
  },
  floor: ([a]) => (isNum(a) ? Math.floor(a) : null),
  ceil: ([a]) => (isNum(a) ? Math.ceil(a) : null),
  sqrt: ([a]) => (isNum(a) && a >= 0 ? Math.sqrt(a) : null),
  min: (args) => reduceNumeric(args, Math.min),
  max: (args) => reduceNumeric(args, Math.max),
}

function isNum(value: ExprValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function reduceNumeric(args: ExprValue[], fn: (a: number, b: number) => number): ExprValue {
  const nums: number[] = []
  for (const arg of args) {
    if (!isNum(arg)) return null
    nums.push(arg)
  }
  // Wrap `fn` rather than passing it to reduce directly: reduce also supplies
  // index and array, and Math.min(a, b, index, array) coerces to NaN.
  return nums.length === 0 ? null : nums.reduce((a, b) => fn(a, b))
}

// -----------------------------------------------------------------------------
// Tokenizer
// -----------------------------------------------------------------------------

type TokenType = 'number' | 'string' | 'ident' | 'op' | 'punct' | 'eof'

interface Token {
  type: TokenType
  value: string
  pos: number
}

/** Longest-first so `<=` is not tokenized as `<` then `=`. */
const OPERATORS = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||',
  '+', '-', '*', '/', '%', '<', '>', '!',
] as const

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const char = input[i]!

    if (/\s/.test(char)) {
      i++
      continue
    }

    // Number literal, including a leading-dot form like `.5`.
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const start = i
      while (i < input.length && /[0-9.]/.test(input[i]!)) i++
      const raw = input.slice(start, i)
      if ((raw.match(/\./g) ?? []).length > 1) {
        throw new ExpressionError(`Malformed number "${raw}" at position ${start}.`)
      }
      tokens.push({ type: 'number', value: raw, pos: start })
      continue
    }

    // String literal. No escape sequences — field values compared against are
    // plain select-option keys, and omitting escapes removes a parser edge case.
    if (char === '"' || char === "'") {
      const start = i
      i++
      let value = ''
      while (i < input.length && input[i] !== char) {
        value += input[i]
        i++
      }
      if (i >= input.length) {
        throw new ExpressionError(`Unterminated string starting at position ${start}.`)
      }
      i++
      tokens.push({ type: 'string', value, pos: start })
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = i
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i]!)) i++
      tokens.push({ type: 'ident', value: input.slice(start, i), pos: start })
      continue
    }

    const op = OPERATORS.find((candidate) => input.startsWith(candidate, i))
    if (op) {
      tokens.push({ type: 'op', value: op, pos: i })
      i += op.length
      continue
    }

    if ('()?:,'.includes(char)) {
      tokens.push({ type: 'punct', value: char, pos: i })
      i++
      continue
    }

    // Notably rejects '.' and '[' — the property-access characters.
    throw new ExpressionError(`Unexpected character "${char}" at position ${i}.`)
  }

  tokens.push({ type: 'eof', value: '', pos: input.length })
  return tokens
}

// -----------------------------------------------------------------------------
// Parser / evaluator
//
// Parsing and evaluation are fused: there is no AST to cache, and expressions
// are short enough that re-parsing per entry is cheaper than the memory a cache
// would cost. Keeping it single-pass also means there is no tree for later code
// to walk and accidentally re-interpret.
// -----------------------------------------------------------------------------

class Evaluator {
  private index = 0
  private depth = 0

  constructor(
    private readonly tokens: Token[],
    private readonly scope: Record<string, ExprValue>,
    /** Collects identifiers seen, so validation can report unknown fields. */
    private readonly seen?: Set<string>,
  ) {}

  private peek(): Token {
    return this.tokens[this.index]!
  }

  private next(): Token {
    return this.tokens[this.index++]!
  }

  private matchOp(...values: string[]): boolean {
    const token = this.peek()
    if (token.type === 'op' && values.includes(token.value)) {
      this.index++
      return true
    }
    return false
  }

  private expect(value: string): void {
    const token = this.next()
    if (token.value !== value) {
      throw new ExpressionError(
        `Expected "${value}" but found "${token.value || 'end of expression'}" at position ${token.pos}.`,
      )
    }
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) {
      throw new ExpressionError(`Expression nests deeper than ${MAX_DEPTH} levels.`)
    }
  }

  private exit(): void {
    this.depth--
  }

  parse(): ExprValue {
    const value = this.ternary()
    const trailing = this.peek()
    if (trailing.type !== 'eof') {
      throw new ExpressionError(
        `Unexpected "${trailing.value}" at position ${trailing.pos}.`,
      )
    }
    return value
  }

  /** Right-associative, lowest precedence. */
  private ternary(): ExprValue {
    this.enter()
    try {
      const condition = this.logicalOr()
      if (this.peek().value !== '?') return condition

      this.expect('?')
      const whenTrue = this.ternary()
      this.expect(':')
      const whenFalse = this.ternary()

      // An indeterminate condition makes the whole result indeterminate rather
      // than silently taking the false branch.
      if (condition === null) return null
      return truthy(condition) ? whenTrue : whenFalse
    } finally {
      this.exit()
    }
  }

  private logicalOr(): ExprValue {
    let left = this.logicalAnd()
    while (this.matchOp('||')) {
      const right = this.logicalAnd()
      left = nullish(left, right) ? null : truthy(left) || truthy(right)
    }
    return left
  }

  private logicalAnd(): ExprValue {
    let left = this.equality()
    while (this.matchOp('&&')) {
      const right = this.equality()
      left = nullish(left, right) ? null : truthy(left) && truthy(right)
    }
    return left
  }

  /**
   * Equality tolerates null on either side and compares by value, so
   * `direction == "LONG"` is false rather than null for an unset direction.
   */
  private equality(): ExprValue {
    let left = this.relational()
    for (;;) {
      if (this.matchOp('==') || this.matchOp('===')) {
        left = left === this.relational()
      } else if (this.matchOp('!=') || this.matchOp('!==')) {
        left = left !== this.relational()
      } else {
        return left
      }
    }
  }

  private relational(): ExprValue {
    let left = this.additive()
    for (;;) {
      const token = this.peek()
      if (token.type !== 'op' || !['<', '>', '<=', '>='].includes(token.value)) return left
      this.index++
      const right = this.additive()
      if (!isNum(left) || !isNum(right)) {
        left = null
        continue
      }
      left =
        token.value === '<' ? left < right
        : token.value === '>' ? left > right
        : token.value === '<=' ? left <= right
        : left >= right
    }
  }

  private additive(): ExprValue {
    let left = this.multiplicative()
    for (;;) {
      if (this.matchOp('+')) {
        const right = this.multiplicative()
        // String concatenation is deliberately unsupported: computed fields are
        // numeric readouts, and allowing it invites accidental "1" + 1 bugs.
        left = isNum(left) && isNum(right) ? left + right : null
      } else if (this.matchOp('-')) {
        const right = this.multiplicative()
        left = isNum(left) && isNum(right) ? left - right : null
      } else {
        return left
      }
    }
  }

  private multiplicative(): ExprValue {
    let left = this.unary()
    for (;;) {
      const token = this.peek()
      if (token.type !== 'op' || !['*', '/', '%'].includes(token.value)) return left
      this.index++
      const right = this.unary()

      if (!isNum(left) || !isNum(right)) {
        left = null
        continue
      }
      if (token.value === '*') {
        left = left * right
        continue
      }
      // Division and modulo by zero yield null, not Infinity or NaN — a
      // stop-loss equal to the entry price is user error, not a crash.
      if (right === 0) {
        left = null
        continue
      }
      left = token.value === '/' ? left / right : left % right
    }
  }

  private unary(): ExprValue {
    if (this.matchOp('-')) {
      const value = this.unary()
      return isNum(value) ? -value : null
    }
    if (this.matchOp('+')) {
      const value = this.unary()
      return isNum(value) ? value : null
    }
    if (this.matchOp('!')) {
      const value = this.unary()
      return value === null ? null : !truthy(value)
    }
    return this.primary()
  }

  private primary(): ExprValue {
    this.enter()
    try {
      const token = this.next()

      if (token.type === 'number') return Number(token.value)
      if (token.type === 'string') return token.value

      if (token.type === 'punct' && token.value === '(') {
        const value = this.ternary()
        this.expect(')')
        return value
      }

      if (token.type === 'ident') {
        // Call position: resolved against the fixed FUNCTIONS table only.
        if (this.peek().value === '(') {
          this.expect('(')
          const args: ExprValue[] = []
          if (this.peek().value !== ')') {
            do {
              args.push(this.ternary())
            } while (this.matchPunct(','))
          }
          this.expect(')')

          const fn = Object.hasOwn(FUNCTIONS, token.value)
            ? FUNCTIONS[token.value]
            : undefined
          if (!fn) {
            throw new ExpressionError(
              `Unknown function "${token.value}". Available: ${Object.keys(FUNCTIONS).join(', ')}.`,
            )
          }
          return fn(args)
        }

        if (token.value === 'true') return true
        if (token.value === 'false') return false
        if (token.value === 'null') return null

        this.seen?.add(token.value)
        // hasOwn, so inherited and prototype properties are invisible.
        return Object.hasOwn(this.scope, token.value) ? this.scope[token.value]! : null
      }

      throw new ExpressionError(
        `Unexpected "${token.value || 'end of expression'}" at position ${token.pos}.`,
      )
    } finally {
      this.exit()
    }
  }

  private matchPunct(value: string): boolean {
    if (this.peek().type === 'punct' && this.peek().value === value) {
      this.index++
      return true
    }
    return false
  }
}

function truthy(value: ExprValue): boolean {
  if (value === null) return false
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value !== ''
  return value
}

function nullish(a: ExprValue, b: ExprValue): boolean {
  return a === null || b === null
}

/**
 * Coerces a stored journal field value into something the evaluator can use.
 * Empty strings become null so blank inputs behave like absent ones.
 */
function coerce(value: unknown): ExprValue {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    // Numeric-looking strings compute; everything else compares as text.
    const asNumber = Number(trimmed)
    return Number.isFinite(asNumber) && /^-?[0-9.]+$/.test(trimmed) ? asNumber : trimmed
  }
  // Arrays and objects (multiselect, attachments) are not computable.
  return null
}

/** Builds the flat, own-properties-only scope handed to the evaluator. */
function buildScope(data: Record<string, unknown>): Record<string, ExprValue> {
  const scope: Record<string, ExprValue> = Object.create(null)
  for (const key of Object.keys(data)) {
    scope[key] = coerce(data[key])
  }
  return scope
}

/**
 * Evaluates one computed-field expression against an entry's data.
 * Returns null rather than throwing when the inputs are incomplete; throws only
 * when the expression itself is malformed.
 */
export function evaluateExpression(
  expression: string,
  data: Record<string, unknown>,
): ExprValue {
  if (expression.length > MAX_LENGTH) {
    throw new ExpressionError(`Expression exceeds ${MAX_LENGTH} characters.`)
  }
  const tokens = tokenize(expression)
  return new Evaluator(tokens, buildScope(data)).parse()
}

export interface ExpressionValidation {
  ok: boolean
  error?: string
  /** Identifiers the expression reads. */
  references: string[]
  /** References not present in the definition's field schema. */
  unknownReferences: string[]
}

/**
 * Checks an expression when a JournalDefinition is saved, so a typo surfaces in
 * the admin form instead of quietly producing null on every entry forever.
 */
export function validateExpression(
  expression: string,
  knownFieldKeys: readonly string[],
): ExpressionValidation {
  if (expression.length > MAX_LENGTH) {
    return {
      ok: false,
      error: `Expression exceeds ${MAX_LENGTH} characters.`,
      references: [],
      unknownReferences: [],
    }
  }

  const seen = new Set<string>()
  try {
    // Parse against an empty scope: we only care about syntax and identifiers,
    // and null-propagation makes the resulting value meaningless here.
    new Evaluator(tokenize(expression), Object.create(null), seen).parse()
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid expression.',
      references: [...seen],
      unknownReferences: [],
    }
  }

  const known = new Set(knownFieldKeys)
  const unknownReferences = [...seen].filter((ref) => !known.has(ref))

  return {
    ok: unknownReferences.length === 0,
    error:
      unknownReferences.length > 0
        ? `Unknown field(s): ${unknownReferences.join(', ')}.`
        : undefined,
    references: [...seen],
    unknownReferences,
  }
}
