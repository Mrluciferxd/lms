/**
 * Playback URL signing.
 *
 * Pure functions, no I/O, so the parts that must be exactly right are unit
 * testable. Two schemes:
 *
 *  - `signBunnyToken` implements Bunny's CDN token authentication.
 *  - `signLocalToken` / `verifyLocalToken` is our own HMAC scheme for the local
 *    development provider, where we control both ends.
 *
 * ── A HONEST CAVEAT ON THE BUNNY SIGNATURE ──────────────────────────────────
 * This is implemented from Bunny's documented algorithm, but it has NOT been
 * validated against a live library, because this project has no Bunny credentials
 * yet (they are a client-provisioned dependency — see docs/04-white-label.md).
 * The tests below verify the properties I can verify locally: determinism,
 * URL-safe alphabet, sensitivity to every input, and correct query assembly.
 * They cannot verify that Bunny's edge accepts the result.
 *
 * Validate this against a real library as the first step of video integration.
 * A wrong hash composition fails closed — every playback 403s — so it will be
 * obvious immediately rather than subtly, but budget the check.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Base64 → URL-safe, unpadded, as CDN token schemes expect. */
function toUrlSafeBase64(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\n/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export interface BunnyTokenInput {
  /** Library's token authentication key. Never leaves the server. */
  securityKey: string
  /**
   * Path the token authorises. Use a directory (`/{videoId}/`) rather than a
   * single file, so the HLS manifest and every segment underneath validate with
   * one token — otherwise each segment request would need its own signature.
   */
  tokenPath: string
  /** Unix seconds. */
  expiresAtUnix: number
  /** Optional client IP binding. */
  ip?: string | null
}

export interface BunnyTokenResult {
  token: string
  expiresAtUnix: number
  tokenPath: string
}

export function signBunnyToken(input: BunnyTokenInput): BunnyTokenResult {
  if (!input.securityKey) {
    throw new Error('Bunny token security key is empty.')
  }
  if (!input.tokenPath.startsWith('/')) {
    throw new Error(`Bunny token path must start with "/", got "${input.tokenPath}".`)
  }

  // Documented composition: securityKey + path + expiry [+ ip], SHA-256, raw
  // digest, then URL-safe base64.
  const hashable = `${input.securityKey}${input.tokenPath}${input.expiresAtUnix}${input.ip ?? ''}`
  const digest = createHash('sha256').update(hashable, 'utf8').digest()

  return {
    token: toUrlSafeBase64(digest),
    expiresAtUnix: input.expiresAtUnix,
    tokenPath: input.tokenPath,
  }
}

/** Assembles the signed playback URL from a token result. */
export function buildBunnyUrl(
  cdnHostname: string,
  filePath: string,
  token: BunnyTokenResult,
): string {
  const host = cdnHostname.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const path = filePath.startsWith('/') ? filePath : `/${filePath}`
  const query = new URLSearchParams({
    token: token.token,
    expires: String(token.expiresAtUnix),
    token_path: token.tokenPath,
  })
  return `https://${host}${path}?${query.toString()}`
}

/**
 * Bunny TUS upload signature.
 *
 * Why TUS rather than a plain PUT: Bunny's direct upload endpoint authenticates
 * with the library API key in a header, which cannot be handed to a browser
 * without leaking full write access to the whole video library. The TUS endpoint
 * instead accepts a pre-computed, expiring signature scoped to one video id — so
 * the client uploads directly (no bandwidth through our server, no serverless
 * body-size limit) while the API key stays server-side.
 *
 * Hex rather than base64 here; that is what this endpoint expects, unlike the CDN
 * token above. Same "not verified against a live library" caveat applies.
 */
export interface BunnyUploadSignatureInput {
  libraryId: string
  apiKey: string
  videoId: string
  expiresAtUnix: number
}

export function signBunnyUploadSignature(input: BunnyUploadSignatureInput): string {
  if (!input.apiKey) throw new Error('Bunny API key is empty.')
  return createHash('sha256')
    .update(`${input.libraryId}${input.apiKey}${input.expiresAtUnix}${input.videoId}`, 'utf8')
    .digest('hex')
}

// -----------------------------------------------------------------------------
// Local development provider
// -----------------------------------------------------------------------------

export interface LocalTokenInput {
  secret: string
  assetId: string
  viewerId: string
  expiresAtUnix: number
}

/**
 * HMAC over the fields joined by a character that cannot appear in a cuid or a
 * decimal timestamp. Joining without a separator would let ("ab","c") and
 * ("a","bc") produce the same signature — a boundary-confusion forgery.
 */
function localPayload(input: Omit<LocalTokenInput, 'secret'>): string {
  return [input.assetId, input.viewerId, input.expiresAtUnix].join('|')
}

export function signLocalToken(input: LocalTokenInput): string {
  if (!input.secret) throw new Error('Local playback signing secret is empty.')
  const mac = createHmac('sha256', input.secret).update(localPayload(input), 'utf8').digest()
  return toUrlSafeBase64(mac)
}

export type LocalTokenVerdict =
  | { valid: true }
  | { valid: false; reason: 'EXPIRED' | 'BAD_SIGNATURE' | 'MALFORMED' }

export function verifyLocalToken(
  token: string,
  input: LocalTokenInput,
  nowUnix: number,
): LocalTokenVerdict {
  if (!token) return { valid: false, reason: 'MALFORMED' }

  // Expiry is checked first and independently: an expired token must be rejected
  // even if the signature is perfectly valid.
  if (input.expiresAtUnix <= nowUnix) return { valid: false, reason: 'EXPIRED' }

  const expected = signLocalToken(input)
  const provided = Buffer.from(token)
  const candidate = Buffer.from(expected)

  // Length check before timingSafeEqual, which throws on a length mismatch.
  if (provided.length !== candidate.length) return { valid: false, reason: 'BAD_SIGNATURE' }
  if (!timingSafeEqual(provided, candidate)) return { valid: false, reason: 'BAD_SIGNATURE' }

  return { valid: true }
}

/** Seconds since epoch, floored. */
export function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}
