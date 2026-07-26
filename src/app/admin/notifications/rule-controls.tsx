'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setRuleEnabled, setRuleOffset } from '@/server/notifications/actions'

/**
 * Enable/disable and retime one rule.
 *
 * Both actions re-check `notification:manage` on the server. Disabling the
 * control here is a courtesy to the operator, not a security boundary.
 */
export function RuleControls({
  ruleId,
  enabled,
  offsetMinutes,
}: {
  ruleId: string
  enabled: boolean
  offsetMinutes: number
}) {
  const router = useRouter()
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work()
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) router.refresh()
    })
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      {notice && (
        <p role="alert" className="text-xs text-danger">
          {notice}
        </p>
      )}

      <form
        action={(formData) => run(() => setRuleOffset(ruleId, formData))}
        className="flex items-end gap-2"
      >
        <Input
          label="Offset (minutes)"
          name="offsetMinutes"
          type="number"
          defaultValue={offsetMinutes}
          className="w-28"
          hint="Negative = before"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Save
        </Button>
      </form>

      <Button
        variant={enabled ? 'secondary' : 'primary'}
        size="sm"
        disabled={pending}
        onClick={() => run(() => setRuleEnabled(ruleId, !enabled))}
      >
        {enabled ? 'Disable rule' : 'Enable rule'}
      </Button>
    </div>
  )
}
