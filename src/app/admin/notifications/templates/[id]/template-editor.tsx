'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { renderForChannel, unknownVariables } from '@/server/notifications/render'
import type { ActionResult } from '@/server/notifications/actions'
import type { TemplateVariables } from '@/server/notifications/variables'
import type { NotificationChannelType } from '@/generated/prisma/enums'

const ALL_CHANNELS: NotificationChannelType[] = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP']

export interface VariableDoc {
  key: string
  description: string | null
  example: string
}

/**
 * Template editor with a live per-channel preview.
 *
 * The preview calls the same `renderForChannel` the delivery worker calls — not
 * an approximation of it. That is why the renderer is pure and free of database
 * and clock: an editor whose preview merely resembles the send would let an
 * author ship a body that reads well in the box and arrives as a truncated SMS.
 *
 * The channel tabs matter for the same reason. One body becomes five different
 * messages, and the differences (a dropped subject, a flattened line break, a
 * hard truncation) are exactly what an author cannot picture unaided.
 */
export function TemplateEditor({
  action,
  initial,
  availableChannels,
  sampleVariables,
  catalog,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  initial: {
    name: string
    subject: string | null
    body: string
    channels: NotificationChannelType[]
  }
  availableChannels: NotificationChannelType[]
  sampleVariables: TemplateVariables
  catalog: VariableDoc[]
}) {
  const router = useRouter()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  const [subject, setSubject] = useState(initial.subject ?? '')
  const [body, setBody] = useState(initial.body)
  const [previewChannel, setPreviewChannel] = useState<NotificationChannelType>(
    initial.channels[0] ?? 'EMAIL',
  )

  const preview = useMemo(
    () => renderForChannel({ subject, body }, previewChannel, sampleVariables),
    [subject, body, previewChannel, sampleVariables],
  )

  const unknown = useMemo(
    () => unknownVariables({ subject, body }, sampleVariables),
    [subject, body, sampleVariables],
  )

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const outcome = await action(formData)
      setResult(outcome)
      if (outcome.ok) router.refresh()
    })
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form action={handleSubmit} className="space-y-4">
        {result?.error && (
          <p
            role="alert"
            className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {result.error}
          </p>
        )}
        {result?.ok && (
          <p
            role="status"
            className="rounded-brand border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
          >
            Saved.
          </p>
        )}

        <Input
          label="Template name"
          name="name"
          required
          defaultValue={initial.name}
          error={result?.fieldErrors?.name}
        />

        <Input
          label="Subject"
          name="subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          hint="Used by email, the in-app inbox and the push title. Ignored by SMS and WhatsApp."
          error={result?.fieldErrors?.subject}
        />

        <div className="space-y-1.5">
          <label htmlFor="body" className="block text-sm font-medium text-content">
            Body
          </label>
          <textarea
            id="body"
            name="body"
            rows={12}
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 font-mono text-sm text-content"
          />
          {result?.fieldErrors?.body && (
            <p className="text-xs text-danger">{result.fieldErrors.body}</p>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-content">Channels</legend>
          <div className="flex flex-wrap gap-3">
            {ALL_CHANNELS.map((channel) => {
              const usable = availableChannels.includes(channel)
              return (
                <label
                  key={channel}
                  className={`flex items-center gap-2 text-sm ${usable ? 'text-content' : 'text-content-muted'}`}
                >
                  <input
                    type="checkbox"
                    name="channels"
                    value={channel}
                    defaultChecked={initial.channels.includes(channel)}
                    className="rounded border-surface-border"
                  />
                  {channel}
                  {!usable && <span className="text-xs">(no provider)</span>}
                </label>
              )
            })}
          </div>
          {result?.fieldErrors?.channels && (
            <p className="text-xs text-danger">{result.fieldErrors.channels}</p>
          )}
          <p className="text-xs text-content-muted">
            A channel with no provider on this deployment is never queued, so ticking it here has
            no effect until the brand config names one.
          </p>
        </fieldset>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save template'}
        </Button>
      </form>

      <aside className="space-y-6">
        <section aria-labelledby="preview-heading" className="space-y-2">
          <h2 id="preview-heading" className="text-sm font-medium text-content">
            Preview
          </h2>

          <div role="tablist" aria-label="Preview channel" className="flex flex-wrap gap-1">
            {ALL_CHANNELS.map((channel) => (
              <button
                key={channel}
                type="button"
                role="tab"
                aria-selected={previewChannel === channel}
                onClick={() => setPreviewChannel(channel)}
                className={`rounded-brand px-2 py-1 text-xs transition-colors ${
                  previewChannel === channel
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-muted text-content-muted hover:text-content'
                }`}
              >
                {channel}
              </button>
            ))}
          </div>

          <div className="rounded-brand border border-surface-border bg-surface-muted p-3">
            {preview.subject !== null ? (
              <p className="text-sm font-medium text-content">{preview.subject}</p>
            ) : (
              <p className="text-xs italic text-content-muted">
                This channel carries no subject line.
              </p>
            )}
            <p className="mt-2 whitespace-pre-wrap text-sm text-content">{preview.body}</p>
            <p className="mt-3 border-t border-surface-border pt-2 text-xs text-content-muted">
              {preview.body.length} characters
              {previewChannel === 'SMS' &&
                ` · about ${Math.max(1, Math.ceil(preview.body.length / 153))} SMS segment(s)`}
            </p>
          </div>
        </section>

        {unknown.length > 0 && (
          <p
            role="status"
            className="rounded-brand border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            {unknown.join(', ')} {unknown.length === 1 ? 'is' : 'are'} not available for this
            trigger and will render as nothing. Check the spelling, or remove the reference.
          </p>
        )}

        <section aria-labelledby="variables-heading" className="space-y-2">
          <h2 id="variables-heading" className="text-sm font-medium text-content">
            Available variables
          </h2>
          <dl className="space-y-2 text-xs">
            {catalog.map((variable) => (
              <div key={variable.key}>
                <dt className="font-mono text-content">{`{{${variable.key}}}`}</dt>
                <dd className="text-content-muted">
                  {variable.description ?? 'No description'}
                  {variable.example && ` — e.g. ${variable.example}`}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </aside>
    </div>
  )
}
