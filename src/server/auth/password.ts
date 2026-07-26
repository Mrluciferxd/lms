import bcrypt from 'bcryptjs'
import { z } from 'zod'

/**
 * Cost factor. 12 is roughly 250ms on current server hardware — slow enough to
 * make offline cracking expensive, fast enough that a sign-in does not feel
 * broken. Raise it as hardware improves; existing hashes keep their own cost
 * factor and are rehashed on next successful sign-in via `needsRehash`.
 */
const BCRYPT_ROUNDS = 12

/**
 * A precomputed hash of a random string, compared against when no user exists.
 *
 * Without this, "no such user" returns in ~1ms while "wrong password" takes
 * ~250ms, and that timing difference tells an attacker which email addresses
 * have accounts. For a paid cohort programme that is a real disclosure — the
 * student roster is not public information.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.OFDFCLo7RSHIzZBLQr9Q9dJn5cLMuXK'

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password must be at most 200 characters')

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * Constant-ish-time rejection for a nonexistent account. Always await this on the
 * "user not found" path so both outcomes cost the same bcrypt work.
 */
export async function burnPasswordComparison(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_HASH)
  return false
}

/** True when a stored hash was created with a lower cost factor than current. */
export function needsRehash(hash: string): boolean {
  const rounds = bcrypt.getRounds(hash)
  return rounds < BCRYPT_ROUNDS
}
