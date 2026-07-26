# Payments

## What this subsystem does
Sells courses through Razorpay, records orders and payments, issues invoices, and tracks
staged fee obligations separately from payment attempts.

## How it is structured
| File | Responsibility |
|---|---|
| `gateway.ts` | `PaymentGatewayAdapter` contract + registry; `resolveGateway()` from brand config |
| `razorpay.ts` | Razorpay adapter and `verifyRazorpayWebhook` |
| `manual.ts` | Manual gateway for offline settlement |
| `pricing.ts` | **Pure**: `evaluateCoupon`, `computeOrderTotals`, `discountFor` |
| `checkout.ts` | Creates the order and the gateway order; `previewCoupon` |
| `webhook.ts` | `receiveRazorpayWebhook` — signature, idempotency, settlement |
| `events.ts` | **Pure**: parses and interprets Razorpay event payloads |
| `orders.ts` | Settlement, failed payments, refunds, gateway refund sync |
| `fees.ts` | `FeeSchedule` / `FeeInstallment` lifecycle, student dues |
| `schedule.ts` | **Pure**: timezone-correct installment plan generation |
| `numbering.ts` | **Pure**: gapless per-year document numbering + `allocateDocumentNumber` |
| `invoices.ts` | Invoice issuance |
| `reconcile.ts` | Flags orders that look wrong (stale pending, amount mismatch) |
| `signature.ts` | **Pure**: `verifyWebhookSignature`, `verifyCheckoutSignature` |

## Conventions and rules
- **Money is integer minor units end to end.** `priceMinor`, `totalMinor`,
  `amountMinor`. Rupees appear only at the UI edge via `formatMoney`.
- **An `Order` is a payment attempt; a `FeeSchedule` is an obligation.** They are
  deliberately separate models: one installment may take several order attempts, and a
  schedule exists whether or not anything has been paid. `FEE_DUE` reminders read
  installments, never orders.
- **The webhook verifies before it trusts.** HMAC signature check first, then insert
  `WebhookEvent` (unique on `gateway,eventId`) and no-op on conflict, then settle.
  Razorpay retries; double-crediting an enrollment is not an acceptable failure.
- **Enrollment on payment goes through `enrollUser()`** — never a direct create. See
  ISSUE-002.

## Known gotchas
- **Invoice numbering must be gapless and collision-free under concurrency.**
  `allocateDocumentNumber` handles this; do not replace it with a `count() + 1`, which
  races and produces duplicates under simultaneous checkouts.
- **Installment dates are computed in the org timezone**, not UTC — `schedule.ts` has
  `addMonthsInZone` / `addDaysInZone` and `zonedParts` for exactly this. A fee due
  "on the 5th" must be the 5th locally, and month-end clamping (31 Jan + 1 month) is
  handled explicitly by `daysInMonth`.
- **`splitAmount` exists because dividing money by N leaves a remainder.** Three
  installments of ₹10,000 are not three of ₹3,333.33 — the remainder is distributed
  deterministically so the parts sum exactly to the total.
- **A coupon must never drive a total below zero.** `evaluateCoupon` clamps; there is a
  test for it.
- **Razorpay amounts are already in paise**, matching our minor units. Do not multiply.

## How it is tested
- `pricing.test.ts` — coupon eligibility, percent rounding, clamping at zero, scoping.
- `signature.test.ts` — valid, forged and malformed signatures.
- `events.test.ts` — payload parsing and event interpretation.
- `numbering.test.ts` — format, parse, ordering, gapless allocation.
- `schedule.test.ts` — cadence, month-end clamping, timezone boundaries, remainder split.
- `reconcile.test.ts` — the flag classifications.
- `payments.dbtest.ts` — webhook settlement, replay idempotency, manual settlement,
  refunds, and repeat enrollment through the webhook path.

## Not yet done
- No live Razorpay account has been connected; nothing has been exercised against the
  real gateway. Signature verification is tested against locally-generated HMACs.
- Refunds are recorded and can be synced, but initiating a refund through the gateway
  API is not wired.

## Related
[notifications.md](./notifications.md) (fee reminders) · [known-issues.md](./known-issues.md)
