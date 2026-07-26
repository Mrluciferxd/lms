/**
 * Public marketing reads.
 *
 * Everything the anonymous site renders comes from here, and everything here is
 * scoped to what an anonymous visitor may see: `PUBLISHED` courses, `PUBLISHED`
 * pages, and lessons flagged `isPreview`. There is no viewer parameter and no
 * staff bypass — a marketing page must render identically for a signed-in admin
 * and for a crawler, or the client cannot check their own site.
 *
 * Queries are shaped for one round trip per section rather than per card: a hub
 * page with twelve programmes issues the same two queries as one with one.
 */

import { cache } from 'react'

import { brand } from '@/lib/brand'
import type { BrandLandingPage } from '@/lib/brand/types'
import { loadLessonAccess } from '@/server/catalog/access'
import { db } from '@/server/db'
import { type MarketingBlock, parseBlocks } from './blocks'
import type { LessonType } from '@/generated/prisma/enums'

/** `Page.slug` holding the hub's editable sections. */
export const HUB_PAGE_SLUG = 'home'

/** Batch states worth advertising. A RUNNING cohort is closed to new enrolments. */
const OPEN_BATCH_STATUSES = ['UPCOMING', 'ENROLLING'] as const

// -----------------------------------------------------------------------------
// Landing page configuration
// -----------------------------------------------------------------------------

export function landingPages(): readonly BrandLandingPage[] {
  return brand.marketing.landingPages
}

export function landingSlugs(): string[] {
  return brand.marketing.landingPages.map((page) => page.slug)
}

export function findLandingPage(slug: string): BrandLandingPage | null {
  return brand.marketing.landingPages.find((page) => page.slug === slug) ?? null
}

/** The landing page selling a course, so a programme card can link to its pitch. */
export function landingPageForCourse(courseSlug: string): BrandLandingPage | null {
  return brand.marketing.landingPages.find((page) => page.courseSlug === courseSlug) ?? null
}

/**
 * Configured landing pages whose course is actually published.
 *
 * A brand config names its landing pages before the courses exist — the Nirlep
 * config does exactly that, with `TODO(client)` against the programme names — so
 * "configured" and "reachable" are different sets until launch. Anything linking
 * to a landing page must use this one, or the hub ships a hero CTA that 404s.
 */
export const listAvailableLandingPages = cache(async (): Promise<BrandLandingPage[]> => {
  const configured = landingPages()
  if (configured.length === 0) return []

  const published = await db.course.findMany({
    where: { slug: { in: configured.map((page) => page.courseSlug) }, status: 'PUBLISHED' },
    select: { slug: true },
  })

  const publishedSlugs = new Set(published.map((course) => course.slug))
  return configured.filter((page) => publishedSlugs.has(page.courseSlug))
})

// -----------------------------------------------------------------------------
// CMS blocks
// -----------------------------------------------------------------------------

export interface MarketingPage {
  blocks: MarketingBlock[]
  seoTitle: string | null
  seoDescription: string | null
  ogImageUrl: string | null
}

const EMPTY_PAGE: MarketingPage = {
  blocks: [],
  seoTitle: null,
  seoDescription: null,
  ogImageUrl: null,
}

/**
 * A marketing page's editable content.
 *
 * DRAFT pages resolve to nothing: `seedPage` creates pack-supplied pages as
 * DRAFT precisely so a client reviews the copy before it is public, and
 * honouring that here is what makes the status mean anything.
 *
 * One query serves both `generateMetadata` and the render — they run in the same
 * request and want the same row, and `cache()` collapses them.
 */
export const getMarketingPage = cache(async (slug: string): Promise<MarketingPage> => {
  const page = await db.page.findUnique({
    where: { slug },
    select: {
      status: true,
      blocks: true,
      seoTitle: true,
      seoDescription: true,
      ogImageUrl: true,
    },
  })

  if (!page || page.status !== 'PUBLISHED') return EMPTY_PAGE

  return {
    blocks: parseBlocks(page.blocks),
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImageUrl: page.ogImageUrl,
  }
})

// -----------------------------------------------------------------------------
// Programme cards
// -----------------------------------------------------------------------------

export interface ProgrammeCard {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  thumbnailUrl: string | null
  level: string | null
  priceMinor: number | null
  compareAtPriceMinor: number | null
  currency: string
  lessonCount: number
  sectionCount: number
  totalDurationSec: number
  previewCount: number
  nextBatchStartDate: Date | null
  /** Set when the brand advertises this course through a landing page. */
  landingSlug: string | null
  updatedAt: Date
}

/**
 * Published courses, newest cohort first within the admin's sort order.
 *
 * Callers must gate on the `publicCatalog` feature: an invite-only academy sells
 * through its landing pages and a sales call, and listing its full catalogue
 * publicly is a disclosure it did not ask for.
 */
export const listProgrammes = cache(async (): Promise<ProgrammeCard[]> => {
  const now = new Date()

  const courses = await db.course.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      thumbnailUrl: true,
      level: true,
      priceMinor: true,
      compareAtPriceMinor: true,
      currency: true,
      updatedAt: true,
      sections: {
        select: { lessons: { select: { durationSec: true, isPreview: true } } },
      },
      batches: {
        where: { status: { in: [...OPEN_BATCH_STATUSES] }, startDate: { gte: now } },
        orderBy: { startDate: 'asc' },
        take: 1,
        select: { startDate: true },
      },
    },
  })

  return courses.map((course) => {
    const lessons = course.sections.flatMap((section) => section.lessons)

    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      subtitle: course.subtitle,
      description: course.description,
      thumbnailUrl: course.thumbnailUrl,
      level: course.level,
      priceMinor: course.priceMinor,
      compareAtPriceMinor: course.compareAtPriceMinor,
      currency: course.currency,
      lessonCount: lessons.length,
      sectionCount: course.sections.length,
      totalDurationSec: lessons.reduce((total, lesson) => total + (lesson.durationSec ?? 0), 0),
      previewCount: lessons.filter((lesson) => lesson.isPreview).length,
      nextBatchStartDate: course.batches[0]?.startDate ?? null,
      landingSlug: landingPageForCourse(course.slug)?.slug ?? null,
      updatedAt: course.updatedAt,
    }
  })
})

// -----------------------------------------------------------------------------
// Landing pages
// -----------------------------------------------------------------------------

export interface CurriculumLesson {
  id: string
  title: string
  summary: string | null
  type: LessonType
  durationSec: number | null
  isPreview: boolean
}

export interface CurriculumSection {
  id: string
  title: string
  summary: string | null
  lessons: CurriculumLesson[]
}

export interface LandingCourse {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  thumbnailUrl: string | null
  level: string | null
  language: string
  priceMinor: number | null
  compareAtPriceMinor: number | null
  currency: string
  accessDurationDays: number | null
  seoTitle: string | null
  seoDescription: string | null
  ogImageUrl: string | null
  updatedAt: Date
}

export interface LandingBatch {
  id: string
  name: string
  startDate: Date
  endDate: Date | null
  capacity: number | null
}

export interface LandingPageData {
  config: BrandLandingPage
  course: LandingCourse
  curriculum: CurriculumSection[]
  /** Free lessons, flattened, in curriculum order. */
  previewLessons: Array<CurriculumLesson & { sectionTitle: string }>
  totals: { sections: number; lessons: number; durationSec: number }
  openBatches: LandingBatch[]
  /** CMS content keyed by the landing slug, not the course slug. */
  page: MarketingPage
}

/**
 * A configured landing page and the course it sells.
 *
 * Returns null both when the slug is not configured and when its course is
 * missing or unpublished, so the route 404s in all three cases. A landing page
 * that renders a pitch for a draft course would advertise something nobody can
 * buy, and would leak the title of unreleased content.
 */
export const getLandingPage = cache(async (slug: string): Promise<LandingPageData | null> => {
  const config = findLandingPage(slug)
  if (!config) return null

  const now = new Date()

  const course = await db.course.findUnique({
    where: { slug: config.courseSlug },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      thumbnailUrl: true,
      level: true,
      language: true,
      status: true,
      priceMinor: true,
      compareAtPriceMinor: true,
      currency: true,
      accessDurationDays: true,
      seoTitle: true,
      seoDescription: true,
      ogImageUrl: true,
      updatedAt: true,
      sections: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          summary: true,
          lessons: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              summary: true,
              type: true,
              durationSec: true,
              isPreview: true,
            },
          },
        },
      },
      batches: {
        where: { status: { in: [...OPEN_BATCH_STATUSES] }, startDate: { gte: now } },
        orderBy: { startDate: 'asc' },
        take: 4,
        select: { id: true, name: true, startDate: true, endDate: true, capacity: true },
      },
    },
  })

  if (!course || course.status !== 'PUBLISHED') return null

  const curriculum: CurriculumSection[] = course.sections.map((section) => ({
    id: section.id,
    title: section.title,
    summary: section.summary,
    lessons: section.lessons,
  }))

  const allLessons = curriculum.flatMap((section) => section.lessons)

  return {
    config,
    course: {
      id: course.id,
      slug: course.slug,
      title: course.title,
      subtitle: course.subtitle,
      description: course.description,
      thumbnailUrl: course.thumbnailUrl,
      level: course.level,
      language: course.language,
      priceMinor: course.priceMinor,
      compareAtPriceMinor: course.compareAtPriceMinor,
      currency: course.currency,
      accessDurationDays: course.accessDurationDays,
      seoTitle: course.seoTitle,
      seoDescription: course.seoDescription,
      ogImageUrl: course.ogImageUrl,
      updatedAt: course.updatedAt,
    },
    curriculum,
    previewLessons: curriculum.flatMap((section) =>
      section.lessons
        .filter((lesson) => lesson.isPreview)
        .map((lesson) => ({ ...lesson, sectionTitle: section.title })),
    ),
    totals: {
      sections: curriculum.length,
      lessons: allLessons.length,
      durationSec: allLessons.reduce((total, lesson) => total + (lesson.durationSec ?? 0), 0),
    },
    openBatches: course.batches,
    page: await getMarketingPage(slug),
  }
})

// -----------------------------------------------------------------------------
// Public preview lessons
// -----------------------------------------------------------------------------

export interface PreviewLesson {
  id: string
  title: string
  summary: string | null
  type: LessonType
  durationSec: number | null
  hasVideo: boolean
  embedUrl: string | null
  courseSlug: string
  courseTitle: string
}

/**
 * A free preview lesson, for the public route.
 *
 * Authorization is delegated to `decideAccess` with a null viewer — the same
 * function the playback endpoint uses — and the result is required to be
 * `PREVIEW`. Passing null rather than the signed-in user is deliberate: this URL
 * is the marketing surface, so it must serve exactly the lessons the client
 * marked free and nothing else. A staff member checking the page sees what a
 * visitor sees, and no enrolment or staff bypass can widen what this route
 * exposes.
 */
export async function getPreviewLesson(
  courseSlug: string,
  lessonId: string,
): Promise<PreviewLesson | null> {
  const { decision, lesson } = await loadLessonAccess(lessonId, null)

  if (!lesson || !decision.allowed || decision.via !== 'PREVIEW') return null
  // Guards against a preview lesson from another course being reachable under
  // this landing page's URL, which would otherwise be an open redirect for SEO.
  if (lesson.courseSlug !== courseSlug) return null

  const detail = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { summary: true, embedUrl: true },
  })

  return {
    id: lesson.id,
    title: lesson.title,
    summary: detail?.summary ?? null,
    type: lesson.type as LessonType,
    durationSec: lesson.durationSec,
    hasVideo: lesson.videoAssetId !== null,
    embedUrl: detail?.embedUrl ?? null,
    courseSlug: lesson.courseSlug,
    courseTitle: lesson.courseTitle,
  }
}
