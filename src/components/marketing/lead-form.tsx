'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ATTRIBUTION_KEYS, HONEYPOT_FIELD, type Attribution } from '@/server/marketing/attribution'
import { submitLead, type LeadFormState } from '@/server/marketing/leads'

const INITIAL_STATE: LeadFormState = {}

/**
 * Public enquiry form.
 *
 * Attribution is carried as hidden inputs populated on the server from the page's
 * query string, so it survives a submit with JavaScript disabled — and it is
 * re-sanitized in the action regardless, because anything in a hidden input is
 * whatever the client decided to send.
 *
 * The honeypot is positioned off-screen rather than `display:none`: a bot that
 * skips hidden fields is exactly the one worth catching. It is removed from the
 * accessibility tree and the tab order, so nobody using a keyboard or a screen
 * reader can reach it by accident and get their enquiry silently dropped.
 */
export function LeadForm({
  source,
  attribution,
  privacyUrl,
  submitLabel,
}: {
  source: string
  attribution: Attribution
  privacyUrl?: string
  submitLabel: string
}) {
  const [state, formAction, isPending] = useActionState(submitLead, INITIAL_STATE)

  if (state.ok) {
    return (
      <div
        role="status"
        className="rounded-brand border border-success/30 bg-success/10 px-5 py-6 text-sm text-content"
      >
        <p className="font-medium">Thanks — we have your details.</p>
        <p className="mt-1 text-content-muted">
          Someone will get back to you shortly. If it is urgent, reply to the confirmation email.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <p
          role="alert"
          className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <input type="hidden" name="source" value={source} />
      {ATTRIBUTION_KEYS.map((key) =>
        attribution[key] ? <input key={key} type="hidden" name={key} value={attribution[key]} /> : null,
      )}

      <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden>
        <label htmlFor={HONEYPOT_FIELD}>Company</label>
        <input
          id={HONEYPOT_FIELD}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <Input label="Your name" name="name" autoComplete="name" required error={state.fieldErrors?.name} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          error={state.fieldErrors?.email}
        />
        <Input
          label="Phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          error={state.fieldErrors?.phone}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="lead-message" className="block text-sm font-medium text-content">
          Anything you would like us to know?
        </label>
        <textarea
          id="lead-message"
          name="message"
          rows={3}
          className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <input
            id="lead-consent"
            name="consent"
            type="checkbox"
            required
            className="mt-1 h-4 w-4 shrink-0 rounded border-surface-border accent-primary"
            aria-describedby={state.fieldErrors?.consent ? 'lead-consent-error' : undefined}
          />
          <label htmlFor="lead-consent" className="text-sm text-content-muted">
            I agree to be contacted about this enquiry
            {privacyUrl ? (
              <>
                , and I have read the{' '}
                <Link href={privacyUrl} className="underline underline-offset-4 hover:text-content">
                  privacy policy
                </Link>
              </>
            ) : null}
            .
          </label>
        </div>
        {state.fieldErrors?.consent && (
          <p id="lead-consent-error" className="text-xs text-danger">
            {state.fieldErrors.consent}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? 'Sending…' : submitLabel}
      </Button>
    </form>
  )
}
