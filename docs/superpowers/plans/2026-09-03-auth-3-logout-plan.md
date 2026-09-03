# AUTH-3: Logout — Scope Plan

**Date:** 2026-09-03
**Status:** Confirmed — decisions locked in §4, ready for implementation
**Story:** [AUTH-3](../../user-stories/2026-09-03-auth-stories.md#story-auth-3-logout)
**Spec context:** [ADR-0003 auth/token strategy](../../adr/0003-auth-token-strategy.md), [ADR-0013 refresh rotation policy](../../adr/0013-refresh-token-rotation-policy.md), [API design §2](../../api/2026-09-03-api-design.md), [AUTH-2 plan](2026-09-03-auth-2-session-persistence-plan.md) (prior slice, merged)

## 0. Repo state

AUTH-1 + AUTH-2 are merged. `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` exist; `get_current_actor` (bearer JWT → `User`) is implemented in `app/core/rbac.py`. `RefreshToken` rows carry `revoked_at`/`revoked_reason` and are revoked today via one pattern only — `/auth/refresh`'s atomic conditional `UPDATE ... WHERE id = :id AND revoked_at IS NULL` compare-and-swap (`backend/app/api/routes/auth.py:300-304`), chosen there specifically to close a concurrent-rotation race. `POST /auth/logout` is already reserved in the API design table (`docs/api/2026-09-03-api-design.md:30`, "authenticated", no body contract yet) and in test cases (`TC-AUTH-009`, `docs/test-cases/2026-09-03-test-cases.md:29`) but has no route, no schema, and no frontend call. There is no logout UI anywhere — no mounted page currently renders a nav bar, menu, or button of any kind; `OrgHome.tsx` is a bare placeholder (`Org: {orgId}` heading only).

Frontend token handling: access token lives in `lib/auth/tokenStore.ts` (module state, `getAccessToken`/`setAccessToken`/`clearAccessToken`/`subscribe`); refresh token is an httpOnly cookie the frontend never reads directly. `apiFetch` (`lib/api/client.ts`) attaches `Authorization: Bearer <token>` automatically and already has a 401→refresh→retry interceptor plus a shared `requestRefresh()` dedup used by both that interceptor and `AuthContext`'s boot-time silent refresh.

## 1. Scope

**In scope for AUTH-3:**

- New `POST /api/v1/auth/logout` route, authenticated (`get_current_actor` dependency, same as `/auth/me`). No request body.
  - Reads `refresh_token` from the httpOnly cookie, same as `/auth/refresh`.
  - If present: hash it, revoke the matching `RefreshToken` row via the same atomic conditional `UPDATE ... WHERE token_hash = :hash AND user_id = :user_id AND revoked_at IS NULL` compare-and-swap pattern `/auth/refresh` uses, `revoked_reason="logout"`. Scoping the `WHERE` to the authenticated user's `id` (not just the token hash) means a token that doesn't belong to the caller is never revoked, even if a stale/foreign cookie value happened to hash-collide-relevant — practically this only matters if a caller's cookie and bearer token ever disagree on whose session it is.
  - Idempotent: whether the cookie is missing, the hash isn't found, the row belongs to a different user, or it's already revoked (double-logout, or a concurrent `/auth/refresh` beat it to rotating the same row), the endpoint still returns success — logout's job is "make sure this session is dead," and it already is in every one of those cases. No 401/404 branching on any of them; only a missing/invalid **access** token (handled by `get_current_actor`, unauthenticated) 401s.
  - Response: `204 No Content`, no body. Clears the `refresh_token` cookie on the response (`response.delete_cookie`) with the same `httponly`/`samesite`/`secure` attributes `login`/`refresh` set it with, so the browser actually drops it rather than leaving a now-orphaned cookie behind.
- Frontend `logout()` API call (`lib/api/auth.ts`): `POST /api/v1/auth/logout`, `credentials: "include"` (needs the refresh cookie sent), default `apiFetch` 401-retry behavior left **on** (unlike `login`/`refresh`) — see edge case below for why.
- `AuthContext` gains a `logout()` method: calls the API function, then unconditionally clears the token store (`clearAccessToken()`) and resets local `orgContext`/`orgs` state to `null`/`[]`, regardless of whether the network call succeeded — the client-side clear is what actually protects a shared machine, and must not be skipped just because the revoke call failed. Redirects to `/login` afterward (React Router navigation, consistent with `ProtectedRoute`'s client-side redirect style, not `apiFetch`'s hard `window.location.assign`).
- App navbar, built now (confirmed §4.3): `frontend/src/components/AppHeader.tsx`, CoreUI `CHeader`/`CHeaderBrand`/`CHeaderNav`/`CButton` (ADR-0012 — no Tailwind, no hand-rolled header markup), showing the app name and a "Log out" button wired to `useAuth().logout()`. Mounted once inside `ProtectedRoute` (wraps `children` after the `isInitializing`/auth-token gate passes) so every current and future protected page gets it for free without each page wiring its own button.
- `ProtectedRoute.tsx` modify: render `<AppHeader />` + `children` instead of bare `children` once authenticated.
- `backend/tests/integration/test_auth_logout.py`: TC-AUTH-009 (logout revokes the refresh token — `POST /auth/logout` then `POST /auth/refresh` with the same cookie now 401s), logout with no refresh cookie (still 204), logout with an already-revoked/rotated-out cookie (still 204), logout with no/invalid access token (401, `get_current_actor`'s existing generic body), logout doesn't touch a *different* session's `RefreshToken` row (two sessions for one user — or two different users — logging out session A leaves session B's refresh usable).
- `frontend/tests/`: `AuthContext.logout()` clears the token store and resets org state even when the API call rejects (mocked fetch failure); `lib/api/auth.ts`'s `logout()` call shape.
- `e2e/tests/auth-logout.spec.ts`: real-browser logout — log in, click the navbar's "Log out" button, land on `/login`, confirm the old refresh cookie no longer works (`POST /auth/refresh` via the existing `window.__testApiFetch` dev hook, or a direct API call in the test, returns 401) and the old access token's protected calls stop succeeding once expired. Follows the same fixture/dev-hook conventions as `e2e/tests/auth-refresh.spec.ts` (real Postgres, no logout-route-specific mocking).

**Out of scope (explicitly deferred, not silently dropped):**

- "Log out of all devices" (revoking every `RefreshToken` row for the user, not just the current session's). AUTH-3's acceptance criteria says "their **current** refresh token" — singular, current session only.
- A full app shell beyond the header itself (sidebar, breadcrumbs, user menu/dropdown) — `AppHeader` is brand + logout button only, sized to what AUTH-3 needs.
- Immediate access-token invalidation. The story's own AC2 accepts that an already-issued access token keeps working until it naturally expires (`JWT_ACCESS_TTL_MINUTES=15`) — logout only guarantees the refresh token is dead, matching AUTH-2's revocation model. No token-blocklist/deny-list is being added to force-expire live access tokens early.

## 2. Affected files

**Backend — new**
- `backend/tests/integration/test_auth_logout.py` — TC-AUTH-009 + no-cookie/already-revoked/wrong-session/unauthenticated cases

**Backend — modify**
- `backend/app/api/routes/auth.py` — add `POST /auth/logout`
- `backend/app/schemas/auth.py` — no new schema (confirmed `204`, no body)

**Frontend — new**
- `frontend/src/components/AppHeader.tsx` — CoreUI navbar, brand + "Log out" button
- `frontend/tests/AppHeader.test.tsx` — renders logout button, calls `useAuth().logout()` on click
- `e2e/tests/auth-logout.spec.ts`

**Frontend — modify**
- `frontend/src/lib/api/auth.ts` — add `logout()`
- `frontend/src/auth/AuthContext.tsx` — add `logout()` to context value, wire client-side clear + redirect
- `frontend/src/auth/ProtectedRoute.tsx` — render `<AppHeader />` above `children` once authenticated

No new migration — `RefreshToken.revoked_at`/`revoked_reason` already exist and already support an arbitrary `revoked_reason` string (`"rotated"` is the only value used so far; `"logout"` is a new value in the same column, not a schema change). No infra file changes.

## 3. Edge cases

- **Logout call itself 401s (access token already expired at click time):** `POST /auth/logout` is authenticated, so an expired access token 401s via `get_current_actor` before the handler ever runs. Leaving `apiFetch`'s default 401→refresh→retry interceptor **on** for this call (unlike `login`/`refresh`, which opt out) means: refresh succeeds → logout retries with the fresh access token → the *new* refresh token (post-rotation) gets revoked, which is still correct, just revokes the rotated descendant rather than the exact token that was live at click time — same session, so no behavior gap. If refresh also fails (refresh token itself already dead), the interceptor's own failure path clears the token store and hard-redirects to `/login` already — `AuthContext.logout()`'s own clear/redirect afterward is then a harmless no-op on an already-cleared store. Either path ends at "logged out, redirected" — worth a test but not a design branch.
- **Missing refresh cookie at logout time** (deleted manually, third-party-cookie blocking, or a tab that never had one): route must not error — nothing to revoke, but the caller's *access* token still made it past `get_current_actor`, so returning 204 (not 401) is correct; the "session" from the frontend's perspective is still being torn down client-side either way.
- **Double logout / already-rotated cookie:** clicking "Log out" twice fast (e.g. a slow first request, impatient second click), or logging out right after a concurrent tab's `/auth/refresh` already rotated the presented cookie out from under it — the CAS `UPDATE` matches zero rows either way (`revoked_at` no longer `NULL`, or the row's already gone). Same idempotent-204 handling as the missing-cookie case, no special-casing needed since the compare-and-swap already collapses "not found" and "already revoked" into one outcome (mirrors `/auth/refresh`'s own rowcount check, just without the "reject with 401" reaction — logout has no reason to punish an already-dead session).
- **Cross-user cookie scoping:** without the `user_id` filter in the revoke `WHERE` clause, a crafted request presenting one user's still-valid access token alongside a *different* user's refresh cookie could revoke the wrong session. Scoping the `UPDATE` to `token_hash = :hash AND user_id = :authenticated_user_id` closes this — the row simply won't match if the cookie belongs to someone else, falling into the same idempotent-204 "nothing to revoke" path rather than a distinct error (no enumeration signal either way).
- **Cookie deletion attributes must match the ones it was set with:** `response.delete_cookie` needs the same `samesite`/`secure` (and default `path="/"`, unset `domain`) as `login`/`refresh`'s `set_cookie` calls, or some browsers won't recognize it as the same cookie and will leave the old one sitting in the jar even though the DB-side row is revoked (harmless — a dead cookie value the server will just 401 on next use — but sloppy and worth getting right the first time).
- **Client-side clear must not depend on network success:** if `POST /auth/logout` fails outright (network error, 500, etc.), `AuthContext.logout()` still clears `tokenStore` and redirects — a user on a shared machine who clicks "Log out" needs the local token gone regardless of whether the server-side revoke round-trip completed. This does mean a failed revoke leaves the server-side refresh token live (a real gap on true network failure, distinct from the 401-retry-recovers-fine case above) — flagged as an accepted trade-off in §4, not silently glossed over.

## 4. Decisions (confirmed by CTO, 2026-09-03)

1. **Response shape/status for `/auth/logout`:** `204 No Content`, no body, no new schema. API design doc §2's route table row gets this noted alongside the route.
2. **Failed-revoke-on-network-failure gap (§3):** accepted trade-off — client always clears local tokens and redirects regardless of whether the `POST /auth/logout` network call succeeds. No retry/warn-user behavior added for this pass.
3. **Logout-UI placement:** build the navbar now — `AppHeader` (CoreUI `CHeader`, per ADR-0012), mounted inside `ProtectedRoute`, not a bare button on `OrgHome`. Scope raised from the original "minimal button" recommendation; see §1/§2 for the resulting file list.
4. **`revoked_reason` value:** confirmed — `"logout"`, a new free-text value in the existing `RefreshToken.revoked_reason` column (no schema/constraint change).

## 5. Status

Confirmed — ready for implementation. No code written yet; awaiting go-ahead to start Task 1.

**2026-09-03 update — backend implementation complete.** `POST /auth/logout` added to `backend/app/api/routes/auth.py` (authenticated via `get_current_actor`, atomic CAS revoke scoped to `token_hash` + `user_id`, `204 No Content`, cookie cleared). New test file `backend/tests/integration/test_auth_logout.py` covers TC-AUTH-009/024/025/026/027 plus the ADR-0014 cross-user-scoping case. Test results against the isolated `testnexa-auth3-test` Docker stack:
- `backend/tests/unit` — 26 passed
- `backend/tests/integration/test_auth_logout.py` — 6 passed
- `backend/tests/integration/test_auth_refresh.py` (regression check) — 10 passed, no regressions

Frontend work (AppHeader, AuthContext.logout(), lib/api/auth.ts, ProtectedRoute, e2e) is out of scope for this backend-only pass; see §2 for the remaining file list.
