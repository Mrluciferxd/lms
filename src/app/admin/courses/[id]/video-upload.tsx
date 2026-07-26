'use client'

/**
 * Direct-to-provider video upload.
 *
 * Bytes go from the browser to the provider, never through our server — that
 * avoids serverless request-body limits and doubled egress. The server only mints
 * the asset row and a scoped, expiring upload target.
 *
 * `binary` (the local development provider) is fully implemented. `tus` (Bunny)
 * needs a resumable-upload client; that is deliberately not stubbed, since it
 * cannot be exercised without a provisioned library and a fake implementation
 * would look finished while failing on the first real upload.
 */

import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

interface UploadTargetResponse {
  assetId: string
  provider: string
  upload: {
    url: string
    method: 'PUT' | 'POST'
    protocol: 'tus' | 'binary' | 'form'
    headers: Record<string, string>
    fields: Record<string, string>
    expiresAt: string
  }
}

type UploadState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'uploading'; percent: number }
  | { status: 'done'; assetId: string }
  | { status: 'error'; message: string }

/** Reads duration client-side; the local provider has no transcoder to report it. */
async function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(video.duration) ? Math.round(video.duration) : null)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    video.src = url
  })
}

export function VideoUpload({
  lessonTitle,
  onUploaded,
}: {
  lessonTitle: string
  /** Receives the new asset id and probed duration so the form can save both. */
  onUploaded: (assetId: string, durationSec: number | null) => void
}) {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setState({ status: 'preparing' })

    const durationSec = await probeDuration(file)

    let target: UploadTargetResponse
    try {
      const response = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: lessonTitle || file.name,
          filename: file.name,
          sizeBytes: file.size,
          contentType: file.type || 'video/mp4',
        }),
      })
      const body = (await response.json()) as Record<string, unknown>
      if (!response.ok) {
        setState({
          status: 'error',
          message: typeof body.error === 'string' ? body.error : 'Could not start the upload.',
        })
        return
      }
      target = body as unknown as UploadTargetResponse
    } catch {
      setState({ status: 'error', message: 'Network problem starting the upload.' })
      return
    }

    if (target.upload.protocol === 'tus') {
      setState({
        status: 'error',
        message: `Resumable upload for ${target.provider} is completed during the provider integration step. Use the local provider for development.`,
      })
      return
    }

    if (target.upload.protocol !== 'binary') {
      setState({ status: 'error', message: `Unsupported upload protocol "${target.upload.protocol}".` })
      return
    }

    // XHR rather than fetch: fetch still has no upload progress event, and a
    // multi-hundred-megabyte lecture upload with no progress bar is unusable.
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open(target.upload.method, target.upload.url, true)

      for (const [key, value] of Object.entries(target.upload.headers)) {
        xhr.setRequestHeader(key, value)
      }
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setState({ status: 'uploading', percent: Math.round((event.loaded / event.total) * 100) })
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setState({ status: 'done', assetId: target.assetId })
          onUploaded(target.assetId, durationSec)
        } else {
          setState({ status: 'error', message: `Upload failed (${xhr.status}).` })
        }
        resolve()
      }

      xhr.onerror = () => {
        setState({ status: 'error', message: 'Upload failed.' })
        resolve()
      }

      xhr.send(file)
    })
  }

  return (
    <div className="space-y-2 rounded-brand border border-dashed border-surface-border p-3">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={state.status === 'preparing' || state.status === 'uploading'}
        >
          {state.status === 'uploading' ? `Uploading ${state.percent}%` : 'Upload video'}
        </Button>

        {state.status === 'preparing' && (
          <span className="text-xs text-content-muted">Preparing…</span>
        )}
        {state.status === 'done' && (
          <span className="font-mono text-xs text-success">attached {state.assetId.slice(0, 8)}…</span>
        )}
      </div>

      {state.status === 'uploading' && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={state.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Upload progress"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${state.percent}%` }} />
        </div>
      )}

      {state.status === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      )}
    </div>
  )
}
