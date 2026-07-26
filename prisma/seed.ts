/**
 * Deployment seed.
 *
 * Mirrors the build-time brand config into the runtime OrgSettings row and
 * ensures an owner account exists. Idempotent: safe to re-run after a brand
 * config change to pick up new defaults.
 *
 * Deliberately does NOT seed sample content. A client database should start
 * empty of courses and students — demo data that reaches production is worse
 * than no demo data.
 */

import 'dotenv/config'

import { brand } from '../src/lib/brand'
import { auditBrandContrast } from '../src/lib/brand/theme'
import { hashPassword } from '../src/server/auth/password'
import { db } from '../src/server/db'
import { ORG_SETTINGS_ID } from '../src/server/org/settings'

/**
 * Owner password is never defaulted to a known value. If the environment does
 * not supply one, a random password is generated and printed once — a hardcoded
 * fallback would ship the same credentials to every client deployment.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

async function seedOrgSettings(): Promise<void> {
  const mirrored = {
    name: brand.name,
    legalName: brand.legalName ?? null,
    supportEmail: brand.supportEmail,
    supportPhone: brand.supportPhone ?? null,
    logoLightUrl: brand.logo.light,
    logoDarkUrl: brand.logo.dark ?? null,
    faviconUrl: brand.logo.favicon ?? null,
    primaryColor: brand.theme.primary,
    accentColor: brand.theme.accent ?? null,
    timezone: brand.timezone,
    locale: brand.locale,
    currency: brand.currency,
    enabledPacks: [...brand.packs],
    watermarkTemplate: brand.videoSecurity.watermarkTemplate,
  }

  await db.orgSettings.upsert({
    where: { id: ORG_SETTINGS_ID },
    // featureFlags is intentionally omitted from `update`: it is admin-owned at
    // runtime, and overwriting it here would silently undo their choices on
    // every deploy.
    update: mirrored,
    create: { id: ORG_SETTINGS_ID, ...mirrored, featureFlags: {} },
  })

  console.log(`✓ OrgSettings synced from brand "${brand.key}"`)
}

async function seedOwner(): Promise<void> {
  const email = (process.env.SEED_OWNER_EMAIL ?? brand.supportEmail).toLowerCase()
  // Single word: the dashboard greets by first name, and "Account Owner" would
  // render as "Welcome back, Account".
  const name = process.env.SEED_OWNER_NAME ?? 'Owner'

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  })

  if (existing) {
    // Re-running the seed must not reset a live owner's password.
    if (existing.role !== 'OWNER') {
      await db.user.update({ where: { id: existing.id }, data: { role: 'OWNER' } })
      console.log(`✓ Promoted existing user ${email} to OWNER`)
    } else {
      console.log(`✓ Owner ${email} already exists — left unchanged`)
    }
    return
  }

  const supplied = process.env.SEED_OWNER_PASSWORD
  const password = supplied ?? generatePassword()

  const owner = await db.user.create({
    data: {
      email,
      name,
      role: 'OWNER',
      status: 'ACTIVE',
      passwordHash: await hashPassword(password),
      emailVerified: new Date(),
      timezone: brand.timezone,
    },
    select: { id: true },
  })

  await db.auditLog.create({
    data: {
      actorId: owner.id,
      action: 'user.created',
      entityType: 'User',
      entityId: owner.id,
      meta: { via: 'seed', role: 'OWNER' },
    },
  })

  console.log(`✓ Created owner ${email}`)
  if (!supplied) {
    console.log('')
    console.log('  ' + '─'.repeat(60))
    console.log('  Generated owner password — shown once. Store it now.')
    console.log('')
    console.log(`      ${password}`)
    console.log('')
    console.log('  Set SEED_OWNER_PASSWORD to choose your own instead.')
    console.log('  ' + '─'.repeat(60))
  }
}

/**
 * Colour accessibility check. Surfaced at onboarding because a client's brand
 * palette is chosen by their designer, and a mid-tone primary that no foreground
 * can make readable is far cheaper to catch now than after launch.
 */
function reportContrast(): void {
  const warnings = auditBrandContrast(brand)
  if (warnings.length === 0) return

  console.warn('')
  console.warn('⚠ Brand colour accessibility warnings:')
  for (const warning of warnings) {
    console.warn(
      `  ${warning.token} = ${warning.ratio}:1 against its best foreground — below the WCAG AA minimum of 4.5:1.`,
    )
  }
  console.warn('  Text on this colour will be hard to read. Consider darkening or lightening it.')
  console.warn('')
}

async function main(): Promise<void> {
  console.log(`Seeding deployment for brand "${brand.key}"…`)
  reportContrast()
  await seedOrgSettings()
  await seedOwner()
  console.log('')
  console.log('Next: npm run packs:install')
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    void db.$disconnect()
  })
