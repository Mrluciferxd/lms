# Video and content protection

## What the proposal claims, and what is true

Section 2.2 of the proposal promises a player that enforces "non-downloadable
assets" and "advanced protective wrappers to **prevent native screen
recording**."

The first half is straightforwardly deliverable. The second half is not
achievable on the web, by us or by anyone else.

**Why.** Screen capture happens in the operating system's compositor, below the
browser. A web page cannot see it, block it or detect it — there is no API,
because granting pages that power would let any site interfere with
accessibility tools, screen readers and screen sharing. And even a perfect
software defence stops at a phone camera pointed at the monitor.

Every product marketed as "screen-record proof" for web delivery is doing one of
the things listed below. It is worth being precise about this before sign-off,
because it is a promise that will be tested by the first student who tries.

## What is actually deliverable

Ordered by how much protection each one buys.

### 1. DRM — Widevine, FairPlay, PlayReady

Encrypted playback where decryption keys are held by the browser's content
decryption module, not by our JavaScript.

**This is the one that genuinely blocks screen capture — on some platforms.**
Safari (FairPlay) and Edge (PlayReady) enforce output protection at the OS level:
a capture attempt records a black frame. Chrome on desktop with Widevine L3 does
not reliably do this. So DRM meaningfully raises the floor without closing the
hole, and it also makes the *file* unusable if extracted — the encrypted segments
are worthless without a licence.

Configured per asset via `MediaAsset.drmEnabled`, defaulting from
`brand.videoSecurity.drm`.

### 2. Forensic watermarking

The student's name, email and IP burned into the played stream, either as a
server-side overlay or a client-rendered layer that moves position periodically.

This does not prevent a recording. It makes a recording **traceable**: any leaked
file identifies the account it came from, which converts an anonymous act into an
attributable one. For a paid cohort programme this is the highest-leverage
deterrent available, and it is the one that survives the phone-camera case —
the overlay is in the frame either way.

`brand.videoSecurity.watermarkTemplate`, `{{name}} · {{email}} · {{ip}}` for
Nirlep.

### 3. Short-TTL signed playback URLs

No durable asset URL exists. The client requests playback, the server checks
enrollment and drip release, then issues a URL signed for 180 seconds and bound
to the viewer. Recorded in `PlaybackGrant`.

Stops URL sharing, hotlinking and scraped-link resale. Does not stop capture.

### 4. Concurrent-stream limits

`maxConcurrentStreams: 1` for Nirlep. `PlaybackGrant` rows are the ledger; a
second concurrent stream is refused.

This is what actually protects revenue in practice. The common leak in cohort
education is not sophisticated ripping — it is one paid login shared across a
WhatsApp group. Concurrency limits plus `Device` tracking make that impractical.

### 5. Download suppression

`Content-Disposition: inline`, no progressive-download endpoint, segmented HLS
rather than a single file, and no direct asset URL served for lectures.
`MediaAsset.downloadable` is per asset, because worksheets must download while
lectures must not.

Defeats casual right-click saving and browser extensions that scrape `<video src>`.

### 6. Deterrents that are honest about being deterrents

Disabling the context menu, detecting devtools, pausing on tab blur, blocking
Picture-in-Picture. Each is bypassable in under a minute by anyone who cares. They
raise friction for the opportunistic majority and should be described internally
as exactly that — never as protection.

## The posture we ship

For Nirlep (`brands/nirlep-forex/brand.config.ts`):

```ts
videoSecurity: {
  drm: true,
  forensicWatermark: true,
  watermarkTemplate: '{{name}} · {{email}} · {{ip}}',
  maxConcurrentStreams: 1,
  signedUrlTtlSec: 180,
  blockDownloads: true,
}
```

Combined, this is the strongest posture available for web delivery: the easy paths
are closed, the file is useless if extracted, sharing one login is impractical,
and anything that does leak names the account responsible.

## Provider choice

`integrations.video: 'bunny-stream'`. Bunny Stream supports DRM, token
authentication and per-viewer watermarking at egress pricing that works for an
India-based audience. Mux and Cloudflare Stream are both drop-in alternatives —
`MediaProvider` and the adapter interface exist so this is a config change, not a
rewrite.

## Recommendation before sign-off

Reword the proposal line. Suggested replacement:

> **Secure Video Player Engine:** DRM-encrypted streaming with non-downloadable
> assets, short-lived signed playback links, per-student forensic watermarking,
> and concurrent-stream limits — so content cannot be redistributed anonymously
> and shared credentials are blocked.

This describes what will exist, is stronger than most competitors actually ship,
and does not commit us to something no browser can do. Leaving the original
wording in place creates a deliverable that cannot be signed off honestly at
acceptance — and it will get tested.

We will build the full posture above regardless of how the sentence is worded.
