import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildBunnyUrl,
  signBunnyToken,
  signLocalToken,
  unixSeconds,
  verifyLocalToken,
} from './signing'

const EXPIRES = 1_800_000_000
const NOW = EXPIRES - 300

describe('signBunnyToken', () => {
  const base = {
    securityKey: 'test-security-key',
    tokenPath: '/abc-123/',
    expiresAtUnix: EXPIRES,
  }

  it('is deterministic', () => {
    assert.equal(signBunnyToken(base).token, signBunnyToken(base).token)
  })

  it('produces a URL-safe unpadded token', () => {
    const { token } = signBunnyToken(base)
    assert.match(token, /^[A-Za-z0-9_-]+$/, `token not URL-safe: ${token}`)
    assert.ok(!token.includes('='))
    assert.ok(!token.includes('+'))
    assert.ok(!token.includes('/'))
  })

  it('is a 256-bit digest, so 43 URL-safe base64 characters', () => {
    assert.equal(signBunnyToken(base).token.length, 43)
  })

  /**
   * Each of these must change the signature. A signature insensitive to path
   * would let one token authorise any video; insensitive to expiry would make
   * tokens eternal.
   */
  it('changes when the security key changes', () => {
    assert.notEqual(
      signBunnyToken(base).token,
      signBunnyToken({ ...base, securityKey: 'other-key' }).token,
    )
  })

  it('changes when the path changes', () => {
    assert.notEqual(
      signBunnyToken(base).token,
      signBunnyToken({ ...base, tokenPath: '/def-456/' }).token,
    )
  })

  it('changes when the expiry changes', () => {
    assert.notEqual(
      signBunnyToken(base).token,
      signBunnyToken({ ...base, expiresAtUnix: EXPIRES + 1 }).token,
    )
  })

  it('changes when an IP binding is added', () => {
    assert.notEqual(signBunnyToken(base).token, signBunnyToken({ ...base, ip: '1.2.3.4' }).token)
  })

  it('treats a null IP as absent rather than as the string "null"', () => {
    assert.equal(signBunnyToken(base).token, signBunnyToken({ ...base, ip: null }).token)
  })

  it('rejects an empty security key instead of signing with nothing', () => {
    assert.throws(() => signBunnyToken({ ...base, securityKey: '' }), /security key is empty/)
  })

  it('rejects a path that is not rooted, which would silently mis-scope the token', () => {
    assert.throws(() => signBunnyToken({ ...base, tokenPath: 'abc-123/' }), /must start with/)
  })
})

describe('buildBunnyUrl', () => {
  const token = signBunnyToken({
    securityKey: 'k',
    tokenPath: '/vid/',
    expiresAtUnix: EXPIRES,
  })

  it('assembles host, path and all three query parameters', () => {
    const url = new URL(buildBunnyUrl('cdn.example.net', '/vid/playlist.m3u8', token))
    assert.equal(url.protocol, 'https:')
    assert.equal(url.hostname, 'cdn.example.net')
    assert.equal(url.pathname, '/vid/playlist.m3u8')
    assert.equal(url.searchParams.get('token'), token.token)
    assert.equal(url.searchParams.get('expires'), String(EXPIRES))
    assert.equal(url.searchParams.get('token_path'), '/vid/')
  })

  it('tolerates a hostname given with a scheme or trailing slash', () => {
    for (const host of ['https://cdn.example.net', 'cdn.example.net/', 'https://cdn.example.net/']) {
      const url = new URL(buildBunnyUrl(host, '/vid/playlist.m3u8', token))
      assert.equal(url.hostname, 'cdn.example.net')
      assert.equal(url.pathname, '/vid/playlist.m3u8')
    }
  })

  it('roots a path given without a leading slash', () => {
    const url = new URL(buildBunnyUrl('cdn.example.net', 'vid/playlist.m3u8', token))
    assert.equal(url.pathname, '/vid/playlist.m3u8')
  })

  /**
   * The manifest sits under the token path, so segments requested relative to it
   * are covered by the same token.
   */
  it('signs a directory that contains the manifest', () => {
    const url = new URL(buildBunnyUrl('cdn.example.net', '/vid/playlist.m3u8', token))
    assert.ok(url.pathname.startsWith(url.searchParams.get('token_path')!))
  })
})

describe('local token', () => {
  const base = {
    secret: 'local-dev-secret',
    assetId: 'asset_abc',
    viewerId: 'user_123',
    expiresAtUnix: EXPIRES,
  }

  it('verifies a freshly signed token', () => {
    assert.deepEqual(verifyLocalToken(signLocalToken(base), base, NOW), { valid: true })
  })

  it('rejects an expired token even though the signature is valid', () => {
    const token = signLocalToken(base)
    const verdict = verifyLocalToken(token, base, EXPIRES + 1)
    assert.equal(verdict.valid, false)
    assert.equal(verdict.valid === false && verdict.reason, 'EXPIRED')
  })

  it('rejects exactly at the expiry second', () => {
    const verdict = verifyLocalToken(signLocalToken(base), base, EXPIRES)
    assert.equal(verdict.valid === false && verdict.reason, 'EXPIRED')
  })

  /** A token issued to one student must not play another student's asset. */
  it('is bound to the viewer', () => {
    const token = signLocalToken(base)
    const verdict = verifyLocalToken(token, { ...base, viewerId: 'user_999' }, NOW)
    assert.equal(verdict.valid === false && verdict.reason, 'BAD_SIGNATURE')
  })

  it('is bound to the asset', () => {
    const token = signLocalToken(base)
    const verdict = verifyLocalToken(token, { ...base, assetId: 'asset_other' }, NOW)
    assert.equal(verdict.valid === false && verdict.reason, 'BAD_SIGNATURE')
  })

  it('is bound to the expiry, so the client cannot extend its own token', () => {
    const token = signLocalToken(base)
    const verdict = verifyLocalToken(token, { ...base, expiresAtUnix: EXPIRES + 3600 }, NOW)
    assert.equal(verdict.valid === false && verdict.reason, 'BAD_SIGNATURE')
  })

  it('rejects a token signed with a different secret', () => {
    const forged = signLocalToken({ ...base, secret: 'attacker-secret' })
    const verdict = verifyLocalToken(forged, base, NOW)
    assert.equal(verdict.valid === false && verdict.reason, 'BAD_SIGNATURE')
  })

  it('rejects an empty token as malformed', () => {
    const verdict = verifyLocalToken('', base, NOW)
    assert.equal(verdict.valid === false && verdict.reason, 'MALFORMED')
  })

  it('rejects a wrong-length token without throwing', () => {
    assert.doesNotThrow(() => verifyLocalToken('short', base, NOW))
    const verdict = verifyLocalToken('short', base, NOW)
    assert.equal(verdict.valid === false && verdict.reason, 'BAD_SIGNATURE')
  })

  /**
   * Field boundaries are separated, so a shifted split cannot collide. Without a
   * separator, ("ab","c") and ("a","bc") would sign identically.
   */
  it('cannot be forged by shifting the boundary between asset and viewer', () => {
    const a = signLocalToken({ ...base, assetId: 'ab', viewerId: 'c' })
    const b = signLocalToken({ ...base, assetId: 'a', viewerId: 'bc' })
    assert.notEqual(a, b)
  })

  it('rejects an empty secret rather than signing with nothing', () => {
    assert.throws(() => signLocalToken({ ...base, secret: '' }), /secret is empty/)
  })
})

describe('unixSeconds', () => {
  it('converts a date to whole seconds since epoch', () => {
    assert.equal(unixSeconds(new Date('1970-01-01T00:00:00.000Z')), 0)
    assert.equal(unixSeconds(new Date('1970-01-01T00:01:00.000Z')), 60)
  })

  it('floors rather than rounds, so a token never gains a second of life', () => {
    assert.equal(unixSeconds(new Date('1970-01-01T00:00:01.999Z')), 1)
  })

  it('discards milliseconds', () => {
    const withMs = new Date('2026-07-26T12:00:00.999Z')
    const withoutMs = new Date('2026-07-26T12:00:00.000Z')
    assert.equal(unixSeconds(withMs), unixSeconds(withoutMs))
  })
})
