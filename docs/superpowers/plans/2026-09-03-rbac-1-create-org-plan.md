# RBAC-1: Create an Organization — Plan

**Date:** 2026-09-03
**Story:** [RBAC-1](../../user-stories/2026-09-03-rbac-tenancy-stories.md#story-rbac-1-create-an-organization)
**Related:** ADR-0003 (auth), ADR-0004 (RBAC design), ADR-0007 (tenancy), ADR-0015 (404-vs-403 boundary precedent), [Database Doc §3.1/§3.3](../../database/2026-09-03-database-design.md)

## Decisions (confirmed with user)

- **Q3:** The creator of a second org auto-joins it (`OrgMembership(active)` + `org_admin` `RoleAssignment`) — otherwise nobody could administer a freshly created org (RBAC-2 invite flow doesn't exist yet).
- **Q4:** `POST /auth/signup` is bootstrap-only — it works while zero `Organization` rows exist deployment-wide, then closes. All further org creation goes through the authenticated route below.
- **Q5:** `slug` is user-supplied on both routes (`^[a-z0-9-]+$`), not server-auto-generated from `name`.

## What already exists (post RBAC-4 / AUTH-4 merge — do not rebuild)

- `Organization`/`OrgMembership`/`Role`/`Permission`/`RolePermission`/`RoleAssignment` models + tables, fully migrated.
- 5 seeded system `Role`s (`org_admin`, `test_manager`, `tester`, `auditor`, `ai_agent_scoped`; `org_id=NULL`, `is_system_role=true`) + full `Permission` catalog incl. `organization.create/.read/.update/.delete`, and `org_admin`'s bundle = every permission.
- `get_current_actor` resolves both `User` (JWT) and `AIAgent` (API key).
- `has_permission(actor_id, org_id, code, project_id=None)` / `require_permission(code)` — real implementation (`RoleAssignment→Role→RolePermission→Permission`), org-scoped via `request.path_params["org_id"]`.
- Established route pattern (`app/api/routes/agents.py`): human-only gate (if applicable) → 404-vs-403 boundary (any-status `OrgMembership` check) → `require_permission(code)` invoked directly in the route body (not `Depends`, so 404 always wins ahead of 403) → business logic.
- `auth.py`'s login token-issuance/cookie code (`create_access_token`, `create_refresh_token`, `hash_refresh_token`, cookie params) — reused as-is by signup.

## Gap this story fills

`require_permission` assumes an `org_id` already in the path. `POST /orgs` (create a *second* org) has no target `org_id` yet — the org doesn't exist until the call succeeds. Needs a bespoke check: "does this actor hold `organization.create` in *any* org they belong to" — not the existing path-scoped dependency as-is.

## Scope

### Backend

1. **`app/core/rbac.py`** — add `has_permission_in_any_org(actor_id: str, code: str) -> bool`: same join chain as `has_permission` but no `org_id`/`project_id` filter — used only by the create-second-org gate below. `has_permission`/`require_permission` themselves untouched.
2. **`app/schemas/organizations.py`** (new) — `CreateOrgRequest {name, slug}`, `OrgSummary` reused from `app/schemas/auth.py` (import, don't duplicate) for the response.
3. **`app/schemas/auth.py`** — add `SignupRequest {name, email, password, org_name, org_slug}`. `SignupResponse` = same shape as `LoginResponse` (reuse the class directly — signup ends in a login-equivalent state).
4. **`app/api/routes/auth.py`** — add `POST /auth/signup`:
   - Bootstrap gate: `SELECT EXISTS(SELECT 1 FROM organization)` — if true, `409 signup_closed` ("Self-registration is closed. Contact your administrator for an invite.").
   - Concurrency: two simultaneous first-signups both observing zero orgs must not both succeed. Wrap the exists-check + inserts in one transaction guarded by `pg_advisory_xact_lock(<fixed key>)` acquired before the exists-check — serializes concurrent bootstrap attempts without locking the (not-yet-existing) `organization` table itself.
   - Hash password (`hash_password`, same as login). Create `User`, `Organization(name=org_name, slug=org_slug)`, `OrgMembership(status=active)`, `RoleAssignment(role=<seeded org_admin Role>, org_id=<new org>, project_id=NULL)`.
   - `slug` collision → catch `IntegrityError` on the unique constraint → `422` (matches **TC-RBAC-003**'s documented expectation — NOT 409; 409 is reserved for the bootstrap-closed case above).
   - Issue tokens + set refresh cookie exactly like `login()`; return `LoginResponse`-shaped body (`org_context: "auto"`, `orgs: [new org]`).
5. **`app/api/routes/organizations.py`** (new) — `POST /orgs`, authenticated (`get_current_actor`, `User` or `AIAgent` — no human-only gate; AC doesn't restrict this to humans and `RoleAssignment.actor_id` already supports either):
   - Gate: `has_permission_in_any_org(actor.actor_id, "organization.create")` — `403 permission_denied` if false. (No 404-vs-403 boundary here — there's no target org yet to hide the existence of.)
   - Create `Organization`, creator's own `OrgMembership(active)` + `org_admin` `RoleAssignment` in it (Q3).
   - `slug` collision → `422`, same as signup.
   - Response: `OrgSummary`.
6. **`app/main.py`** — register `organizations.router`.

### Frontend

- `frontend/src/pages/workflows/Signup.tsx` — CoreUI + React Hook Form + Zod, mirrors `Login.tsx`'s structure exactly (form → `lib/api/auth.ts` call → `AuthContext` update → redirect to `/orgs/:orgId` or `/orgs/pick` per `org_context`).
- `frontend/src/lib/api/auth.ts` — add `signup(payload)`.
- `frontend/src/lib/api/organizations.ts` (new) — `createOrg(payload)`.
- `OrgPicker.tsx` — add a "New Organization" action (small CoreUI modal/form) calling `createOrg`, for the already-authenticated-org_admin path (AC2). Reuses `OrgSummary` shape already in that screen.
- `App.tsx` — add `<Route path="/signup" element={<Signup />} />` (public, same tier as `/login`).
- `Login.tsx` — add a "Sign up" link to `/signup` (small, not a redesign).

### Tests

- **Backend unit:** `SignupRequest`/`CreateOrgRequest` schema validation (slug pattern), `has_permission_in_any_org` happy/empty-path.
- **Backend integration:**
  - `test_auth_signup.py` — TC-RBAC-001 (fresh instance → org + org_admin), signup-closed-after-bootstrap (409), slug collision (422), concurrent-bootstrap race (two parallel signups, exactly one org created — best-effort, may skip under CI flakiness constraints).
  - `test_organizations.py` — TC-RBAC-003 (slug uniqueness, 422), AC2 happy path (existing org_admin creates 2nd org, gets membership+role in it), 403 for an actor holding no `organization.create` anywhere, 401 unauthenticated.
- **E2E:** `e2e/tests/auth-signup.spec.ts` (bootstrap flow), `e2e/tests/org-create-second.spec.ts` (AC2 flow via UI).
- **TC-RBAC-002 (cross-org data isolation on Project/Requirement/TestCase)** — **not achievable in this story**: no CRUD routes exist for those resources yet (router factory is design-doc-only, per earlier investigation). Documented as a known gap, same posture RBAC-4's plan took for TC-TRACE-004 — owned by whichever story adds the first tenant-scoped CRUD route, which must reuse the `agents.py`/RBAC-1 404-vs-403 pattern already established.

### Docs to update (propagation, per CLAUDE.md's ADR-0011 precedent)

- `docs/api/2026-09-03-api-design.md` — add `POST /auth/signup` and `POST /orgs` contracts (§2/§3), replacing the current footnote-only mention.
- `docs/database/2026-09-03-database-design.md` — no schema change (all tables/seed data pre-exist from RBAC-4); skip unless review finds a gap.
- `docs/test-cases/2026-09-03-test-cases.md` — mark TC-RBAC-001/003 covered; note TC-RBAC-002 deferred with rationale (as above).

## Edge cases

- Concurrent double-first-signup (advisory lock, above).
- `slug` collision on either route → 422, not 409 (409 reserved for signup-closed).
- Actor with an `organization.create`-holding `RoleAssignment` that's project-scoped only (`project_id` non-null) — `has_permission_in_any_org` should NOT count project-scoped grants toward "can create an org" (org creation is inherently org-wide, not project-scoped); filter `project_id IS NULL` in that query, same as `has_permission`'s own default.
- `AIAgent` calling `POST /orgs`: no story text forbids it, and `ai_agent_scoped`'s seeded bundle doesn't include `organization.create` anyway — so in practice only ever succeeds for an actor holding `org_admin`'s full bundle, human or agent. Not adding a hardcoded human-only gate here since AC doesn't ask for one (unlike RBAC-5's Approval rule).
- Password/email validation on signup reuses whatever `LoginRequest`/`hash_password` already enforce — no new password-strength policy invented here.

## Out of scope

- RBAC-2 (invite/suspend members), RBAC-3 (project-scoped role assignment UI/API beyond what already exists), RBAC-5 (already done).
- Generic CRUD router factory / first tenant-scoped resource (Project etc.) — TC-RBAC-002 blocked on this, noted above.
- Rate-limiting `POST /auth/signup` (AC doesn't ask for it; ADR-0011 only covers login).
