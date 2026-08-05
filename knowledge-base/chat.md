# Community Chat

## What this subsystem does
Channels, messages, memberships and reactions for an academy cohort. Six
channel types cover every audience shape the proposal implies, and the security
model is a pure decision consulted at every read and every write — a hidden
form is not authorization.

## How it is structured
| File | Responsibility |
|---|---|
| `src/server/chat/membership.ts` | **Pure** `decideChannelVisibility`, `canPost`, `canModerate` + loader |
| `src/server/chat/validation.ts` | **Pure** message body, attachment, slug and length rules |
| `src/server/chat/channels.ts` | DB reads: channel list, single channel, message pagination, unread counts |
| `src/server/chat/actions.ts` | `'use server'` writes: post / edit / delete / react / pin / create / join / leave / read / mute / archive |
| `src/server/chat/membership.test.ts` | Visibility + canPost + canModerate matrix (every type × role × arch/mute/readonly) |
| `src/server/chat/validation.test.ts` | Body limits, slug rules, attachment caps, duplicate-attachment guard, reply depth |
| `src/app/app/community/page.tsx` | Channel list (browseable + archived) |
| `src/app/app/community/[channel]/page.tsx` | Channel view + composer + join/leave |
| `src/app/admin/community/page.tsx` | Moderation console: list, create-channel form, archive/unarchive |
| `src/components/chat/composer.tsx` | Client component: controlled textarea + send via `postMessage` |
| `src/components/chat/message-controls.tsx` | Client component: reply / react / pin / delete via server actions |

## Conventions and rules
- **Pure decision + thin db wrapper.** `decideChannelVisibility` decides;
  `loadChannelForViewer` is the only path through it for the page. Both
  consumers (the channel list and the channel page) call the same function, so
  a list that hides a room while its detail page still renders the composer is
  the bug this prevents. Matches ../sessions/visibility.ts.
- **Feature flag is structural.** `isFeatureEnabled('chat')` 404s the route
  — it does not merely hide the nav entry. The nav item is gated on the same
  flag from `resolveFeatures`, so a brand with `features.chat = false` shows
  nothing on either side.
- **Server actions are endpoints.** Every write re-resolves `getCurrentUser`,
  `loadChannelViewer`, the channel, and `decideChannelVisibility` before
  performing. A stale page (post-expiry, post-mute, post-archive, post-ban)
  cannot get a message in. The client passing the right ids is a hint, not
  authority.
- **Read-only is the announcement mechanism.** `readOnly: true` channels
  accept posts only from staff. There is no per-role write exception; the
  moderator role on a readOnly room is intentionally inert.
- **Archive freezes the room.** `canPost` returns `ARCHIVED` for everyone,
  including staff — so a moderator cannot add to a closed room by mistake.
  Reopening requires the explicit `unarchiveChannel` action, which is the
  audit-trail path back to writable.
- **Deleted messages keep their place.** Soft delete preserves the row so reply
  threads don't renumber; the read query scrubs `body` and `attachmentIds`
  when `deletedAt` is set. Reactions on a deleted message are hidden but not
  reaped — they belong to a past message a moderator removed.
- **Reply depth is bounded at 1.** A reply to a reply flattens to the original
  parent on write — `replyToId` always points at the message at the top of a
  thread. The validator rejects `replyDepth > MAX_REPLY_DEPTH` from the action
  path, and the action's own flatten-before-write makes the bound structural.

## The six channel types
| Type | Visibility | Notes |
|---|---|---|
| `GLOBAL` | every signed-in member | The lobby where a brand-new student with no enrollments can ask a question |
| `ANNOUNCEMENT` | signed-in (or all students if course-scoped) | `readOnly` default; staff post, students read |
| `COURSE` | students enrolled in `courseId` | Membership derived from the enrollment in `ROSTERED_STATUSES` |
| `BATCH` | students in `batchId` | Membership derived from the enrollment on that batch |
| `TOPIC` | explicit `ChannelMember` rows | Pack-seeded rooms (#market-talk) and admin-created topics |
| `DIRECT` | explicit `ChannelMember` rows | 1:1 / DM between two members |

A `COURSE`/`BATCH` room with no course/batch is `MISCONFIGURED` and hidden from
students (not silently visible-to-everyone); staff see it via the bypass.

## Known gotchas
- **Reactions are limited by Unicode property escapes**, so multi-codepoint
  ZWJ emoji (e.g. 🏳️‍🌈) might not match the validator. The permissive
  `{1,2}` count is a deliberate floor — a tightening in `validation.test.ts`
  is where that rule will surface if the UI tries to send a 3-codepoint emoji.
- **`markChannelRead` upserts a `ChannelMember`.** GLOBAL/COURSE/BATCH rooms
  have no prior membership row; the upsert creates one so read state has
  somewhere to live. A later `leaveChannel` on those types is refused — the
  enrollment IS the membership.
- **Unread count for a never-opened channel is its full message count.** A
  student member of 10 rooms who has never opened any sees a total badge of
  every message across all 10. Bounded by the room being finite; if a
  room ever threads hundreds of unread this becomes worth a cap.
- **No realtime.** This first cut is server-rendered; refresh to see new
  messages. A realtime seam (SSE/WebSocket) belongs behind `feature.chat` and
  can join the existing pure-decision surface without touching the write
  actions — the decision functions are unchanged.
- **No DB-backed tests yet.** The pure functions are exhaustively covered, but
  `channels.ts` read queries and `actions.ts` writes need a `chat.dbtest.ts`
  covering pagination, the `markChannelRead` upsert membership creation, mute
  expiry, and replay idempotency for `deleteMessage` (deleting twice should
  be a no-op, which the action handles but a DB test should pin).

## How it is tested
- `membership.test.ts` — every `ChannelType` × every staff role × student, the
  archived / read-only / muted combinations, the BATCH fallback, the
  `MISCONFIGURED` cases, an exhaustiveness case asserting no type throws, and
  the mute-expiry boundary. `canModerate` covers the role-permission matrix
  plus the delegated student-moderator case.
- `validation.test.ts` — boundary lengths on both sides, empty body with and
  without attachments, duplicate attachments, the `MAX_REPLY_DEPTH` cap, and
  every slug-error case (case, hyphen position, spaces, length).

## Related
[architecture.md](./architecture.md) · [auth.md](./auth.md) · [vertical-packs.md](./vertical-packs.md) (packs seed channels via `onInstall`)
