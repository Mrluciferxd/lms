import { brand } from '@/lib/brand'
import type { Attribution } from '@/server/marketing/attribution'
import { ENQUIRY_ANCHOR } from '@/server/marketing/links'
import { LeadForm } from './lead-form'

/**
 * The enquiry block, shared by the hub and every landing page.
 *
 * The heading lives here rather than inside the form so that `aria-labelledby`
 * still resolves after a successful submit swaps the fields for a confirmation.
 */
export function EnquirySection({
  source,
  attribution,
  heading,
  body,
  submitLabel = 'Send enquiry',
}: {
  source: string
  attribution: Attribution
  heading: string
  body?: string
  submitLabel?: string
}) {
  return (
    <section
      id={ENQUIRY_ANCHOR}
      aria-labelledby="enquire-heading"
      className="border-t border-surface-border bg-surface-muted"
    >
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h2 id="enquire-heading" className="text-2xl font-semibold tracking-tight text-content">
          {heading}
        </h2>
        {body && <p className="mt-2 text-content-muted">{body}</p>}

        <div className="mt-8">
          <LeadForm
            source={source}
            attribution={attribution}
            privacyUrl={brand.legal?.privacyUrl}
            submitLabel={submitLabel}
          />
        </div>
      </div>
    </section>
  )
}
