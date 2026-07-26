# Onboarding a new client deployment

One deployment, one database, one brand per client. This is the repeatable
checklist that makes per-client deployment cheap enough to be the right trade.

## 1. Create the brand config

```bash
mkdir -p brands/<client-key>
cp brands/demo-academy/brand.config.ts brands/<client-key>/brand.config.ts
```

Start from `demo-academy`, not from another client — copying a client config
carries their packs, integrations and security posture as invisible defaults.

Edit it, then register it in [`brands/index.ts`](../brands/index.ts):

```ts
import clientKey from './client-key/brand.config'

export const BRANDS: Record<string, BrandConfig> = {
  [clientKey.key]: clientKey,
  // ...
}
```

Static imports are deliberate: a per-client build tree-shakes every other brand
out of the bundle.

### What goes in a brand config

| Group | Notes |
|---|---|
| Identity | `key`, `name`, `legalName`, `domain`, support contacts |
| Locale | `locale`, `currency`, `timezone` — default to India, override per client |
| Logo | Paths under `public/brands/<key>/` |
| `theme` | `primary` is the only required colour |
| `packs` | Vertical pack keys. `[]` is valid and fully functional |
| `features` | Only state what differs from `DEFAULT_FEATURES` |
| `integrations` | Payment, video, storage, email, SMS, WhatsApp, push providers |
| `videoSecurity` | Only state what differs from `DEFAULT_VIDEO_SECURITY` |
| `marketing` | Tagline, description, landing pages, socials, risk disclaimer |
| `legal` | Policy URLs, address, GSTIN for invoices |

Financial-education clients need `marketing.riskDisclaimer` populated. It renders
in the footer where regulators expect it.

## 2. Provision infrastructure

Per the proposal's section 3, hosting and third-party subscriptions are the
client's cost, procured in their own accounts. Set them up under the client's
billing, not ours — this matters at renewal and if the relationship ends.

- Postgres (Neon, Supabase or RDS). If the connection string is pooled, set
  `DIRECT_URL` to the direct endpoint as well — Migrate needs session mode for
  advisory locks.
- Object storage bucket (S3 or R2) with CORS for the app origin.
- Video library (Bunny Stream) with token authentication enabled.
- Email sending domain, SPF/DKIM verified.
- WhatsApp Business sender and SMS sender ID, if enabled.
- Any pack data feeds — for forex, the economic calendar subscription.

## 3. Configure environment

Copy `.env.example` to the deployment's environment. Required in every case:

```
NEXT_PUBLIC_BRAND=<client-key>
NEXT_PUBLIC_APP_URL=https://<domain>
DATABASE_URL=...
AUTH_SECRET=            # openssl rand -base64 32
CRON_SECRET=            # openssl rand -base64 32
```

Then whatever the brand's `integrations` block names. A missing integration key
fails at boot with a named error rather than at the first student's checkout.

Data-feed keys are the exception: those degrade to a setup notice by design, so a
lapsed client subscription never takes the dashboard down.

## 4. Migrate and seed

```bash
npm ci
npx prisma migrate deploy
npm run db:seed
npm run packs:install
```

- `migrate deploy` applies migrations without generating new ones. Never run
  `migrate dev` against a client database.
- `db:seed` writes `OrgSettings` from the brand config and creates the owner
  account.
- `packs:install` writes the enabled packs' journals, trackers, widgets,
  templates and channels. Idempotent — safe to re-run after enabling a pack.

## 5. Verify before handover

- [ ] Sign in as owner; invite a test student
- [ ] Publish a course with two sections and a drip-scheduled lesson
- [ ] Upload a video; confirm DRM playback, watermark shows the test student, and
      a second concurrent stream is refused
- [ ] Confirm a drip-locked lesson is inaccessible by direct URL, not just hidden
- [ ] Run a live test payment end to end; confirm the webhook enrolls the student
      and the invoice generates
- [ ] Trigger a class reminder and a fee reminder on every enabled channel
- [ ] Mark attendance for a session; confirm it appears in the student's record
- [ ] Post in chat as two users
- [ ] Create a journal entry; confirm computed fields calculate
- [ ] Confirm data widgets render, including with the feed key deliberately unset
- [ ] Landing pages: Lighthouse pass, OG tags, lead form delivering
- [ ] Confirm the risk disclaimer and legal pages render (financial clients)

## 6. Ongoing

**Patch rollout.** A security fix ships to every client deployment. Keep the
client list in one place, roll out staging → smallest client → the rest, and
verify migrations are additive before starting. This is the standing cost of the
per-client model and the reason the checklist above exists.

**Per-client customization.** Resist it. A client-specific change belongs in one
of three places, in order of preference: their brand config, a new pack, or a new
core feature behind a flag. A conditional on a client key inside core is how a
white-label product turns back into N bespoke projects.
