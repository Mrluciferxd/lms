import { serializeJsonLd } from '@/server/marketing/seo'

/**
 * Structured data for crawlers.
 *
 * The payload is built by pure functions in `@/server/marketing/seo` and
 * serialized there too — course descriptions are admin-authored, and raw
 * `JSON.stringify` inside a script element lets a `</script>` in that copy break
 * out into markup.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
