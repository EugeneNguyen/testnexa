# API Document — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [Database Document](../database/2026-09-03-database-design.md), [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md) (refresh rotation policy), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md) (AI agent credential mechanics), [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md) (organization bootstrap & creation flow), [ADR-0017](../adr/0017-project-creation-flow.md) (project creation flow), [ADR-0021](../adr/0021-role-assignment-creation-flow.md) (role assignment creation flow)

REST over HTTPS, JSON bodies, base path `/api/v1`. FastAPI auto-generates the OpenAPI schema from the implementation — this document is the design-level contract new routes must match, not a substitute for the generated spec once code exists.

**SHELL-1** ([ADR-0018](../adr/0018-admin-shell-sidebar-layout.md), FR-SHELL-1) — reviewed, no API impact. The admin shell (sidebar + navbar) is frontend-only: no new route, no changed request/response shape. Noted here explicitly so the gap isn't mistaken for an oversight.

**SHELL-2/3/4** ([ADR-0019](../adr/0019-admin-shell-full-template-parity.md), FR-SHELL-2/3/4) — reviewed, no API impact. Breadcrumb/footer/dark-mode-toggle are frontend-only. Dashboard stat widgets (FR-SHELL-3) reuse §3's existing generic-CRUD list routes' `total` field (`GET /projects?page=1&page_size=1`, `GET /org-memberships?org_id=<id>&status=active&page=1&page_size=1`) — no new route, no new query param. The template's trend-chart widget is deferred (no real time-series source yet, ADR-0019) — not stubbed with a placeholder route.

---

## 1. Conventions

- **Base path:** `/api/v1`.
- **Auth header:** `Authorization: Bearer <access_token>` on every route except `POST /auth/login` and `POST /auth/refresh`.
- **Pagination:** offset-based, `?page=1&page_size=25` (default/max page_size = 25 per NFR-6). List responses shape: `{items: [...], total: int, page: int, page_size: int}`.
- **Filtering:** exact-match query params on indexed/enum/FK fields only for v1 (e.g. `?status=draft&project_id=<uuid>`), no free-text `contains` operator in this scaffold.
- **Sorting:** `?sort=<field>&order=asc|desc` on the routes that document it explicitly (first instance: `GET /projects/{project_id}/releases`, `target_date` — [ADR-0019](../adr/0019-release-creation-flow.md)); not a blanket convention across every list route in this scaffold. `NULL` field values sort last regardless of `order` — pinned explicitly, not left to the underlying query engine's per-direction default.
- **Error shape** (NFR-8), on every non-2xx response:
  ```
  {"code": "string", "message": "human-readable string", "field_errors": {"field_name": ["msg"]} | null}
  ```
- **Status codes:** `401` = unauthenticated (missing/expired/invalid token, or bad login credentials); `403` = authenticated-or-would-be-authenticated but permission-denied or blocked for a non-credentials reason (includes `POST /auth/login` with valid credentials but zero active org memberships — see §2); `404` = not found **or** cross-tenant (NFR-1 — never distinguishes the two); `422` = validation error (`field_errors` populated); `429` = rate-limited (currently only `POST /auth/login`'s throttle, ADR-0011/NFR-11).
- **404-vs-403 on org-scoped routes** (NFR-19, [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)): the caller having zero `OrgMembership` in the path's `org_id` (including a nonexistent `org_id`) is a 404, same NFR-1 existence-hiding rule as a resource fetch; membership present but the route's `require_permission` check fails is a 403. First established for `/orgs/{org_id}/agents*` (§2), applies to every org-scoped route after it.
- **Permission codes:** `<resource>.<action>`. Resource = snake_case entity name. Default actions `create/read/update/delete` for writable entities; `read`-only for `TestLog` and the 4 traceability link tables (system-appended, no direct write API). Special verbs beyond CRUD: `test_plan.approve`, `requirement.export_rtm`. The full code list (~100 codes across 29 resources, plus AUTH-4's own `ai_agent.create`/`.update` pair seeded ahead of RBAC-4) is seeded by Alembic data migrations against explicit, hand-authored resource lists — not generated from the model registry at app startup (that mechanical-generation idea is deferred; ADMIN-2 extends this same seeded catalog for any entity added later rather than regenerating it). See [Database Document](../database/2026-09-03-database-design.md) §3.3 for the full resource list and the per-role bundle table.

## 2. Auth routes (bespoke)

| Method | Path | Permission | Maps to |
|---|---|---|---|
| POST | `/auth/login` | none (public) | FR-AUTH-1 |
| POST | `/auth/refresh` | none (valid refresh cookie required) | FR-AUTH-2 |
| POST | `/auth/logout` | authenticated | FR-AUTH-3 |
| GET | `/auth/me` | authenticated | returns current Actor identity; drives frontend route guards |
| POST | `/auth/signup` | none (public, bootstrap-only) | FR-RBAC-1 — creates the deployment's first Organization + org_admin User |
| POST | `/orgs` | `organization.create` in any org (any-org gate, not path-scoped) | FR-RBAC-1 — existing org_admin creates a further Organization |
| POST | `/orgs/{org_id}/agents` | `ai_agent.create` (org_admin only) | FR-AUTH-4 — issues AIAgent + one-time API key |
| POST | `/orgs/{org_id}/agents/{agent_id}/revoke` | `ai_agent.update` | FR-AUTH-4 |
| POST | `/orgs/{org_id}/projects` | `project.create` | FR-PROJ-1 — creates Project, auto-assigns creator a project-scoped `test_manager` `RoleAssignment` |
| GET | `/projects/{id}` | `project.read` | FR-PROJ-1 — 404 if cross-tenant, org resolved from the row; recognizes an org-wide **or** a project-scoped grant on this row's `project_id` (RBAC-3 fix, [ADR-0021](../adr/0021-role-assignment-creation-flow.md)) |
| PATCH | `/projects/{id}` | `project.update` | FR-PROJ-1 — partial update (`name`, `standards_profile`); same org-wide-or-project-scoped recognition as `GET` above |
| POST | `/projects/{project_id}/releases` | `release.create` | FR-PROJ-2 — creates Release scoped to `project_id` |
| GET | `/projects/{project_id}/releases` | `release.read` | FR-PROJ-2 — paginated, sortable by `target_date` (`NULLS LAST` pinned) |
| GET | `/releases/{id}` | `release.read` | FR-PROJ-2 — 404 if cross-tenant, org resolved from the row via its Project |
| GET | `/releases/{id}/test-cycles` | `release.read` AND `test_cycle.read` AND `test_execution.read` | FR-PROJ-2 — every TestCycle targeting the release, each with its TestExecutions nested |
| POST | `/orgs/{org_id}/role-assignments` | `role_assignment.create` | FR-RBAC-3 — grants a Role, org-wide (`project_id` omitted) or scoped to one `project_id` |
| GET | `/orgs/{org_id}/role-assignments` | `role_assignment.read` | FR-RBAC-3 — lists every grant (org-wide and project-scoped) in `org_id` |
| GET | `/orgs/{org_id}/roles` | `role.read` | FR-RBAC-3 — UI slice: lists the 5 system roles + this org's custom roles, for the role-assignment form's dropdown |

`POST /auth/login` request: `{email, password}`. Response: `{access_token, org_context: "auto" | "picker", orgs: [...] }` per AUTH-1's single-org-vs-multi-org branch; refresh token is set as an httpOnly cookie, never in the JSON body.

`org_context`/`orgs` are resolved from `OrgMembership` rows with `status = active` only — `suspended` and `invited` memberships never count toward org selection (RBAC-2: a suspended member has no working API access regardless of role, and an invited-not-yet-accepted member has none yet either). Resolution:
- 1 active membership → `org_context: "auto"`, `orgs` has that one entry.
- 2+ active memberships → `org_context: "picker"`, `orgs` lists all of them.
- 0 active memberships → login rejected outright, `403 no_active_organization`, no token issued (credentials were valid — this is not a 401; see §7).

`POST /auth/login` is also subject to the login throttle: `429 rate_limited` after 5 failed attempts for the same `(client_ip, email)` pair within 15 minutes (see [ADR-0011](../adr/0011-login-rate-limiting.md), NFR-11). A successful login clears that pair's counter. `LoginAttempt` (the table backing this) has no API route at all, generic or bespoke — it's write-only internal bookkeeping from the login route itself, never read via the API.

`POST /auth/refresh` request: no body — the only input is the `refresh_token` httpOnly cookie (never a request field). Response: `{access_token}` only; `org_context`/`orgs` are not re-sent (the frontend already holds those from login — refresh's only job is renewing the access token). Per [ADR-0013](../adr/0013-refresh-token-rotation-policy.md):
- **Rotates on every use:** the presented refresh token is revoked (`revoked_reason="rotated"`) and a new one is issued as a new httpOnly cookie in the same response, alongside the new access token. A rotated-out token presented again is rejected — no reuse-grace-window.
- **Inherits absolute expiry:** the new token's `expires_at` is copied from the one it replaces, not reset to `now + 30d` — a session's total lifetime is capped at `JWT_REFRESH_TTL_DAYS` from the original login no matter how often it's silently renewed.
- **Re-checks active org membership**, same rule as login: 0 active `OrgMembership` rows → `403 no_active_organization`, refresh token itself left un-revoked (a later attempt can still succeed if membership is reactivated before the token expires).
- Rejected with `401` (generic body, `code: "invalid_refresh_token"`) for: cookie missing, hash not found, already-revoked (including rotated-out), or expired — the frontend treats all of these identically (clear local auth state, redirect to `/login`); no distinct error code is exposed per-cause.

`POST /auth/signup` (RBAC-1, [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)) request: `{name, email, password, org_name, org_slug}`. Public — no `Authorization` header. Available only while zero `Organization` rows exist deployment-wide (NFR-21); once the first org exists, `409 signup_closed`. Concurrent first-signup calls are serialized via a `pg_advisory_xact_lock` so exactly one `Organization` results from a race. On success: creates `User` (argon2 password hash, same as login), `Organization(name=org_name, slug=org_slug)`, `OrgMembership(status=active)`, and an org-wide `RoleAssignment` to RBAC-4's seeded `org_admin` `Role` — then issues tokens exactly like `POST /auth/login` (access token in the body, refresh token as an httpOnly cookie), response shaped like `LoginResponse` (`org_context: "auto"`, `orgs: [the new org]`). `org_slug` collision → `422` (matches **TC-RBAC-003**; distinct from the `409` bootstrap-closed case above, never conflated).

`POST /orgs` (RBAC-1, [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)) request: `{name, slug}`. Authenticated (`User` or `AIAgent` — no human-only gate; AC doesn't restrict this to humans and RBAC-4's `ai_agent_scoped` bundle doesn't include `organization.create` anyway, so in practice only an `org_admin`-bundle actor ever passes). Gate: `has_permission_in_any_org(actor_id, "organization.create")` — checks org-wide (`project_id IS NULL`) `RoleAssignment`s across *every* org the actor belongs to, since there is no target `org_id` yet to scope a path-based `require_permission` check by; `403 permission_denied` if the actor holds it nowhere. No 404-vs-403 boundary here (NFR-19 doesn't apply — there's no target org's existence to hide). On success: creates `Organization` + the creator's own `OrgMembership(active)` + org-wide `org_admin` `RoleAssignment` in it — the creator is always a member of any org they create, since RBAC-2's invite flow doesn't exist yet to add anyone else afterward. `slug` collision → `422`, same as signup. Response: `{id, name, slug}`.

`GET /auth/me` request: no body, `Authorization: Bearer <access_token>` required — accepts either a human JWT or an agent bearer key (AUTH-4). Response: `{actor_id, email, actor_type}` for a `User`; `{actor_id, agent_name, actor_type: "ai_agent"}` for an `AIAgent` (no `email` field — agents have none). The fuller "+ resolved permission codes" contract (§2 table's original wording) is deferred until an RBAC story exists to resolve permission codes at all — this route ships identity-only for AUTH-2/4, since it exists primarily as the protected route those stories' flows need to prove themselves against, not as the RBAC-driving route it will eventually become.

`POST /orgs/{org_id}/agents` (AUTH-4, [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)): request `{agent_name, model_or_provider?, acting_on_behalf_of_user_id}`. Requires a human `User` bearer token (hardcoded check, independent of `RoleAssignment` — an `AIAgent` bearer credential calling this route gets `403 actor_forbidden` regardless of any permission it might hold, NFR-17) **and** `require_permission("ai_agent.create")` scoped to `org_id`. `acting_on_behalf_of_user_id` must resolve to an active `OrgMembership` in `org_id`, or `422`. On success: creates `Actor(actor_type=ai_agent)` + `AIAgent` row (`issued_at=now`, `revoked_at=NULL`, `last_used_at=NULL`), generates the raw key, and returns `{agent_id, agent_name, api_key, key_prefix}` — `api_key` is the full raw `tnx_agent_...` value, shown exactly once, never retrievable again (only `AIAgent.key_hash` is persisted). Caller with zero `OrgMembership` in `org_id` → `404` (NFR-19); membership present but missing `ai_agent.create` → `403`.

`POST /orgs/{org_id}/agents/{agent_id}/revoke` (AUTH-4): same human-only + `require_permission("ai_agent.update")` gate as issuance. Sets `AIAgent.revoked_at = now()`; idempotent — revoking an already-revoked agent returns `200` with the existing `revoked_at`, not an error. A revoked agent's key is rejected (`401 invalid_token`, same generic body as every other `get_current_actor` rejection) on its very next use — checked via `revoked_at IS NULL` at the lookup itself, not a separate cache/blocklist.

`POST /orgs/{org_id}/projects` (PROJ-1, [ADR-0017](../adr/0017-project-creation-flow.md)) request: `{name, standards_profile?}`. Bespoke, org-path-scoped — same `require_permission("project.create")` + any-status-`OrgMembership` 404-vs-403 boundary as `/orgs/{org_id}/agents*` (no member of `org_id` at all → `404`; member but missing `project.create` → `403`). `standards_profile` omitted → inherits `Organization.default_standards_profile` (one-time copy at creation, not a live reference); supplied (including explicit `null`) → used as given. `(org_id, name)` collision → `422`, same shape/posture as `POST /orgs`'s slug collision. On success: creates `Project` + a project-scoped `RoleAssignment` (`role` = seeded `test_manager`) for the creator, unconditionally — not derived from the creator's own org-level role. Response: `{id, org_id, name, standards_profile}`.

`GET /projects/{id}` / `PATCH /projects/{id}` (PROJ-1): no `org_id` in the path — the row is fetched first and its own `org_id` used for the 404-vs-403 boundary (missing row or caller has no `OrgMembership` in the row's org → `404`; membership present but missing `project.read`/`.update` → `403`). `PATCH` body is partial (`name?`, `standards_profile?`); an explicit `null` for `standards_profile` clears it, an omitted field leaves it unchanged. Rename collision on `(org_id, name)` → `422`. **As of RBAC-3 ([ADR-0021](../adr/0021-role-assignment-creation-flow.md))**, the permission check passes the row's own `project_id` into `has_permission` — an actor holding `project.read`/`.update` **org-wide** (`project_id IS NULL`) still passes, exactly as before, but so does an actor holding it only **project-scoped** to this specific `project_id`. Previously only the org-wide grant was recognized, meaning a project's own creator (auto-assigned only a project-scoped `test_manager` grant per PROJ-1) couldn't `GET`/`PATCH` the project they'd just created unless separately `org_admin` org-wide.

`POST /orgs/{org_id}/role-assignments` (RBAC-3, [ADR-0021](../adr/0021-role-assignment-creation-flow.md)) request: `{actor_id, role_id, project_id?}`. Same `require_permission("role_assignment.create")` + any-status-`OrgMembership` 404-vs-403 boundary as every other org-scoped route (no membership in `org_id` at all → `404`; membership present but missing `role_assignment.create` → `403`). Body validation, all `422` (never `404` — the caller already proved membership in `org_id` before any of these run): `role_id` must resolve to a `Role` usable in this org (`Role.org_id IS NULL`, a system template, or `Role.org_id == org_id`); `actor_id` must resolve to an existing `Actor` (`User` or `AIAgent`); if the resolved actor is a `User`, that `User` must already hold an `OrgMembership` (any status) in `org_id` — `AIAgent` actors skip this check entirely; `project_id`, if given, must resolve to a `Project` with `Project.org_id == org_id`. Duplicate grant (same `actor_id`/`org_id`/`project_id`/`role_id`) → `422` via the existing unique constraint (caught `IntegrityError`), same posture as `organizations.py`'s slug collision. `project_id` omitted (or explicit `null`) → org-wide grant; supplied → project-scoped. Response: `{id, actor_id, org_id, project_id, role_id, created_at}`, `201`.

`GET /orgs/{org_id}/role-assignments` (RBAC-3): same 404-vs-403 boundary, gated on `role_assignment.read`. Returns every `RoleAssignment` row (org-wide and project-scoped both included) for `org_id` — no `project_id` filter query param in this story.

`GET /orgs/{org_id}/roles` (RBAC-3, UI addendum): same 404-vs-403 boundary, gated on `role.read`. Returns every `Role` usable in `org_id` — the 5 RBAC-4 system templates (`org_id IS NULL`) plus this org's own custom roles (`org_id == org_id`) — i.e. exactly the set `POST /orgs/{org_id}/role-assignments`'s own `role_id` validation accepts. Response: `[{id, name, is_system_role}, ...]`, ordered system roles first then custom roles alphabetically. Added specifically to back the frontend's role-assignment form's role dropdown (`RoleAssignmentsPanel.tsx`) rather than leaving `role_id` a raw UUID paste like `actor_id` — no member/agent-listing route exists yet (RBAC-2/an agent-list route are separate, unbuilt scope), so `actor_id` stays raw UUID input in that form.

`POST /projects/{project_id}/releases` (PROJ-2, [ADR-0019](../adr/0019-release-creation-flow.md)) request: `{version_label, target_date?}`. Bespoke, project-path-scoped — no `org_id` path segment exists at this depth, so the route fetches the `Project` row first (missing project or caller has no `OrgMembership` in its `org_id` → `404`), then calls `has_permission("release.create")` directly rather than the path-param-reading `require_permission` (membership present but missing → `403`). Response: `{id, project_id, version_label, target_date}`. No uniqueness constraint on `version_label`.

`GET /projects/{project_id}/releases` (PROJ-2): same 404-vs-403 boundary as create, gated `release.read`. Paginated (§1 convention) and sorted by `target_date` via `?sort=target_date&order=asc|desc` (default `asc`); a `NULL` `target_date` always sorts last, both directions (NFR-25).

`GET /releases/{id}` (PROJ-2): row-resolved, no path `project_id` — same pattern as `GET /projects/{id}`, one level deeper (`org_id` resolved via the fetched `Release`'s `Project`). Gated `release.read`.

`GET /releases/{id}/test-cycles` (PROJ-2, AC2's audit query): row-resolved same as the single-fetch route above. Returns every `TestCycle` with `release_id` matching the path `id`, each with its `TestExecution` rows nested — one call answers "what was tested for release X," matching the story's own queryable-unit framing. Gated on **all three** of `release.read`, `test_cycle.read`, `test_execution.read` (NFR-26) — a departure from every other bespoke route's single-permission-per-route posture, justified because this is the only route in the scaffold exposing `TestExecution` data without a `test_cycle_id` in the request path. A Release with zero linked TestCycles returns `200` with an empty list, not `404`.

`POST /auth/logout` request: no body, `Authorization: Bearer <access_token>` required — the only input beyond that is the `refresh_token` httpOnly cookie, if present (never a request field). Response: `204 No Content`, no body — every other auth route returns a schema because it carries data; logout carries none. Per [ADR-0014](../adr/0014-logout-session-revocation-policy.md):
- Revokes only the **current session's** refresh token (`revoked_reason="logout"`), scoped to the authenticated caller's `user_id` — never every session for the user ("log out everywhere" is out of scope).
- **Idempotent**: missing cookie, hash not found, already-revoked/rotated-out, or a cookie belonging to a different user all return the same `204`, nothing revoked — logout never errors on the conditions it exists to make harmless. The only non-2xx outcome is a missing/invalid **access** token, rejected by the same `get_current_actor` dependency `GET /auth/me` uses (generic 401, `code: "invalid_token"`).
- Clears the `refresh_token` cookie on the response (same `httponly`/`samesite`/`secure` attributes it was set with).
- The access token itself is **not** server-side-invalidated — it remains usable until its own `JWT_ACCESS_TTL_MINUTES` (15) TTL lapses naturally (AUTH-3 AC2). The frontend clears its copy from `lib/auth/tokenStore` immediately and unconditionally on logout, independent of whether this call succeeds (ADR-0014) — the client no longer *presenting* the token is what protects a shared/public machine, since the server can't force it to expire early without a deny-list this scaffold doesn't have.

## 3. Generic CRUD routes (router factory, applied to ~24 of 36 tables)

One factory, parametrized per entity+schema, producing 5 routes. Example shown for `requirement`; the same shape applies to every entity listed in the [Database Document](../database/2026-09-03-database-design.md) except the bespoke ones in §4 and the read-only ones in §5.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/requirements` | `requirement.read` | paginated, filterable |
| GET | `/requirements/{id}` | `requirement.read` | 404 if cross-tenant |
| POST | `/requirements` | `requirement.create` | 422 on validation error |
| PATCH | `/requirements/{id}` | `requirement.update` | partial update |
| DELETE | `/requirements/{id}` | `requirement.delete` | hard delete for lookups; RESTRICT-blocked (409) if referenced, for core assets |

Entities served by the generic factory: `Organization`\*, `Project`\*\*\*, `Requirement`, `TestCondition`, `TestCase`, `TestStep`, `TestSuite`, `TestPlan`, `EntryExitCriteria`, `TestCycle`, `Environment`, `Defect`, `RiskItem`, `Attachment`, `Role`, `Permission`\*\*, `TestDesignTechnique`, `TestLevel`, `TestType`, `OrgMembership`, `RoleAssignment`\*\*\*\*\*.

\* `Organization` create is only reachable via `POST /auth/signup` or `POST /orgs` (§2, RBAC-1/[ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)), never a bare `POST /organizations` — the generic factory still serves `GET`/`PATCH`/`DELETE /organizations/{id}` for this entity, only `create` is bespoke.
\*\* `Permission` is read-only via the generic factory — the catalog is seeded, not user-editable, so only `GET` routes are registered for it.
\*\*\* `Project` create is bespoke and org-path-scoped (`POST /orgs/{org_id}/projects`, §2, PROJ-1/[ADR-0017](../adr/0017-project-creation-flow.md)), same posture as `Organization`\*. Unlike `Organization`, `GET`/`PATCH /projects/{id}` are *also* already built bespoke (row-resolved `org_id`, no path segment) rather than deferred to the factory — their contract already matches what the eventual factory item-route would produce, so they're expected to be absorbed unchanged rather than rebuilt when §3 lands. `DELETE /projects/{id}` remains factory-deferred (no story has asked for Project deletion yet).

`Release`\*\*\*\* is fully bespoke (§2, PROJ-2/[ADR-0019](../adr/0019-release-creation-flow.md)) and removed from this factory-served list — not deferred like `Project`'s `DELETE`, since no `PATCH`/`DELETE /releases/{id}` exists or is planned in this scaffold's current scope (no AC asks for Release edit/delete). `TestCycle` remains listed above only for its eventual factory-served `GET`/`PATCH`/`DELETE`; its own `create` is FR-PLAN-3's scope, not built by this pass — `GET /releases/{id}/test-cycles` (§2) is a read-only bespoke query against existing `TestCycle` rows, not a substitute for `TestCycle`'s own eventual factory routes.

\*\*\*\* Unlike `Project`\*\*\*, none of `Release`'s four routes are expected to be "absorbed unchanged" by the eventual factory — `POST`/`GET /projects/{project_id}/releases` are project-path-scoped (the factory's documented shape has no path-nesting precedent), and `GET /releases/{id}/test-cycles`'s triple-permission gate and nested-executions shape are bespoke-only concerns a generic item-route wouldn't produce.

\*\*\*\*\* `RoleAssignment` create and list are bespoke and org-path-scoped (`POST`/`GET /orgs/{org_id}/role-assignments`, §2, RBAC-3/[ADR-0021](../adr/0021-role-assignment-creation-flow.md)), same posture as `Project`\*\*\*. `PATCH`/`DELETE /role-assignments/{id}` remain factory-deferred — no story has asked for updating or revoking a grant yet (revoke is explicitly out of RBAC-3's scope).

## 4. Bespoke routes

| Method | Path | Permission | Maps to |
|---|---|---|---|
| POST | `/requirements/{id}/test-cases` | `test_case.create` | FR-REQ-2 — direct link path, creates TestCase + RequirementTestCaseLink atomically |
| POST | `/requirements/{id}/test-conditions` | `test_condition.create` | FR-REQ-3 — creates TestCondition + RequirementTestConditionLink |
| POST | `/test-conditions/{id}/test-cases` | `test_case.create` | FR-REQ-3 — creates TestCase + TestConditionTestCaseLink |
| POST | `/test-suites/{id}/test-cases/{case_id}` | `test_suite.update` | FR-REQ-4 — add to suite (join row) |
| DELETE | `/test-suites/{id}/test-cases/{case_id}` | `test_suite.update` | FR-REQ-4 — remove from suite |
| POST | `/test-plans/{id}/test-suites/{suite_id}` | `test_plan.update` | PLAN-1 — include suite in plan |
| POST | `/test-cycles/{id}/executions` | `test_execution.create` | FR-EXEC-1 — rejects (422) if `test_case_id` not in a suite included in the cycle's parent plan (PLAN-3 scope check) |
| GET | `/executions/{id}/logs` | `test_execution.read` | FR-EXEC-2 — ordered TestLog timeline, read-only |
| POST | `/executions/{id}/defects` | `defect.create` | FR-EXEC-3 — creates Defect + TestCaseDefectLink, only when execution `result = fail` |
| POST | `/test-plans/{id}/approve` | `test_plan.approve` | FR-GOV-1 — 403 hardcoded if caller resolves to AIAgent, independent of RoleAssignment (RBAC-5) |
| GET | `/requirements/{id}/traceability` | `requirement.read` | FR-TRACE-1 — full chain view |
| GET | `/projects/{id}/traceability-matrix` | `requirement.export_rtm` | FR-TRACE-2 — tabular RTM |
| GET | `/projects/{id}/traceability-matrix.csv` | `requirement.export_rtm` | FR-TRACE-2 — CSV export |
| GET | `/projects/{id}/reports/design-technique-coverage` | `test_case.read` | ADMIN-1 — "% test cases with ≥1 TestDesignTechnique" |

## 5. Read-only routes (system-appended entities, no create/update/delete API)

| Method | Path | Permission |
|---|---|---|
| GET | `/executions/{id}/logs` | `test_log.read` (see §4 — same route, listed here for the read-only contract) |
| GET | `/requirements/{id}/traceability` etc. | resource-specific `.read` — the 4 link tables are never directly POSTed/PATCHed/DELETEd; they're written only as a side effect of the bespoke routes in §4 |

## 6. MCP server tool surface

Thin client over the **same service layer** as the REST routes above — no separate, weaker validation/permission path (MCP-1's explicit requirement).

| Tool | Backing route/permission | Maps to |
|---|---|---|
| `create_test_case` | `POST /requirements/{id}/test-cases` or `/test-conditions/{id}/test-cases`, `test_case.create` | FR-MCP-1 |
| `list_test_cases` | `GET /requirements/{id}/test-cases` (filtered list), `test_case.read` | FR-MCP-1 |
| `update_test_case` | `PATCH /test-cases/{id}`, `test_case.update` | FR-MCP-2 |
| `create_test_execution` | `POST /test-cycles/{id}/executions`, `test_execution.create` | FR-MCP-3 |
| `read_requirement` | `GET /requirements/{id}`, `requirement.read` | FR-MCP-3 — read-only, no requirement-write/approval/membership tools in this scaffold, matching 26's MVP-scoped MCP surface |

Every MCP-originated write records `created_by_actor_id`/`executed_by_actor_id` pointing at the calling `AIAgent`, with `AIAgent.acting_on_behalf_of_user_id` carried through for accountability (MCP-1).

## 7. Cross-cutting error examples

**401, expired (or otherwise invalid) access token:**
```
{"code": "invalid_token", "message": "Invalid or expired access token.", "field_errors": null}
```
Single generic code for every `get_current_actor` rejection reason — missing/malformed `Authorization` header, expired/tampered/malformed JWT, or a well-formed, validly-signed token whose `sub` doesn't resolve to any `User` — deliberately not distinguished, same no-enumeration-leak posture as `invalid_credentials`/`invalid_refresh_token` below (see `backend/app/core/rbac.py`).

**403, AIAgent attempting Approval:**
```
{"code": "actor_forbidden", "message": "This action is restricted to human users.", "field_errors": null}
```
Same `actor_forbidden` shape is reused verbatim for an `AIAgent` bearer credential calling `POST /orgs/{org_id}/agents` or `.../revoke` (NFR-17, [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)) — one human-only-gate error code across both enforcement points, not a route-specific variant.

**403, login with valid credentials but no active org membership:**
```
{"code": "no_active_organization", "message": "Your account has no active organization membership. Contact your administrator.", "field_errors": null}
```

**401, invalid login credentials (identical body whether the email exists or not — no enumeration leak):**
```
{"code": "invalid_credentials", "message": "Invalid email or password.", "field_errors": null}
```

**401, refresh token missing/revoked/rotated-out/expired (single generic code for all four causes):**
```
{"code": "invalid_refresh_token", "message": "Your session has expired. Please log in again.", "field_errors": null}
```

**409, signup attempted after the deployment already has an Organization:**
```
{"code": "signup_closed", "message": "Self-registration is closed. Contact your administrator for an invite.", "field_errors": null}
```
Distinct from the `422` slug-uniqueness rejection either creation route also returns — `409` here means "signup itself is unavailable," never "your chosen slug collided" ([ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)).

**429, login throttled:**
```
{"code": "rate_limited", "message": "Too many login attempts. Try again later.", "field_errors": null}
```

**404, cross-tenant Requirement fetch (never reveals existence):**
```
{"code": "not_found", "message": "Requirement not found.", "field_errors": null}
```

**422, TestCase create with bad `test_level_id`:**
```
{"code": "validation_error", "message": "Request failed validation.", "field_errors": {"test_level_id": ["must reference an existing TestLevel"]}}
```
