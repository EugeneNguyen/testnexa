# AUTH-2: Session Persistence via Refresh Token — Scope Plan

**Date:** 2026-09-03
**Status:** Draft — for review, no implementation yet
**Story:** [AUTH-2](../../user-stories/2026-09-03-auth-stories.md#story-auth-2-session-persistence-via-refresh-token)
**Spec context:** [ADR-0003 auth/token strategy](../../adr/0003-auth-token-strategy.md), [API design §2](../../api/2026-09-03-api-design.md), [AUTH-1 plan](2026-09-03-auth-1-local-password-login-plan.md) (prior slice, merged)

## 0. Repo state

AUTH-1 is merged. `RefreshToken` table exists and is already populated at login time (hash only, `revoked_at`/`revoked_reason` nullable, no unique constraint on `user_id` — multiple concurrent rows per user are supported, i.e. multi-device sessions). `create_access_token`/`create_refresh_token`/`decode_token`/`hash_refresh_token` all exist and work. `app/core/rbac.py` is still a stub — `get_current_actor`/`require_permission`/`has_permission` all raise `NotImplementedError`. No route other than `/auth/login` and `/health` is mounted. Frontend `AuthContext` holds `accessToken` in React state only, reset to `null` on every page load — there is no mechanism today that re-establishes a session from the httpOnly cookie after a browser restart, and `apiFetch` never attaches an `Authorization` header at all (nothing has needed one yet).

API design doc §2 already reserves the contract shape: `POST /auth/refresh` (no bearer auth, valid refresh cookie required) → FR-AUTH-2; `GET /auth/me` (authenticated) exists in the route table but isn't mapped to a specific story. Neither route's request/response body is spec'd beyond the table row — this plan defines both.

## 1. Scope

**In scope for AUTH-2:**

- New `POST /api/v1/auth/refresh` route: reads `refresh_token` from the httpOnly cookie (never a request body field — cookie is the only transport, matching login's cookie-only delivery). Looks up `RefreshToken` by `hash_refresh_token(cookie_value)`. Rejects (401, generic body) if: cookie missing, hash not found, `revoked_at` is set, or `expires_at` has passed.
- **Refresh token rotation**: every successful refresh revokes the presented `RefreshToken` row (`revoked_at=now`, `revoked_reason="rotated"`) and issues a brand-new opaque refresh token + `RefreshToken` row + new httpOnly cookie, alongside a new access token. This is the standard mitigation for a leaked refresh token being replayed indefinitely, and matches ADR-0003's consequence note ("adds one write per token refresh cycle").
- Response body: `{access_token}` only — no `org_context`/`orgs` (frontend already holds those from the initial login; refresh's job is purely to renew the access token).
- New `GET /api/v1/auth/me` route (authenticated, bearer access token): returns the calling actor's id/email. This is the minimal "protected route" needed to make AC1/AC2 observable at all — right now there are zero routes that require an access token, so there's nothing for a silent-refresh-on-401 flow to protect. Scoped to identity only, no permission codes (full RBAC stays out of scope, per AUTH-1's carve-out).
- Minimal `get_current_actor` in `app/core/rbac.py`: decode+verify the bearer JWT, look up the `User`/`AIAgent` row by `sub`, 401 on missing/invalid/expired token or a `sub` that doesn't resolve to an actor. `require_permission`/`has_permission` stay `NotImplementedError` — no permission codes are being checked yet, only identity.
- Frontend token plumbing: `apiFetch` currently has no way to read or attach an access token. Move token storage out of `AuthContext`'s React state into a small module-level store (`lib/auth/tokenStore.ts`: `getAccessToken`/`setAccessToken`/`clearAccessToken`, plain module state + subscriber callback) so `apiFetch` can read/attach `Authorization: Bearer <token>` without needing React context. `AuthContext` becomes a thin wrapper that subscribes to the store for render purposes.
- `apiFetch` 401 handling: on a 401 from any authenticated call, attempt `POST /auth/refresh` once (`credentials: "include"`), update the token store on success and retry the original request once; on refresh failure, clear the token store and hard-redirect to `/login` (`window.location.assign`). Concurrent 401s from multiple in-flight requests share a single in-flight refresh call (promise memoization) rather than each firing their own `/auth/refresh`.
- App-boot silent refresh: `AuthProvider` calls `POST /auth/refresh` once on mount (this is the actual "survive a browser restart" mechanism — the reactive 401-retry above only covers a token expiring mid-session while the tab is already open). Exposes an `isInitializing` flag while that call is in flight so route guards don't redirect to `/login` before it settles.
- `ProtectedRoute` wrapper: gates `/orgs/:orgId` (and `/orgs/pick`) behind "access token present after boot-refresh has settled"; redirects to `/login` otherwise. `/login` itself stays unguarded.
- `backend/tests/integration/test_auth_refresh.py`: TC-AUTH-006 (silent refresh via `/auth/me` 401→refresh→retry), TC-AUTH-007 (revoked token → 401, no new token issued), TC-AUTH-008 (two sessions for one user, revoking one doesn't affect the other), rotation (old token unusable after one refresh), expired token → 401, missing cookie → 401.
- `backend/tests/unit/test_security.py` additions: none expected — no new functions in `security.py`, rotation logic lives in the route.
- `frontend/tests/`: token store get/set/subscribe; `apiFetch` 401→refresh→retry and concurrent-401-dedup behavior (mocked fetch); `ProtectedRoute` redirect behavior.
- `e2e/tests/auth-refresh.spec.ts`: real-browser boot-refresh (reload page, session survives), revoked-token redirect to login.

**Explicitly out of scope (belongs to later stories):**

- `POST /auth/logout` — AUTH-3. AUTH-2's integration tests reach a "revoked" state by writing `revoked_at` directly via the test DB fixture (same fixture-bypass pattern AUTH-1 used for user/org setup), not by calling a logout route that doesn't exist yet.
- Any admin-facing "force logout a user" UI/endpoint. No story in the current AUTH-1..4 set owns this — ADR-0003's "an admin can force-logout a human user... with one action" is a consequence of the schema supporting it (any `RefreshToken.revoked_at` write achieves it), not a built feature. AUTH-2 only needs the *effect* of a revoked token to be honored on refresh, not a UI to produce one.
- `require_permission`/`has_permission` and any permission-code enforcement — RBAC stories.
- Re-validating org membership status (active/suspended) on every refresh — see edge cases §3, flagged as an open question rather than silently included or excluded.
- AIAgent bearer auth — AUTH-4, unrelated token type.
- Refresh-token reuse *detection* beyond the rotated token simply being 401-rejected (i.e. no cascade-revoke-all-sessions-for-this-user response to a reused/rotated-out token being replayed) — see edge cases §3.

## 2. Affected files

**Backend — new**
- `backend/tests/integration/test_auth_refresh.py` — TC-AUTH-006/007/008 + rotation/expiry/missing-cookie cases

**Backend — modify**
- `backend/app/api/routes/auth.py` — add `POST /auth/refresh`, `GET /auth/me`
- `backend/app/core/rbac.py` — implement `get_current_actor` only (bearer JWT decode + actor lookup); `require_permission`/`has_permission` stay stubbed
- `backend/app/schemas/auth.py` — add `RefreshResponse` (`{access_token}`), `MeResponse` (`{actor_id, email}` or similar)
- `backend/app/api/deps.py` — likely add a `get_current_actor` re-export, mirroring the existing `get_db` pattern

**Frontend — new**
- `frontend/src/lib/auth/tokenStore.ts` — module-level access-token store (get/set/clear/subscribe)
- `frontend/src/lib/api/auth.ts` — add `refresh()`, `me()` calls (extend existing file)
- `frontend/src/auth/ProtectedRoute.tsx` — route guard component

**Frontend — modify**
- `frontend/src/lib/api/client.ts` — `apiFetch` attaches `Authorization` header from `tokenStore`; 401 → refresh → retry-once → else clear store + redirect; concurrent-refresh dedup
- `frontend/src/auth/AuthContext.tsx` — read from `tokenStore` instead of owning token state directly; add `isInitializing`; call `refresh()` on mount
- `frontend/src/App.tsx` — wrap `/orgs/*` routes in `ProtectedRoute`

No new migration — `RefreshToken` table already has every column this story needs (`revoked_at`, `revoked_reason`, `expires_at`). No infra file changes.

## 3. Edge cases

- **Rotation replay window:** rotating on every refresh means the previous token is immediately unusable. A prior AUTH-1-style plaintext-not-logged concern doesn't apply here (opaque tokens, not passwords), but a genuine multi-tab race exists: two tabs whose access tokens expire near-simultaneously can both fire `/auth/refresh` before either's `Set-Cookie` is applied by the browser: the second request's cookie value may already be rotated-out server-side by the first, producing a false 401 in an otherwise-valid session. No reuse-grace-window is implemented in this pass — accepted as a known gap (worse case: the losing tab's user sees a forced re-login even though the session is objectively still good), not silently dropped. Flagged in §4.
- **Cookie missing entirely** (never logged in, or cookie cleared by the browser/user): `/auth/refresh` 401s the same generic way as an expired/revoked one — no distinct error code, since distinguishing "never had a session" from "session revoked" isn't security-sensitive here (unlike login's user-enumeration concern) but also isn't useful to the frontend, which treats every refresh failure identically (clear state, redirect).
- **`GET /auth/me` access-token edge cases:** expired JWT (`decode_token` raises `jwt.ExpiredSignatureError`) and structurally invalid/tampered JWT (`jwt.InvalidSignatureError`/`DecodeError`) both need to collapse to the same 401 the frontend's interceptor reacts to — `get_current_actor` must catch `jwt.PyJWTError` broadly, not just the expiry case.
- **Actor deleted/suspended after token issuance:** `sub` decodes fine but the `User` row is gone (hard delete, if that's ever possible) or the actor otherwise shouldn't be treated as valid — `get_current_actor` needs a DB lookup after JWT verification, not just trusting the claims; a missing row is a 401, not a 500.
- **Refresh token TTL vs access token TTL:** `JWT_REFRESH_TTL_DAYS=30` means a rotated refresh token's `expires_at` — does rotation reset the 30-day clock from "now," or preserve the original session's absolute expiry? Preserving the original expiry (sliding-window-capped) is the safer default for a compliance persona (a stolen-but-still-being-used cookie shouldn't get an indefinitely-renewing lifetime); flagged as an open question in §4 since it's a real security-posture choice, not a mechanical detail.
- **Concurrent refresh from the same tab:** two `apiFetch` calls both getting 401 at once must not each independently call `/auth/refresh` (that would race the same rotation problem as the multi-tab case, but avoidably) — the promise-memoization dedup in `apiFetch` (§1) handles this specific case even though the cross-tab case is out of scope.
- **`/auth/refresh` itself never triggers the 401→refresh→retry interceptor recursively** — it must be called with a bypass flag/separate code path in `apiFetch`, or a 401 from `/auth/refresh` would otherwise try to refresh-and-retry itself into a loop.

## 4. Open questions

1. **Should `/auth/refresh` re-check active `OrgMembership` (like login does) and reject with 403/401 if the user now has zero active orgs?** Suspending a member mid-session currently only matters once RBAC enforcement lands on other routes, but a silently-renewing session for a suspended compliance user seems to cut against the story's own "admin can revoke my access immediately" premise if refresh doesn't check anything beyond the token row. Recommend: yes, re-check, reuse the same zero-active-org 403 path login uses — but this is a scope/security trade-off call, not a mechanical one.
2. **Rotation TTL semantics** — does a rotated refresh token get a fresh 30-day `expires_at` from the moment of rotation, or inherit the original session's absolute expiry? Recommend: inherit the original (store/propagate the session's original `issued_at` or first-token `expires_at` forward through each rotation) so an endlessly-used-but-never-revoked session can't outlive 30 days from its true start. Needs a decision before implementation — affects the `RefreshToken` row's `expires_at` computation on rotation.
3. **Multi-tab reuse-grace-window** (§3) — accept the documented race as a known gap for this pass, or add a short grace period (e.g. treat a just-rotated-out token as valid for N seconds after rotation)? Recommend: accept the gap now, revisit if it proves disruptive in practice (YAGNI) — but flagging explicitly rather than deciding unilaterally, since AUTH-2 sells itself on Marcus's compliance/revocability needs and a grace window is in tension with "immediately."
4. **`GET /auth/me` response shape** — API design doc says it "returns current Actor + resolved permission codes, drives frontend route guards," but permission codes don't exist yet (RBAC stub). Recommend: ship `{actor_id, email, actor_type}` now, extend with `permissions: []` when an RBAC story lands, rather than blocking AUTH-2 on RBAC. Confirm this partial-contract approach is acceptable.

## 5. Status

No code, migrations, or config are created by this plan. Awaiting decisions on §4 (all four affect implementation details, none block starting once resolved) and explicit go-ahead.
