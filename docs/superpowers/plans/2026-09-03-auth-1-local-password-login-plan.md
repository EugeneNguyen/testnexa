# AUTH-1: Local Password Login — Scope Plan

**Date:** 2026-09-03 (revised after scaffold merge)
**Status:** Draft — for review, no implementation yet
**Story:** [AUTH-1](../../user-stories/2026-09-03-auth-stories.md#story-auth-1-local-password-login)
**Spec context:** [Project scaffold design](../specs/2026-09-03-project-scaffold-design.md), [ERD](../../product-discovery/07-erd-draft.md), [ADR-0003 auth/token strategy](../../adr/0003-auth-token-strategy.md), [API design §2](../../api/2026-09-03-api-design.md)

## 0. Repo state (revised)

Scaffold branch merged to `main` and merged into this worktree. Models (`Organization`, `OrgMembership`, `Actor`/`User`/`AIAgent`, `AuthIdentity`, `RefreshToken`), Alembic initial migration, `app/core/config.py` (JWT_SECRET/TTLs already defined), Docker Compose, and frontend skeleton all exist. `app/core/security.py` and `app/core/rbac.py` exist as **stub modules — every function raises `NotImplementedError("feature work")`**, explicitly deferred to this task. `main.py` only mounts `/health`. No auth routes, no schemas, no frontend auth code exist yet.

AUTH-1 is now a real vertical slice on top of a working scaffold, not a bootstrap job. §1/§2 below are rewritten accordingly; most of the original §4 open questions are resolved by docs that landed with the scaffold (ADR-0003, API design doc) — resolutions noted inline, only genuinely open items remain in §4.

## 1. Scope

**In scope for AUTH-1:**
- Fill in `hash_password`/`verify_password`/`create_access_token`/`create_refresh_token`/`decode_token`/`hash_refresh_token` in `app/core/security.py` (the `generate/hash/verify_api_key` trio in the same file stays `NotImplementedError` — that's AUTH-4).
- New `POST /api/v1/auth/login` route (path/prefix confirmed by API design doc §1/§2, not `/api/auth/login` as originally guessed): body `{email, password}`; response `{access_token, org_context: "auto"|"picker", orgs: [...]}` (exact contract per API design doc §2); refresh token set as httpOnly cookie, never in the JSON body.
- Org resolution on login: active `OrgMembership` rows for the user → 1 → `org_context: "auto"`; 2+ → `org_context: "picker"`. (Suspended memberships excluded from this list — see §3, now resolved rather than open.)
- Minimal actor/db dependency wiring needed for the login route only (`get_db` session dependency). Full `get_current_actor`/`require_permission` in `app/core/rbac.py` stay stubbed — not needed for login itself, only for `/auth/me`, `/auth/refresh`, `/auth/logout` (AUTH-2/3) and permission-gated routes (RBAC stories).
- `RefreshToken` row is created and persisted at login time (hash only, per `hash_refresh_token`) even though rotation/revocation logic is AUTH-2 — otherwise AUTH-2 has nothing to revoke.
- Frontend: `Login` page (email+password form), `OrgPicker` page, `AuthContext` (access token in memory), `lib/api/auth.ts` login call built on the existing `apiFetch` wrapper (`frontend/src/lib/api/client.ts` — already exists, do not recreate).
- Generic 401 body (API design doc's standard error shape: `{code, message, field_errors: null}`) on bad credentials, timing-safe against user enumeration.

**Explicitly out of scope (belongs to later stories):**
- `/auth/refresh`, `/auth/logout`, `/auth/me` routes — AUTH-2/AUTH-3.
- AIAgent bearer auth, `/orgs/{org_id}/agents*` routes — AUTH-4.
- Self-registration / org-bootstrap flow (`Organization` create) — RBAC-1, per API design doc footnote: "Organization create is only reachable via the signup/bootstrap flow (RBAC-1), not a bare `POST /organizations`." AUTH-1 assumes the user/org/membership rows already exist.
- `require_permission`/RBAC enforcement on other routes — separate RBAC stories.
- SSO/OIDC/SAML/LDAP — explicitly out of scope per scaffold spec; `AuthProvider` enum already has the values, only `provider="local"` gets query logic.

## 2. Affected files

**Backend — new**
- `backend/app/schemas/auth.py` — `LoginRequest`, `LoginResponse`, `OrgSummary` (Pydantic v2)
- `backend/app/api/routes/auth.py` — `POST /auth/login`
- `backend/app/api/deps.py` — `get_db` (doesn't exist yet; check `app/db/session.py` for the session factory to wrap)
- `backend/tests/unit/test_security.py` — hash/verify roundtrip, token encode/decode roundtrip, expiry claim correctness
- `backend/tests/integration/test_auth_login.py` — valid login, invalid login (401 generic, same shape for wrong-password vs no-such-email), single-org auto-select, multi-org picker payload, suspended-membership exclusion, plaintext-not-logged check

**Backend — modify**
- `backend/app/core/security.py` — replace 6 of 9 stub functions (see §1) with real implementations
- `backend/app/main.py` — mount the new auth router (currently only mounts `health`)
- `backend/app/core/rbac.py` — leave stubbed; note in code comment that AUTH-1 doesn't touch it (avoid accidental partial implementation that AUTH-2/RBAC stories then have to reconcile)

**Frontend — new**
- `frontend/src/pages/workflows/Login.tsx` (dir currently has only a placeholder `README.md`)
- `frontend/src/pages/workflows/OrgPicker.tsx`
- `frontend/src/auth/AuthContext.tsx` (dir currently has only a placeholder `README.md`)
- `frontend/src/lib/api/auth.ts` — login call via existing `apiFetch<T>()`

**Frontend — modify**
- `frontend/src/App.tsx` — wire `Login`/`OrgPicker` routes, wrap in `AuthContext` provider

No infra files (`docker-compose.yml`, Dockerfiles, `alembic.ini`, migrations) need to change — the scaffold's initial migration already has all the tables this story needs.

## 3. Edge cases

- **User-enumeration timing leak:** if email not found, must still run an argon2 verify against a dummy hash before returning 401, so response time doesn't distinguish "no such email" from "wrong password."
- **Suspended `OrgMembership` — resolved:** RBAC-tenancy story is explicit: "when they suspend a member, ... all API access for that org is denied until reactivated." So a suspended membership must not appear in the login org list — only `status=active` memberships count toward `org_context: "auto"|"picker"` resolution. `invited` (not yet accepted) also excluded — an invited-but-not-active member has no working access yet either.
- **Zero orgs (only suspended/invited, or none at all):** still genuinely unresolved by any doc — see open question §4.1.
- **Case sensitivity:** email lookup should be case-insensitive (store/compare lowercased) to avoid "works sometimes" bug reports.
- **Multiple `AuthIdentity` rows per user:** schema supports multiple providers; AUTH-1 only implements `provider=local`. Login lookup must filter to `provider=local` explicitly, not just by email, so a future OIDC-only user with no local identity gets the same generic 401, not a 500.
- **Plaintext password never logged:** applies to app logs, error tracebacks, and any request-logging middleware — password field must be excluded/redacted at the middleware level, not just "don't log it" in the route handler.
- **Argon2 parameters:** need explicit memory/time-cost params (not library defaults) so hash cost is a deliberate decision, not accidental.
- **Refresh token storage:** AC for AUTH-1 only requires that login *returns* a refresh token; the DB table and revocation logic are real per scaffold spec ("stored server-side... not purely stateless") — the `RefreshToken` row must be created at login time even though rotation/revocation logic lands in AUTH-2, otherwise AUTH-2 has nothing to revoke.
- **Brute-force / credential stuffing:** AC doesn't mention rate limiting or lockout, but a login endpoint without either is a real gap — flagged as open question, not silently added or silently skipped.

## 4. Open questions (remaining — most of the original 7 are resolved by scaffold-era docs)

1. **Zero eligible orgs at login** (no `active` `OrgMembership` row at all, or only `suspended`/`invited` ones): AC only covers the 1-org and 2+-org cases. Needs a decision — reject login outright with a distinct message (e.g. "no active organization"), or let the token issue with an empty `orgs: []` and let the frontend show a dead-end state? Leaning toward rejecting at login (403/409, not the generic 401 — this isn't a credentials problem) but that's a product call, not mine to default silently.
2. **Rate limiting / lockout policy** — not in the AC, not in ADR-0003, not in the API design doc's NFR list. A login endpoint shipping with neither is a real gap. Confirm whether it's explicitly deferred to a later story or should be folded into AUTH-1's definition of done.
3. **Dev/test provisioning path** — confirmed no seed data beyond system roles/taxonomy (scaffold plan explicitly: "No demo Org/Project/sample records"), and real user creation is RBAC-1's signup/bootstrap flow, not AUTH-1. Backend integration tests will create `User`/`Organization`/`OrgMembership`/`AuthIdentity` rows directly via fixtures, bypassing the API — confirming that's acceptable rather than expecting AUTH-1 to also stand up a provisioning path.

**Resolved by scaffold-era docs (no longer open):**
- Username vs. email → email-only; `User.email` is the unique login key, no `username` field exists on the model.
- "Default org/project" vs. "org picker" → API design doc's login response contract (`org_context: "auto"|"picker"`) only resolves org, never project — project selection is a separate downstream concern, out of scope for the login endpoint itself.
- Token TTLs / signing key source → `Settings.JWT_ACCESS_TTL_MINUTES=15`, `JWT_REFRESH_TTL_DAYS=30`, `JWT_SECRET` env var already defined in `app/core/config.py`.
- Scope-bootstrap ordering → moot, scaffold merged separately; AUTH-1 is now a slice on top of it.

## 5. Not decided by this document

No code, migrations, or config are created by this plan. Ready to implement pending answers to §4.1/§4.2 (§4.3 has a reasonable default — flag, don't block on it).
