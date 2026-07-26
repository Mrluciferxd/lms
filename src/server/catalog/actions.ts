'use server'

/**
 * Catalog mutations.
 *
 * Every action re-checks its permission server-side. A hidden button is not
 * authorization: server actions are directly invocable endpoints, so the check
 * has to live here rather than in whatever rendered the form.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { slugify } from '@/lib/utils'
import { recordAudit } from '@/server/audit'
import { authorizeRequest } from '@/server/auth/rbac'
import { db } from '@/server/db'

export interface ActionResult {
  ok: boolean
  error?: string
  /** Field-level messages, keyed by field name. */
  fieldErrors?: Record<string, string>
  /** Set by create actions so the caller can navigate. */
  id?: string
}

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult {
  return { ok: false, error, fieldErrors }
}

function firstIssues(error: z.ZodError): Record<string, string> {
  const flattened = error.flatten().fieldErrors
  return Object.fromEntries(
    Object.entries(flattened)
      .filter(([, messages]) => messages && messages.length > 0)
      .map(([field, messages]) => [field, messages![0]!]),
  )
}

// -----------------------------------------------------------------------------
// Courses
// -----------------------------------------------------------------------------

const courseSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  slug: z
    .string()
    .trim()
    .max(120)
    .regex(/^[a-z0-9-]*$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
  subtitle: z.string().trim().max(300).optional(),
  description: z.string().trim().max(20_000).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  /** Rupees in the form; converted to paise for storage. */
  price: z.coerce.number().min(0).max(10_000_000).optional(),
  accessDurationDays: z.coerce.number().int().min(1).max(3650).optional(),
})

export async function createCourse(formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to create courses.')

  const parsed = courseSchema.safeParse({
    title: formData.get('title'),
    slug: formData.get('slug') || undefined,
    subtitle: formData.get('subtitle') || undefined,
    description: formData.get('description') || undefined,
    status: formData.get('status') ?? 'DRAFT',
    price: formData.get('price') || undefined,
    accessDurationDays: formData.get('accessDurationDays') || undefined,
  })

  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const slug = slugify(parsed.data.slug || parsed.data.title)
  if (!slug) return fail('Could not derive a URL slug from that title.', { slug: 'Required' })

  const clash = await db.course.findUnique({ where: { slug }, select: { id: true } })
  if (clash) return fail('That slug is already in use.', { slug: 'Already in use' })

  const course = await db.course.create({
    data: {
      slug,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? null,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      // Money is stored as integer minor units, never a float.
      priceMinor: parsed.data.price !== undefined ? Math.round(parsed.data.price * 100) : null,
      accessDurationDays: parsed.data.accessDurationDays ?? null,
    },
    select: { id: true },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'course.created',
    entityType: 'Course',
    entityId: course.id,
    meta: { slug, title: parsed.data.title },
  })

  revalidatePath('/admin/courses')
  return { ok: true, id: course.id }
}

export async function updateCourse(courseId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const parsed = courseSchema.safeParse({
    title: formData.get('title'),
    slug: formData.get('slug') || undefined,
    subtitle: formData.get('subtitle') || undefined,
    description: formData.get('description') || undefined,
    status: formData.get('status') ?? 'DRAFT',
    price: formData.get('price') || undefined,
    accessDurationDays: formData.get('accessDurationDays') || undefined,
  })

  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  // Publishing is a separate, higher permission than editing: it is what makes
  // content visible to paying students.
  const existing = await db.course.findUnique({
    where: { id: courseId },
    select: { status: true, slug: true },
  })
  if (!existing) return fail('Course not found.')

  if (parsed.data.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
    const publishAuth = await authorizeRequest('course:publish')
    if (!publishAuth.ok) return fail('You do not have permission to publish courses.')
  }

  const slug = slugify(parsed.data.slug || parsed.data.title)
  if (slug !== existing.slug) {
    const clash = await db.course.findUnique({ where: { slug }, select: { id: true } })
    if (clash) return fail('That slug is already in use.', { slug: 'Already in use' })
  }

  await db.course.update({
    where: { id: courseId },
    data: {
      slug,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? null,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      priceMinor: parsed.data.price !== undefined ? Math.round(parsed.data.price * 100) : null,
      accessDurationDays: parsed.data.accessDurationDays ?? null,
    },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: existing.status !== parsed.data.status ? 'course.status_changed' : 'course.updated',
    entityType: 'Course',
    entityId: courseId,
    meta: { from: existing.status, to: parsed.data.status },
  })

  revalidatePath('/admin/courses')
  revalidatePath(`/admin/courses/${courseId}`)
  revalidatePath(`/app/courses/${slug}`)
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

export async function createSection(courseId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const title = String(formData.get('title') ?? '').trim()
  if (title.length < 2) return fail('Section title is too short.', { title: 'Required' })

  // Append at the end.
  const last = await db.section.findFirst({
    where: { courseId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const section = await db.section.create({
    data: { courseId, title, order: (last?.order ?? -1) + 1 },
    select: { id: true },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'section.created',
    entityType: 'Section',
    entityId: section.id,
    meta: { courseId, title },
  })

  revalidatePath(`/admin/courses/${courseId}`)
  return { ok: true, id: section.id }
}

export async function deleteSection(sectionId: string): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const section = await db.section.findUnique({
    where: { id: sectionId },
    select: { courseId: true, title: true, _count: { select: { lessons: true } } },
  })
  if (!section) return fail('Section not found.')

  // Deleting cascades to lessons and their progress rows, so make the caller
  // empty it first rather than silently destroying student history.
  if (section._count.lessons > 0) {
    return fail(
      `Move or delete this section's ${section._count.lessons} lesson(s) first — deleting it would remove student progress for them.`,
    )
  }

  await db.section.delete({ where: { id: sectionId } })

  await recordAudit({
    actorId: auth.user.id,
    action: 'section.deleted',
    entityType: 'Section',
    entityId: sectionId,
    meta: { title: section.title },
  })

  revalidatePath(`/admin/courses/${section.courseId}`)
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Lessons
// -----------------------------------------------------------------------------

const lessonSchema = z.object({
  title: z.string().trim().min(2, 'Title is too short').max(200),
  summary: z.string().trim().max(1000).optional(),
  type: z.enum(['VIDEO', 'TEXT', 'PDF', 'QUIZ', 'ASSIGNMENT', 'LIVE', 'EMBED']),
  isPreview: z.boolean(),
  isMandatory: z.boolean(),
  videoAssetId: z.string().trim().optional(),
  durationSec: z.coerce.number().int().min(0).max(24 * 60 * 60).optional(),
  releaseMode: z.enum([
    'IMMEDIATE',
    'DAYS_AFTER_ENROLLMENT',
    'DAYS_AFTER_BATCH_START',
    'FIXED_DATE',
    'AFTER_SESSION',
    'MANUAL',
  ]),
  releaseOffsetDays: z.coerce.number().int().min(0).max(3650).optional(),
  releaseAt: z.string().trim().optional(),
  releaseAfterSessionId: z.string().trim().optional(),
})

function readLessonForm(formData: FormData) {
  return lessonSchema.safeParse({
    title: formData.get('title'),
    summary: formData.get('summary') || undefined,
    type: formData.get('type') ?? 'VIDEO',
    isPreview: formData.get('isPreview') === 'on',
    isMandatory: formData.get('isMandatory') === 'on',
    videoAssetId: formData.get('videoAssetId') || undefined,
    durationSec: formData.get('durationSec') || undefined,
    releaseMode: formData.get('releaseMode') ?? 'IMMEDIATE',
    releaseOffsetDays: formData.get('releaseOffsetDays') || undefined,
    releaseAt: formData.get('releaseAt') || undefined,
    releaseAfterSessionId: formData.get('releaseAfterSessionId') || undefined,
  })
}

/**
 * Rejects release rules whose anchor is missing, rather than storing a lesson
 * that can never unlock. The resolver treats these as MISCONFIGURED and keeps them
 * locked, so catching it here is the difference between an error message now and a
 * student support ticket later.
 */
function validateReleaseRule(data: z.infer<typeof lessonSchema>): Record<string, string> | null {
  if (data.releaseMode === 'FIXED_DATE' && !data.releaseAt) {
    return { releaseAt: 'Pick a release date, or choose a different release mode.' }
  }
  if (data.releaseMode === 'AFTER_SESSION' && !data.releaseAfterSessionId) {
    return { releaseAfterSessionId: 'Choose the session that unlocks this lesson.' }
  }
  if (
    (data.releaseMode === 'DAYS_AFTER_ENROLLMENT' ||
      data.releaseMode === 'DAYS_AFTER_BATCH_START') &&
    data.releaseOffsetDays === undefined
  ) {
    return { releaseOffsetDays: 'Enter the number of days.' }
  }
  return null
}

function releaseFields(data: z.infer<typeof lessonSchema>) {
  return {
    releaseMode: data.releaseMode,
    releaseOffsetDays: data.releaseOffsetDays ?? null,
    releaseAt: data.releaseAt ? new Date(data.releaseAt) : null,
    releaseAfterSessionId: data.releaseAfterSessionId ?? null,
  }
}

export async function createLesson(sectionId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const parsed = readLessonForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const ruleError = validateReleaseRule(parsed.data)
  if (ruleError) return fail('This release rule would never unlock.', ruleError)

  const section = await db.section.findUnique({
    where: { id: sectionId },
    select: { courseId: true },
  })
  if (!section) return fail('Section not found.')

  const last = await db.lesson.findFirst({
    where: { sectionId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const lesson = await db.lesson.create({
    data: {
      sectionId,
      title: parsed.data.title,
      summary: parsed.data.summary ?? null,
      type: parsed.data.type,
      order: (last?.order ?? -1) + 1,
      isPreview: parsed.data.isPreview,
      isMandatory: parsed.data.isMandatory,
      videoAssetId: parsed.data.videoAssetId || null,
      durationSec: parsed.data.durationSec ?? null,
      ...releaseFields(parsed.data),
    },
    select: { id: true },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'lesson.created',
    entityType: 'Lesson',
    entityId: lesson.id,
    meta: { sectionId, title: parsed.data.title, releaseMode: parsed.data.releaseMode },
  })

  revalidatePath(`/admin/courses/${section.courseId}`)
  return { ok: true, id: lesson.id }
}

export async function updateLesson(lessonId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const parsed = readLessonForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const ruleError = validateReleaseRule(parsed.data)
  if (ruleError) return fail('This release rule would never unlock.', ruleError)

  const existing = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { section: { select: { courseId: true } } },
  })
  if (!existing) return fail('Lesson not found.')

  await db.lesson.update({
    where: { id: lessonId },
    data: {
      title: parsed.data.title,
      summary: parsed.data.summary ?? null,
      type: parsed.data.type,
      isPreview: parsed.data.isPreview,
      isMandatory: parsed.data.isMandatory,
      videoAssetId: parsed.data.videoAssetId || null,
      durationSec: parsed.data.durationSec ?? null,
      ...releaseFields(parsed.data),
    },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'lesson.updated',
    entityType: 'Lesson',
    entityId: lessonId,
    meta: { releaseMode: parsed.data.releaseMode },
  })

  revalidatePath(`/admin/courses/${existing.section.courseId}`)
  return { ok: true }
}

/** MANUAL-mode release toggle. Separate action so it can be a one-click button. */
export async function setManualRelease(
  lessonId: string,
  released: boolean,
): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { releaseMode: true, title: true, section: { select: { courseId: true } } },
  })
  if (!lesson) return fail('Lesson not found.')

  if (lesson.releaseMode !== 'MANUAL') {
    return fail('This lesson is not on manual release.')
  }

  await db.lesson.update({
    where: { id: lessonId },
    data: { manuallyReleasedAt: released ? new Date() : null },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: released ? 'lesson.released' : 'lesson.unreleased',
    entityType: 'Lesson',
    entityId: lessonId,
    meta: { title: lesson.title },
  })

  revalidatePath(`/admin/courses/${lesson.section.courseId}`)
  return { ok: true }
}

export async function deleteLesson(lessonId: string): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: {
      title: true,
      section: { select: { courseId: true } },
      _count: { select: { progress: true } },
    },
  })
  if (!lesson) return fail('Lesson not found.')

  // Deleting cascades to LessonProgress. Losing a cohort's watch history is not
  // recoverable, so require it to be empty.
  if (lesson._count.progress > 0) {
    return fail(
      `${lesson._count.progress} student(s) have progress on this lesson. Unpublish the course instead of deleting it, to avoid destroying their history.`,
    )
  }

  await db.lesson.delete({ where: { id: lessonId } })

  await recordAudit({
    actorId: auth.user.id,
    action: 'lesson.deleted',
    entityType: 'Lesson',
    entityId: lessonId,
    meta: { title: lesson.title },
  })

  revalidatePath(`/admin/courses/${lesson.section.courseId}`)
  return { ok: true }
}

/** Moves a lesson one position within its section. */
export async function reorderLesson(
  lessonId: string,
  direction: 'up' | 'down',
): Promise<ActionResult> {
  const auth = await authorizeRequest('course:write')
  if (!auth.ok) return fail('You do not have permission to edit courses.')

  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, order: true, sectionId: true, section: { select: { courseId: true } } },
  })
  if (!lesson) return fail('Lesson not found.')

  const neighbour = await db.lesson.findFirst({
    where: {
      sectionId: lesson.sectionId,
      order: direction === 'up' ? { lt: lesson.order } : { gt: lesson.order },
    },
    orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, order: true },
  })

  // Already at the boundary.
  if (!neighbour) return { ok: true }

  // Swap in one transaction so an interrupted reorder cannot leave duplicates.
  await db.$transaction([
    db.lesson.update({ where: { id: lesson.id }, data: { order: neighbour.order } }),
    db.lesson.update({ where: { id: neighbour.id }, data: { order: lesson.order } }),
  ])

  revalidatePath(`/admin/courses/${lesson.section.courseId}`)
  return { ok: true }
}
