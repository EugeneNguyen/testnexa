# AUTH-2: Implementation Plan

**Date:** 2026-09-03
**Status:** Executing
**Spec:** [AUTH-2 scope plan](2026-09-03-auth-2-session-persistence-plan.md), [ADR-0013](../../adr/0013-refresh-token-rotation-policy.md), [API Document §2](../../api/2026-09-03-api-design.md), [Database Document §3.2](../../database/2026-09-03-database-design.md), [Test Cases TC-AUTH-006..008, 018..023](../../test-cases/2026-09-03-test-cases.md)
**Worktree:** `.claude/worktrees/auth-2-session-persistence` (branch `worktree-auth-2-session-persistence`)

## Global constraints (binding on every task)

- Never touch the main `testnexa` compose project (port 54593) or its DB. All backend/E2E test execution happens against the isolated test env from Task 0.
- Refresh token rotation is single-use: every successful `POST /auth/refresh` revokes the presented token (`revoked_reason="rotated"`) and issues a new one.
- Rotated token's `expires_at` = copied from the token it replaces, never `now + JWT_REFRESH_TTL_DAYS`.
- `POST /auth/refresh` re-checks active `OrgMembership`; 0 active → `403 no_active_organization`, refresh token itself NOT revoked by this rejection.
- `POST /auth/refresh` request: no body, reads `refresh_token` httpOnly cookie only. Response: `{access_token}`. All rejection causes (missing/expired/revoked/rotated-out cookie) → `401 {"code": "invalid_refresh_token", ...}`, single generic code.
- `GET /auth/me`: bearer access token required. Response: `{actor_id, email, actor_type}`. No permission codes yet.
- `get_current_actor`: decode+verify JWT (catch `jwt.PyJWTError` broadly, not just expiry), look up `User` by `sub`, 401 if actor missing. `require_permission`/`has_permission` stay `NotImplementedError` — do not touch.
- `RefreshToken.token_hash` needs a unique index (new migration) — AUTH-1 never indexed it since nothing looked it up by value.
- Frontend: access token lives in a module-level store (`lib/auth/tokenStore.ts`), not React state directly — `apiFetch` (a plain function, no hooks) must be able to read/write it.
- `apiFetch` 401 handling applies only to *authenticated* calls (i.e. not to `/auth/login` or `/auth/refresh` itself — no recursive refresh-of-refresh).
- Concurrent 401s share one in-flight `/auth/refresh` call (promise memoization), not one call each.
- No code changes to `backend/app/core/security.py` — every function AUTH-2 needs already exists from AUTH-1.
- No Tailwind. CoreUI components only for any new UI surface (`ProtectedRoute` has no visible UI, but any loading state uses CoreUI, e.g. `CSpinner`).
- TDD: tests are written as part of each task, not after — this repo's existing convention (see AUTH-1 commits).

## Task 0 — Isolated test environment

**Not a code task — infra setup, executed once, blocks Tasks 2 (backend integration tests) and 5 (E2E).**

- New Compose project name: `testnexa-auth2` (via `-p testnexa-auth2` / `COMPOSE_PROJECT_NAME`), so volumes/networks/container names never collide with the main `testnexa` project.
- New host port for `nginx-dev`: **37012** (randomly chosen, confirmed free via `lsof`). Bind as `"37012:80"` (no `127.0.0.1` prefix) so Docker publishes on all interfaces — reachable via `localhost:37012` and the host's LAN IP `:37012`.
- Create `docker-compose.override.test.yml` at repo root (git-ignored — this is scratch, not a committed artifact):
  ```yaml
  services:
    nginx-dev:
      ports: !override
        - "37012:80"
  ```
- DB clone from main: `docker compose -p testnexa exec -T postgres pg_dump -U testnexa -d testnexa --no-owner --no-privileges` → dump file → after the isolated `postgres` container is up (empty, healthy), `docker compose -p testnexa-auth2 exec -T postgres psql -U testnexa -d testnexa` < dump file. Read-only against main (a dump is a read), never writes to the main container.
- Bring up: `docker compose -p testnexa-auth2 -f docker-compose.yml -f docker-compose.override.test.yml --profile dev up -d --build`.
- Verify: `curl http://localhost:37012/api/health` → `{"status":"ok"}`; repeat against the host's LAN IP.
- Report back: project name, port, confirmation both localhost and LAN IP respond, and that the DB contains main's current schema/rows (spot-check row counts against main).

## Task 1 — Backend foundation: index + get_current_actor

**Files:** new Alembic migration; `backend/app/core/rbac.py` (implement `get_current_actor` only); `backend/app/api/deps.py` (re-export).

- Alembic migration adding a unique index on `refresh_token.token_hash`.
- `get_current_actor(token)`: decode via `app.core.security.decode_token`, catch `jwt.PyJWTError` → raise the route-level 401 shape (match AUTH-1's `_error()` helper pattern — check `backend/app/api/routes/auth.py` for the exact shape/import), look up `User` by `sub` (actor id), 401 if not found. Do not implement `require_permission`/`has_permission` — leave `NotImplementedError`.
- `deps.py`: add `get_current_actor` re-export mirroring the existing `get_db` pattern.
- Unit tests (`backend/tests/unit/`): valid token → resolves actor; expired token → raises; tampered signature → raises; well-formed token with a `sub` that doesn't resolve to any `User` → raises. Use a DB fixture/mock appropriate to this repo's existing unit-test conventions (check `backend/tests/unit/test_security.py` for the pattern — no live DB in unit tests, per `CLAUDE.md`).

## Task 2 — Backend: `POST /auth/refresh` + `GET /auth/me`

**Depends on:** Task 1 (needs `get_current_actor`, needs the new index in place before writing lookup-heavy tests).
**Files:** `backend/app/schemas/auth.py` (add `RefreshResponse`, `MeResponse`); `backend/app/api/routes/auth.py` (add both routes); `backend/app/main.py` (routes auto-included via existing router, verify no change needed); `backend/tests/integration/test_auth_refresh.py` (new).

- `POST /api/v1/auth/refresh`: read cookie → hash → look up `RefreshToken` → reject 401 (missing/not-found/revoked/expired) → re-check active `OrgMembership` (403 if zero, don't revoke) → rotate (revoke old row `reason="rotated"`, insert new row with `expires_at` copied from old) → issue new access token → set new cookie → `{access_token}`.
- `GET /api/v1/auth/me`: `Depends(get_current_actor)` → `{actor_id, email, actor_type}`.
- Integration tests, one function per case, covering **TC-AUTH-006, 007, 008, 018, 019, 020, 021, 022, 023** (see [Test Cases doc](../../test-cases/2026-09-03-test-cases.md) for each case's exact preconditions/expected result — use it as the source of truth for assertions, don't re-derive from memory). Follow this repo's existing integration-test fixture pattern (direct DB row creation via `AsyncSessionLocal`, bypassing the API, same as AUTH-1's `test_auth_login.py`).

## Task 3 — Frontend: token store + `apiFetch` interceptor

**Depends on:** Task 2 (needs the real endpoint contract to integrate against; can be developed against a mocked `fetch` for the unit tests without the live env, but final verification needs Task 0's env).
**Files:** new `frontend/src/lib/auth/tokenStore.ts`; modify `frontend/src/lib/api/client.ts`; extend `frontend/src/lib/api/auth.ts` (add `refresh()`, `me()` calls).

- `tokenStore.ts`: `getAccessToken()`, `setAccessToken(token)`, `clearAccessToken()`, `subscribe(callback)` — plain module state, no React dependency.
- `apiFetch`: attach `Authorization: Bearer <token>` from the store when present. On 401 from an authenticated call (i.e. not `/auth/login`, not `/auth/refresh` itself — add an `opts.skipAuthRefresh` flag or equivalent, your call on the exact mechanism as long as it prevents recursion): call `refresh()` once (dedup concurrent callers via a shared in-flight promise), on success update the store and retry the original request once, on failure clear the store and `window.location.assign("/login")`.
- Unit tests (Vitest + mocked `fetch`): store get/set/subscribe; 401→refresh→retry-success path; 401→refresh→retry-still-401 path (clears store, would redirect — assert the store-clear and the redirect call, mock `window.location.assign`); concurrent-401 dedup (two calls in flight, assert `fetch` for `/auth/refresh` was invoked exactly once).

## Task 4 — Frontend: boot-time silent refresh + route guard

**Depends on:** Task 3.
**Files:** modify `frontend/src/auth/AuthContext.tsx`; new `frontend/src/auth/ProtectedRoute.tsx`; modify `frontend/src/App.tsx`.

- `AuthContext`: on mount, call `refresh()` once (bypassing any UI trigger) to attempt restoring a session from the httpOnly cookie; track `isInitializing` while it's in flight; on success populate token store + org context state (note: `/auth/refresh`'s response doesn't include `org_context`/`orgs` — if boot-refresh succeeds but org context is needed for routing, call `GET /auth/me` afterward for identity, and accept that a full page reload loses the org-picker distinction until the user's next explicit action; document this as a known simplification in the component's docstring, don't silently paper over it).
- `ProtectedRoute`: while `isInitializing`, render a loading state (`CSpinner`, per CoreUI convention); once settled, render children if a token is present, else redirect to `/login`.
- Wrap `/orgs/*` routes in `ProtectedRoute` in `App.tsx`.
- Unit tests (Vitest + RTL): `ProtectedRoute` renders loading during init, renders children when authenticated post-init, redirects when not.

## Task 5 — E2E tests

**Depends on:** Tasks 2, 3, 4 all merged; Task 0's env running.
**Files:** new `e2e/tests/auth-refresh.spec.ts`.

- Real-browser: log in, reload the page, assert the session survives (no redirect to `/login`, protected content still visible) — this is the actual proof of AC1 ("survive a browser restart").
- Real-browser: log in, revoke the session's refresh token directly via a DB-level test hook (match whatever mechanism `e2e/tests/auth-login.spec.ts` already uses for DB setup, if any — otherwise via a direct DB connection from the test), trigger a request that needs refresh (or call `/auth/refresh` directly), assert redirect to `/login`.
- Run against Task 0's isolated env (`E2E_BASE_URL=http://localhost:37012`), never the main stack.

## Task 6 — Full verification pass

**Not an implementer task — a verification pass, run directly, after Tasks 1-5 are all reviewed clean.**

- Run backend unit + integration suites against Task 0's env (`TEST_API_BASE_URL` pointed at it).
- Run frontend unit suite.
- Run the new E2E spec against Task 0's env.
- Confirm every TC-AUTH-006/007/008/018-023 has a passing automated test (per `CLAUDE.md`'s "100% means every TC for that story's own scope" rule).
- Report pass/fail counts verbatim, not a summary claim without evidence.
