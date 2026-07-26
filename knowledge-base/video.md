# Video & Content Protection

## What this subsystem does
Uploads, stores and serves lecture video such that it cannot be redistributed
anonymously, and such that one paid login cannot serve a group.

Read `docs/06-video-security.md` before changing anything here. The short version: the
client proposal promises "prevent native screen recording", which is **not achievable on
the web** — capture happens in the OS compositor, below the browser, and a phone camera
defeats any software answer. What is deliverable is DRM, forensic watermarking,
short-TTL signed URLs and concurrency limits.

## How it is structured
| File | Responsibility |
|---|---|
| `types.ts` | `VideoProviderAdapter` contract |
| `bunny.ts` | Bunny Stream adapter (production) |
| `local.ts` | Filesystem adapter, development only, refuses to run in production |
| `index.ts` | Resolves the adapter from brand config; `adapterForAsset()` for existing rows |
| `signing.ts` | Pure token signing — Bunny CDN token, Bunny TUS upload signature, local HMAC |
| `watermark.ts` | Template rendering with sanitisation and org-timezone dates |
| `playback.ts` | **The security boundary**: authorize, enforce concurrency, record grant, sign URL |
| `assets.ts` | Asset lifecycle: create + upload target, refresh state, delete |

## Conventions and rules
- **`playback.ts` is the only path to a playable URL.** It re-runs `loadLessonAccess`,
  so drip and enrollment are enforced identically to the page.
- **A device fingerprint is required.** Without it, concurrency cannot be counted per
  device — grants with a null device collapse into one bucket and a shared login reads
  as a single stream. Rotating the value to evade the limit backfires: each rotation
  reads as an additional device.
- **A renewal is not a second stream.** `issuePlayback` revokes the calling device's own
  live grants *before* counting. Without that, the player's own renewal would lock a
  legitimate viewer out mid-lesson after the TTL.
- **`adapterForAsset(asset.provider)`, not the active provider,** when playing an
  existing asset. Assets uploaded before a provider switch must keep playing through the
  provider holding their bytes.
- **Webhooks from the provider are hints, not truth.** Bunny does not sign its webhook,
  so the handler re-reads authoritative state via `getAssetState`. Otherwise a forged
  POST could mark a broken asset READY.

## Known gotchas
- **Bunny signing is unverified** — ISSUE-004. Implemented from documentation, never run
  against a live library. Fails closed (every playback 403s) so it surfaces immediately.
- **DRM playback is unwired for Chrome/Edge** — ISSUE-005. Safari plays HLS/FairPlay
  natively; the player renders an explanatory message elsewhere rather than silently
  falling back to unprotected playback.
- **TUS upload is not implemented.** `createUploadTarget` returns correct TUS parameters
  for Bunny, but the browser uploader only implements the `binary` protocol used by the
  local provider. The uploader surfaces this rather than failing obscurely.
- **The local provider stores files under `.next/cache/local-media`**, which a clean
  build removes. Re-run `scripts/seed-demo-course.ts` to restore demo video.
- **Watermark values are sanitised for a reason.** Control characters and braces are
  stripped — braces would let a student's own name inject another placeholder on
  re-render.

## How it is tested
- `signing.test.ts` (28) — determinism, URL-safe alphabet, sensitivity to every input,
  local token forgery/expiry/boundary-confusion.
- `watermark.test.ts` (19) — template rendering, sanitisation, truncation, and the
  timezone case where formatting in UTC would misdate the watermark by a day.
- `playback.dbtest.ts` (20) — the concurrency semantics that live in query behaviour:
  second device blocked, renewal counted once, slot freed on release, expired grants
  ignored, one student cannot release another's grant, per-asset limit override.

## Related
[catalog-and-drip.md](./catalog-and-drip.md) · [known-issues.md](./known-issues.md) · `docs/06-video-security.md`
