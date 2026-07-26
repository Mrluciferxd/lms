/**
 * Development helper: builds a course with a real playable video so the protected
 * player, drip locking and concurrency limits can be exercised end to end.
 *
 * Not part of `db:seed` — a client database must start with no sample content.
 * Guarded against running in production.
 */

import 'dotenv/config'

import { copyFile } from 'node:fs/promises'

import { hashPassword } from '../src/server/auth/password'
import { db, disconnectDb } from '../src/server/db'
import { enrollUser } from '../src/server/enrollments/enroll'
import { ensureLocalStorage, localMediaPath } from '../src/server/media/local'

const SOURCE_VIDEO = process.argv[2]

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo content in production.')
  }
  if (!SOURCE_VIDEO) {
    throw new Error('Usage: tsx scripts/seed-demo-course.ts <path-to-mp4>')
  }

  const owner = await db.user.findFirst({
    where: { role: 'OWNER' },
    select: { id: true, email: true },
  })
  if (!owner) throw new Error('No owner found. Run `npm run db:seed` first.')

  // Local provider stores bytes on disk keyed by the provider asset id.
  const providerAssetId = 'demo-lecture-01'
  await ensureLocalStorage()
  await copyFile(SOURCE_VIDEO, localMediaPath(providerAssetId))

  const asset = await db.mediaAsset.upsert({
    where: { id: 'demo-asset-01' },
    update: { status: 'READY' },
    create: {
      id: 'demo-asset-01',
      provider: 'LOCAL',
      providerAssetId,
      playbackId: providerAssetId,
      type: 'VIDEO',
      status: 'READY',
      title: 'Demo lecture',
      durationSec: 10,
      drmEnabled: false,
      watermarkEnabled: true,
      downloadable: false,
      maxConcurrentStreams: 0,
      uploadedById: owner.id,
    },
    select: { id: true },
  })

  await db.course.deleteMany({ where: { slug: 'demo-programme' } })

  const course = await db.course.create({
    data: {
      slug: 'demo-programme',
      title: 'Demo Programme',
      subtitle: 'Exercises the protected player, drip locking and concurrency limits',
      status: 'PUBLISHED',
      priceMinor: 2_500_000,
      sections: {
        create: [
          {
            title: 'Getting started',
            order: 0,
            lessons: {
              create: [
                {
                  title: 'Welcome — plays now',
                  order: 0,
                  type: 'VIDEO',
                  releaseMode: 'IMMEDIATE',
                  videoAssetId: asset.id,
                  durationSec: 10,
                },
                {
                  title: 'Free preview lesson',
                  order: 1,
                  type: 'VIDEO',
                  releaseMode: 'IMMEDIATE',
                  isPreview: true,
                  videoAssetId: asset.id,
                  durationSec: 10,
                },
              ],
            },
          },
          {
            title: 'Drip-scheduled content',
            order: 1,
            lessons: {
              create: [
                {
                  title: 'Unlocks 30 days after enrollment',
                  order: 0,
                  type: 'VIDEO',
                  releaseMode: 'DAYS_AFTER_ENROLLMENT',
                  releaseOffsetDays: 30,
                  videoAssetId: asset.id,
                  durationSec: 10,
                },
                {
                  title: 'Held for manual release',
                  order: 1,
                  type: 'VIDEO',
                  releaseMode: 'MANUAL',
                  videoAssetId: asset.id,
                  durationSec: 10,
                },
                {
                  title: 'Scheduled for a fixed future date',
                  order: 2,
                  type: 'VIDEO',
                  releaseMode: 'FIXED_DATE',
                  releaseAt: new Date(Date.now() + 60 * 86_400_000),
                  videoAssetId: asset.id,
                  durationSec: 10,
                },
              ],
            },
          },
        ],
      },
    },
    select: { id: true, slug: true },
  })

  /**
   * A student account, which is the only way to see the drip locks — staff bypass
   * them by design. Hashed here rather than pasted as a literal: a hardcoded hash
   * cannot be verified by reading it, and one that does not match its stated
   * password is a bug that only shows up when someone tries to sign in.
   */
  const studentPassword = process.env.DEMO_STUDENT_PASSWORD ?? 'demo-student-pass-01'
  const student = await db.user.upsert({
    where: { email: 'student@demo.local' },
    update: { status: 'ACTIVE', passwordHash: await hashPassword(studentPassword) },
    create: {
      email: 'student@demo.local',
      name: 'Asha',
      role: 'STUDENT',
      status: 'ACTIVE',
      passwordHash: await hashPassword(studentPassword),
      emailVerified: new Date(),
    },
    select: { id: true },
  })

  // Via enrollUser, not a bare upsert: a compound unique containing a nullable
  // batchId cannot be targeted by Prisma. See src/server/enrollments/enroll.ts.
  for (const userId of [owner.id, student.id]) {
    await enrollUser({ userId, courseId: course.id, source: 'MANUAL', actorId: owner.id })
  }

  console.log(`✓ Created /app/courses/${course.slug}`)
  console.log('  5 lessons: 2 playable, 3 locked by different drip rules')
  console.log(`  Enrolled: ${owner.email} (owner, bypasses drip)`)
  console.log(`  Student:  student@demo.local / ${studentPassword}`)
}

main()
  .catch((error: unknown) => {
    console.error('Demo seed failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => void disconnectDb())
