# Auth & Authorization

## What this subsystem does
Establishes who the request is from and what they may do. Identity is Auth.js v5 with
JWT sessions; authorization is a capability matrix re-evaluated per request against the
live user row.

## How it is structured
| File | Responsibility |
|---|---|
| `src/server/auth/config.ts` | Full Auth.js config: Prisma adapter, credentials + optional Google, callbacks |
| `src/server/auth/edge.ts` | Edge-safe config for middleware (no Prisma, no bcrypt) |
| `src/server/auth/roles.ts` | `Permission` union, `ROLE_PERMISSIONS` matrix, `STAFF_ROLES` |
| `src/server/auth/rbac.ts` | `getCurrentUser`, `requireUser`, `requirePermission`, `requireStaff`, `authorizeRequest` |
| `src/server/auth/password.ts` | bcrypt cost 12, timing-equalising dummy compare, rehash-on-login |
| `middleware.ts` | Coarse route gating on the edge |

## Conventions and rules
- **Permissions are capabilities, not a hierarchy.** There is no "level 3 user". An
  instructor authors content and grades; ops staff handle fees and enrollment. Asking
  "is an instructor above or below staff?" has no answer, so the code never asks.
- **Middleware is not the security boundary.** The edge JWT is a cached claim, stale up
  to `updateAge` (24h). Every protected page and server action calls `requireUser()` /
  `requirePermission()`, which read the live row and enforce `status`.
- **Prefer 404 to 403.** `requirePermission` and `requireStaff` call `notFound()`. A
  student probing `/admin/payments` should not learn the route exists.
- **Server actions are endpoints.** Every action re-checks with `authorizeRequest()`.
  Hiding the button is not authorization.

## Known gotchas
- **Credentials require JWT sessions.** Auth.js does not support the credentials provider
  with database sessions. The `Session` model exists for the adapter but is unused.
- **Sign-in failures are deliberately indistinguishable.** Unknown email, wrong password
  and suspended account all return the same message, and the not-found path spends the
  same bcrypt time via `burnPasswordComparison`. Without that, response timing reveals
  which emails are enrolled — the student roster is not public information.
- **`AUTH_URL` should normally be unset.** `trustHost: true` derives the origin from the
  request. Setting `AUTH_URL` pins redirects to that exact origin and breaks sign-in
  whenever the app is reached elsewhere (this cost an hour once — see changelog).
- **OAuth does not self-register.** An academy enrolls students; it is not an open signup
  product. Google sign-in only succeeds for an email that already has a non-deactivated
  account, and completes an `INVITED` account on first use.
- **JWT module augmentation must target `@auth/core/jwt` as well as `next-auth/jwt`.**
  The `session` callback is typed against the former; augmenting only the latter leaves
  `token.role` as `{}`.

## How it is tested
Permission matrix and staff bypass are covered in `src/server/catalog/access.test.ts`
and `src/server/sessions/visibility.test.ts` (allowed and denied cases for every role).
Route-level enforcement was verified with an authenticated curl sweep: all admin routes
return 200 for staff, 404 for a student, and 307 to sign-in when anonymous.

Not covered by automated tests: the Auth.js callback wiring itself.

## Related
[catalog-and-drip.md](./catalog-and-drip.md) · [batches-and-attendance.md](./batches-and-attendance.md) · [architecture.md](./architecture.md)
