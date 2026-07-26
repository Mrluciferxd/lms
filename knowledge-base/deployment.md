# Deployment

## What this covers
How this deployment is hosted, configured and released, and the decisions baked into
`vercel.json` that are not self-evident from the file (which is strict JSON and rejects
both comments and unknown keys — hence this page).

## Where it runs
| Thing | Value |
|---|---|
| Host | Vercel, project `lms`, team `techgeekz3` |
| Plan | Hobby |
| Repo | `github.com/Mrluciferxd/lms`, connected — pushes to `main` auto-deploy |
| Function region | `iad1` (US East) |
| Database | Neon `neon-aquamarine-lens`, `us-east-1`, connected via the Vercel storage integration |
| Brand | `NEXT_PUBLIC_BRAND=nirlep-forex` |

## Why `iad1` and not `bom1`
The audience is India-based, so Mumbai looks like the obvious region — and it was the
original setting. It is wrong here.

Neon was provisioned in `us-east-1`. Server-rendered pages in this app issue several
queries per render (outline resolution alone is three). A Mumbai function talking to a
US-East database pays the transatlantic round trip *per query*, so a page doing five
queries pays it five times. Co-locating the function with the database makes those
queries ~1ms and leaves the user paying one network hop for the finished HTML.

If the database is later moved to `ap-southeast-1` or Mumbai, move `regions` back to
`bom1` **at the same time**. The rule is that they travel together.

## Cron: why GitHub Actions and not Vercel
Vercel's Hobby plan caps cron jobs at **once per day**. Class reminders fire 30 minutes
before a session, so daily granularity makes them useless.

- `vercel.json` keeps a daily cron as a safety net.
- `.github/workflows/notification-cron.yml` drives `/api/cron/notifications` every 10
  minutes with `Authorization: Bearer $CRON_SECRET`.

This is only safe because the scheduler is idempotent — every notification carries a
deterministic `dedupeKey` and `Notification.dedupeKey` is unique, so an overlapping or
repeated run is a no-op insert rather than a duplicate message. Do not weaken that
property while this scheduler is in use.

Move back to native Vercel cron if the account moves to Pro.

Required repository secrets for the workflow:
- `CRON_SECRET` — must match the Vercel env var exactly
- `APP_BASE_URL` — the production URL

## Environment variables
Injected automatically by the Neon integration: `DATABASE_URL` (pooled),
`DATABASE_URL_UNPOOLED`, `POSTGRES_*`, `PG*`.

Set manually:
| Variable | Notes |
|---|---|
| `AUTH_SECRET` | Generated per environment |
| `CRON_SECRET` | Must match the GitHub Actions secret |
| `NEXT_PUBLIC_BRAND` | `nirlep-forex` |
| `DIRECT_URL` | Set to `DATABASE_URL_UNPOOLED` — see below |
| `NEXT_PUBLIC_APP_URL` | The production URL; used for `metadataBase` and absolute SEO URLs |

**`DIRECT_URL` is not optional.** Neon's default `DATABASE_URL` points at the pooled
endpoint (`-pooler` in the host). Prisma Migrate needs a session-mode connection to take
advisory locks, so `prisma.config.ts` prefers `DIRECT_URL`. Runtime queries use the
pooled URL, which is correct for serverless.

**`AUTH_URL` is deliberately not set.** `trustHost: true` derives the origin from the
request. Pinning it breaks sign-in whenever the app is reached on a preview URL.

## Release process
Pushing to `main` deploys. For a manual deploy: `vercel deploy --prod --yes`.

After a schema change:
```
DATABASE_URL="<unpooled>" npx prisma migrate deploy
```
Migrations are additive only and every client database is separate, so each migration
ships once per deployment. See `docs/04-white-label.md`.

## Known gotchas
- **`vercel.json` is strict.** Unknown properties fail the deploy with
  "Schema verification failed". There is nowhere to put a comment — put it here instead.
- **`vercel env pull` redacts CLI-added secrets.** It writes the literal string
  `[SENSITIVE]` in place of any value added through `vercel env add`, while
  integration-injected values (the Neon `DATABASE_URL*` set) come through intact. Copying
  a secret out of the pulled file therefore produces the 11-character string
  `[SENSITIVE]` rather than the secret — which is exactly how `CRON_SECRET` first reached
  GitHub Actions and produced a 401. When a secret must exist in two places, generate it
  once into a shell variable and write it to both from there. Never round-trip it through
  `env pull`.
- **Changing an env var requires a redeploy.** Serverless functions capture environment
  at build time; updating a value in the dashboard or CLI does not affect the running
  deployment until it is rebuilt.
- **Deployment Protection blocks external callers.** The project defaulted to
  `ssoProtection: all_except_custom_domains`, which 302s every request to Vercel SSO —
  including the marketing site, the GitHub Actions cron and Razorpay webhooks. It is now
  `preview`, so previews stay protected and production is public.
- **Push-triggered deploys are blocked unless the commit author satisfies two separate
  checks.** This bit twice, with different messages:
  - `urbanmirror.shop@gmail.com` → `TEAM_ACCESS_REQUIRED`, "must have access to the team
    Techgeekz"
  - `bizflip8@gmail.com` → "GitHub could not associate the committer with a GitHub user"

  The author must be an email GitHub maps to a GitHub account **and** that account must be
  linked to the Vercel team. The repo-local `user.email` is therefore
  `72061915+Mrluciferxd@users.noreply.github.com` — GitHub's noreply address for the
  `Mrluciferxd` account, which satisfies both by construction. Global git config is
  deliberately left untouched.

  CLI deploys (`vercel deploy --prod`) bypass this check entirely, which is why they kept
  working while push deploys failed. If push deploys start failing again, check the
  commit author before anything else.

  The same block affects the team's `textile-erp` project, which has been failing to
  deploy for the same reason.
- **Video does not work in production yet.** The `LOCAL` provider refuses to run outside
  development because it offers no DRM or watermarking, and Bunny is not configured.
  Uploads return 503 and playback errors, by design, rather than serving unprotected
  lectures. See ISSUE-004 / ISSUE-005.
- **Checkout fails at the gateway.** No Razorpay keys are set. The order, coupon and
  invoice logic underneath is tested and works.
- **Notification delivery is in-app only.** No provider SDKs are installed — ISSUE-006.
- **Seeding is a one-time step per deployment**, run against the unpooled URL:
  `prisma/seed.ts` then `scripts/install-packs.ts`. The seed creates `OrgSettings` and
  the owner account and deliberately seeds no sample content.

## Related
[architecture.md](./architecture.md) · [notifications.md](./notifications.md) · [known-issues.md](./known-issues.md) · `docs/04-white-label.md`
