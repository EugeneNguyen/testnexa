# AUTH-1: Local Password Login — Scope Plan

**Date:** 2026-09-03
**Status:** Draft — for review, no implementation yet
**Story:** [AUTH-1](../../user-stories/2026-09-03-auth-stories.md#story-auth-1-local-password-login)
**Spec context:** [Project scaffold design](../specs/2026-09-03-project-scaffold-design.md), [ERD](../../product-discovery/07-erd-draft.md)

## 0. Repo state

Repo is docs-only today — no `app/`, no `src/`, no `docker-compose.yml`, no migrations. AUTH-1 is the first code ticket. It cannot be built as a pure "auth slice" on top of nothing; it requires a minimum viable slice of the scaffold (DB, models, FastAPI app skeleton, frontend skeleton) to exist first. That bootstrap cost is called out explicitly below rather than hidden inside "affected files."

## 1. Scope

**In scope for AUTH-1:**
- Backend: `POST /api/auth/login` — validate email+password against argon2 hash, issue access token (JWT) + refresh token (DB-backed, per scaffold spec — full issuance mechanics belong to AUTH-2, but the row gets created here), return org membership info.
- Org resolution on login: 1 org → auto-selected; 2+ orgs → return org list, no auto-select, client shows picker.
- Password hashing: argon2 via passlib, at signup/seed time (no self-registration flow in this story — see open questions).
- Generic 401 on bad credentials, constant-shape response regardless of whether the email exists.
- Frontend: `Login` page (email+password form), post-login redirect logic (single org → org/project view; multi-org → `OrgPicker`).
- Minimum scaffold bootstrap needed to support the above: FastAPI app skeleton, Postgres + SQLAlchemy + Alembic wiring, the tenancy/actor/auth model subset, Vite+React app skeleton, Docker Compose (`postgres`, `backend`, `frontend`) per the scaffold spec's stack decisions.

**Explicitly out of scope (belongs to later stories, called out so nobody assumes AUTH-1 covers them):**
- Refresh-token rotation/silent-refresh flow, revocation semantics — AUTH-2.
- Logout endpoint — AUTH-3.
- AIAgent bearer auth — AUTH-4.
- Self-registration / invite flow — no story yet covers how a `User` + `AuthIdentity(provider=local)` row is created. AUTH-1 assumes users already exist (seeded or admin-provisioned).
- RBAC permission checks beyond "is authenticated" — separate RBAC stories.
- SSO/OIDC/SAML/LDAP — explicitly out of scope per scaffold spec.
- Full CRUD scaffold for the other 20+ ERD entities — only the tables auth touches.

## 2. Affected files (new — greenfield)

**Backend**
- `backend/app/main.py` — FastAPI app, router mount
- `backend/app/core/config.py` — env settings (DB URL, JWT secret/alg, access/refresh TTLs)
- `backend/app/core/security.py` — argon2 hash/verify (passlib), JWT encode/decode
- `backend/app/db/base.py`, `backend/app/db/session.py` — SQLAlchemy engine/session
- `backend/app/models/tenancy.py` — `Organization`, `OrgMembership`
- `backend/app/models/actor.py` — `Actor`, `User` (joined-table inheritance; `AIAgent` deferred to AUTH-4 but table shape should not block it)
- `backend/app/models/auth.py` — `AuthIdentity`, `RefreshToken`
- `backend/app/schemas/auth.py` — `LoginRequest`, `TokenResponse`, `OrgSummary`
- `backend/app/api/deps.py` — `get_db`
- `backend/app/api/routes/auth.py` — `POST /api/auth/login`
- `backend/alembic/env.py`, `backend/alembic/versions/0001_initial.py` — tables above
- `backend/tests/unit/test_security.py` — hash/verify roundtrip, hash format
- `backend/tests/api/test_auth_login.py` — valid login, invalid login (401 generic), single-org auto-select, multi-org picker payload, plaintext-not-logged check

**Frontend**
- `frontend/src/pages/workflows/Login.tsx`
- `frontend/src/pages/workflows/OrgPicker.tsx`
- `frontend/src/auth/AuthContext.tsx` — access token in memory, refresh token via httpOnly cookie (cookie is set by backend `Set-Cookie`, not read/written by JS)
- `frontend/src/lib/api/auth.ts` — typed login call
- `frontend/src/lib/api/client.ts` — base fetch/axios wrapper (attaches bearer token)

**Infra**
- `docker-compose.yml` — `postgres`, `backend`, `frontend` (dev profile), per scaffold spec
- `backend/Dockerfile`, `frontend/Dockerfile`
- `backend/pyproject.toml` (or `requirements.txt`), `backend/alembic.ini`
- `frontend/package.json`, `vite.config.ts`, `tailwind.config.js`

This is a wide file list for a "login" ticket only because nothing exists yet — it's the bootstrap tax, paid once.

## 3. Edge cases

- **User-enumeration timing leak:** if email not found, must still run an argon2 verify against a dummy hash before returning 401, so response time doesn't distinguish "no such email" from "wrong password."
- **Suspended `OrgMembership`:** ERD has `status: invited/active/suspended`. AC doesn't mention this — decide whether a suspended membership counts toward org selection/login at all (leaning: exclude suspended orgs from the org list; if that leaves zero orgs, still need a defined response — see open questions).
- **Zero orgs:** a `User` with no `OrgMembership` rows at all — AC only covers 1-org and 2+-org cases. Needs an explicit behavior (block login with a clear error vs. let them in with no org context).
- **Case sensitivity:** email lookup should be case-insensitive (store/compare lowercased) to avoid "works sometimes" bug reports.
- **Multiple `AuthIdentity` rows per user:** schema supports multiple providers; AUTH-1 only implements `provider=local`. Login lookup must filter to `provider=local` explicitly, not just by email, so a future OIDC-only user with no local identity gets the same generic 401, not a 500.
- **Plaintext password never logged:** applies to app logs, error tracebacks, and any request-logging middleware — password field must be excluded/redacted at the middleware level, not just "don't log it" in the route handler.
- **Argon2 parameters:** need explicit memory/time-cost params (not library defaults) so hash cost is a deliberate decision, not accidental.
- **Refresh token storage:** AC for AUTH-1 only requires that login *returns* a refresh token; the DB table and revocation logic are real per scaffold spec ("stored server-side... not purely stateless") — the `RefreshToken` row must be created at login time even though rotation/revocation logic lands in AUTH-2, otherwise AUTH-2 has nothing to revoke.
- **Brute-force / credential stuffing:** AC doesn't mention rate limiting or lockout, but a login endpoint without either is a real gap — flagged as open question, not silently added or silently skipped.

## 4. Open questions

1. **Username vs. email:** story title says "username/email," AC text says "email and password," and the ERD `USER` entity has only `email`, no `username` field. Confirm login is email-only, or add a username field/uniqueness constraint.
2. **"Default org/project" vs. "org picker" — conflicting AC lines:** bullet 1 says single-org-or-not users land on a "default org/project view"; bullet 3 says multi-org users land on an "org picker" (no project mentioned). Does org auto-selection also auto-select a default project, or does project selection happen in a separate step after org selection? Affects whether `Project` needs a "default" concept for AUTH-1 or whether login only resolves org and project selection is out of scope here.
3. **User provisioning:** AC assumes "a registered user with valid credentials" exists. No story yet defines how that user/org/membership gets created (self-registration, admin invite, seed script). AUTH-1 needs *some* seed mechanism to be testable end-to-end — is that a migration seed, a fixture, or a real (even if minimal) admin-provisioning endpoint pulled forward from a later story?
4. **Suspended/zero-org behavior** (see edge cases) — needs a product decision, not just an engineering default.
5. **Rate limiting / lockout policy** — not in AC. Confirm whether it's explicitly deferred (and to which story) or should be folded into AUTH-1 given it's a login endpoint.
6. **Token TTLs and JWT signing key source** — not specified anywhere in the story or scaffold spec. Needs values (e.g., access 15m / refresh 30d) and a decision on where the signing secret comes from (env var, generated + persisted at first boot) before `config.py` can be written.
7. **Scope-bootstrap ordering:** should the scaffold bootstrap (Docker Compose, DB wiring, base FastAPI/Vite skeletons) be its own preceding ticket, or does AUTH-1 absorb it as shown in §2? Affects estimate and review-ability — a reviewer diffing "login" against a PR that also stands up Alembic/Docker/Vite is a much bigger review surface.

## 5. Not decided by this document

No code, migrations, or config are created by this plan. Next step on approval: either split out a scaffold-bootstrap ticket, or proceed with the full file list in §2 as one AUTH-1 PR — pending answers to §4.
