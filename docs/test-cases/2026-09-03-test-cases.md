# Test Cases — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Test Design](../test-design/2026-09-03-test-design.md), [Master Test Plan](../test-plan/2026-09-03-master-test-plan.md), [docs/user-stories/*](../user-stories/), [AUTH-1 scope plan](../superpowers/plans/2026-09-03-auth-1-local-password-login-plan.md), [AUTH-2 scope plan](../superpowers/plans/2026-09-03-auth-2-session-persistence-plan.md), [AUTH-3 scope plan](../superpowers/plans/2026-09-03-auth-3-logout-plan.md), [AUTH-4 scope plan](../superpowers/plans/2026-09-03-auth-4-agent-bearer-auth-plan.md), [RBAC-1 scope plan](../superpowers/plans/2026-09-03-rbac-1-create-org-plan.md), [PROJ-1 scope plan](../superpowers/plans/2026-09-03-proj-1-create-project-plan.md), [PROJ-2 scope plan](../superpowers/plans/2026-09-03-proj-2-create-release-plan.md), [RBAC-3 scope plan](../superpowers/plans/2026-09-03-rbac-3-assign-roles-plan.md), [ADMIN-2 scope plan](../superpowers/plans/2026-09-05-admin-2-generic-crud-factory-plan.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md), [ADR-0014](../adr/0014-logout-session-revocation-policy.md), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md), [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md), [ADR-0017](../adr/0017-project-creation-flow.md), [ADR-0018](../adr/0018-admin-shell-sidebar-layout.md), [ADR-0019](../adr/0019-release-creation-flow.md), [ADR-0021](../adr/0021-role-assignment-creation-flow.md), [ADR-0022](../adr/0022-generic-crud-router-factory.md), [ADR-0023](../adr/0023-frontend-shared-component-location.md), [DS-1 scope plan](../superpowers/plans/2026-09-04-ds-1-form-field-plan.md), [ADR-0024](../adr/0024-public-landing-page.md), [LANDING-1 user story](../user-stories/2026-09-05-landing-page-stories.md), [ADR-0025](../adr/0025-requirement-title-field.md), [REQ-1 scope plan](../superpowers/plans/2026-09-05-req-1-capture-requirement-plan.md), [ADR-0026](../adr/0026-sidebar-dark-color-scheme.md)

Concrete test cases derived from each user story's acceptance criteria. IDs group by feature area; **Story** column links back to the source acceptance criterion. Priority: **P1** = release-blocking, **P2** = should-have, **P3** = exploratory/structural-only (per FR priority in the Requirements Document).

---

## Auth

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-AUTH-001 | Login with valid credentials | Registered user exists | POST `/auth/login` with correct email+password | 200; access+refresh token issued; redirected to default org/project view | P1 | AUTH-1 |
| TC-AUTH-002 | Login with invalid credentials | — | POST `/auth/login` with wrong password | 401; generic "invalid credentials" message; body identical to unknown-email case (no enumeration) | P1 | AUTH-1 |
| TC-AUTH-003 | Login, single-org user | User has exactly 1 OrgMembership | Login | That org auto-selected, no picker shown | P1 | AUTH-1 |
| TC-AUTH-004 | Login, multi-org user | User has 2+ OrgMemberships | Login | Org picker shown | P1 | AUTH-1 |
| TC-AUTH-005 | Password never logged/stored plaintext | — | Inspect DB row and application logs after signup/login | `password_hash` is argon2, no plaintext anywhere | P1 | AUTH-1 |
| TC-AUTH-006 | Silent refresh on access-token expiry | Valid refresh cookie present, access token expired | Call `GET /auth/me` (401), frontend interceptor calls `POST /auth/refresh`, retries original request once | New access token obtained transparently; retried `GET /auth/me` succeeds; no forced re-login | P1 | AUTH-2 |
| TC-AUTH-007 | Refresh with revoked token | Refresh token revoked directly via DB fixture (`revoked_at` set — no logout/admin-revoke route exists yet, see AUTH-2 scope plan) | POST `/auth/refresh` | 401 `invalid_refresh_token`; no new token issued; frontend redirects to `/login` | P1 | AUTH-2 |
| TC-AUTH-008 | Refresh tokens are individually revocable | 2 active sessions (2 `RefreshToken` rows) for same user | Revoke session A's refresh token via DB fixture | Session A's next refresh 401s; session B's refresh still succeeds normally | P2 | AUTH-2 |
| TC-AUTH-018 | Refresh token is single-use (rotation) | Valid, unused refresh token | Call `POST /auth/refresh` once (succeeds, new cookie set), then present the *original* (now rotated-out) token again | First call 200s with a new token; second call 401s even though the original token had not otherwise expired or been explicitly revoked | P1 | AUTH-2 |
| TC-AUTH-019 | Refresh rejected once token itself expires | Refresh token with `expires_at` in the past (fixture-seeded) | POST `/auth/refresh` | 401 `invalid_refresh_token`; no new token issued | P1 | AUTH-2 |
| TC-AUTH-020 | Refresh rejected with no cookie at all | No `refresh_token` cookie sent | POST `/auth/refresh` | 401 `invalid_refresh_token` (same generic body as revoked/expired — no distinct code) | P2 | AUTH-2 |
| TC-AUTH-021 | Refresh rejected once org access is lost | User's only `OrgMembership` transitions from `active` to `suspended` after login, refresh token itself still valid | POST `/auth/refresh` | 403 `no_active_organization`; refresh token **not** revoked by this rejection (a later refresh succeeds again if membership is reactivated before the token's `expires_at`) | P1 | AUTH-2 |
| TC-AUTH-022 | Rotation inherits original session's absolute expiry | Token refreshed 3 times in a row (3 rotations) | Inspect the 4th-generation token's `expires_at` | Equal to the 1st-generation token's `expires_at` (copied forward each rotation), not `now + 30d` from the most recent rotation | P2 | AUTH-2 |
| TC-AUTH-023 | `GET /auth/me` returns current actor identity | Valid access token | GET `/auth/me` | 200; `{actor_id, email, actor_type}` matches the authenticated `User` | P2 | AUTH-2 |
| TC-AUTH-009 | Logout revokes current session | Active session | POST `/auth/logout`, then POST `/auth/refresh` with the same (now-revoked) cookie | `/auth/logout` returns 204, `RefreshToken.revoked_reason="logout"`; the subsequent `/auth/refresh` call 401s `invalid_refresh_token`; frontend's token store cleared and redirected to `/login` regardless of the logout call's own success | P1 | AUTH-3 |
| TC-AUTH-024 | Logout with no refresh cookie is a no-op success | Active session, valid access token, `refresh_token` cookie absent/already cleared | POST `/auth/logout` with no cookie sent | 204; no `RefreshToken` row touched; response still clears the (already-absent) cookie | P2 | AUTH-3 |
| TC-AUTH-025 | Logout with already-revoked/rotated-out cookie is a no-op success | Refresh token already revoked (via a prior logout, or rotated out by `/auth/refresh`) | POST `/auth/logout` with the dead cookie | 204; no error, no double-revocation side effect (CAS `rowcount` is 0, row untouched beyond its existing `revoked_at`) | P2 | AUTH-3 |
| TC-AUTH-026 | Logout doesn't revoke a different session's refresh token | 2 active sessions (2 `RefreshToken` rows) for the same user | Logout session A | Session A's cookie now 401s on `/auth/refresh`; session B's refresh token still succeeds normally | P1 | AUTH-3 |
| TC-AUTH-027 | Logout rejected without a valid access token | No/expired/malformed bearer token | POST `/auth/logout` | 401 `invalid_token` (same generic body `GET /auth/me` uses via `get_current_actor`); no revocation attempted | P2 | AUTH-3 |
| TC-AUTH-010 | AIAgent bearer auth attributes actor correctly | AIAgent with issued, non-revoked API key | Call `GET /auth/me` with `Authorization: Bearer <raw key>` | 200; `{actor_id, agent_name, actor_type: "ai_agent"}` resolves to the AIAgent, not any User (mechanism-level proof — see AUTH-4 scope plan §1 for why a real business route isn't used here, none exist yet) | P2 | AUTH-4 |
| TC-AUTH-011 | AIAgent blocked from Approval-permission route | AIAgent authenticated | Call `/test-plans/{id}/approve` | 403, regardless of role bundle | P1 | AUTH-4 / RBAC-5 |
| TC-AUTH-012 | org_admin issues/revokes AIAgent credential | Human User with `ai_agent.create`/`.update` in `org_id` (fixture-seeded RoleAssignment) | POST `/orgs/{org_id}/agents`, then POST `.../revoke` | Create: 201, `api_key` (raw `tnx_agent_...`) shown once, `key_prefix` also returned; Revoke: 200; a subsequent `GET /auth/me` call using the revoked raw key → 401 `invalid_token` | P2 | AUTH-4 |
| TC-AUTH-028 | Revoked AIAgent key rejected before any state update | AIAgent key revoked via fixture (`revoked_at` set) | `GET /auth/me` with that key | 401 `invalid_token` (generic body, same shape as human path); `AIAgent.last_used_at` unchanged (rejection happens at the lookup, before update) | P1 | AUTH-4 |
| TC-AUTH-029 | Key-prefix-narrowed lookup still verifies the full secret | Two AIAgent rows exist; craft a bearer value with agent A's `key_prefix` but agent B's (or a random) secret segment | `GET /auth/me` with the crafted value | 401 `invalid_token` — prefix match alone must not authenticate; argon2 verify against the prefix-matched candidate's `key_hash` must fail | P1 | AUTH-4 |
| TC-AUTH-030 | `last_used_at` updates on every successful agent authentication | AIAgent key valid, `last_used_at` currently NULL | Call `GET /auth/me` twice, a few seconds apart | After call 1: `last_used_at` set (was NULL); after call 2: `last_used_at` advances to the later timestamp, not left at call 1's value | P2 | AUTH-4 |
| TC-AUTH-031 | AIAgent cannot issue or revoke its own (or any) credential | AIAgent authenticated, `RoleAssignment` fixture-seeded to (incorrectly) grant `ai_agent.create`/`.update` anyway | POST `/orgs/{org_id}/agents` and `.../revoke` using the AIAgent's own bearer key | Both 403 `actor_forbidden`, unconditionally — human-only gate rejects before/independent of the permission check (NFR-17) | P1 | AUTH-4 |
| TC-AUTH-032 | Org-scoped agent route: no membership vs. membership-without-permission | (a) Human User with zero `OrgMembership` in `org_id`; (b) Human User with active `OrgMembership` in `org_id` but no `ai_agent.create` grant | POST `/orgs/{org_id}/agents` as (a), then as (b) | (a) 404 `not_found`; (b) 403 — the two must not be conflated (NFR-19) | P1 | AUTH-4 |
| TC-AUTH-033 | AC2 proof: AIAgent lacking the required permission → 403, same RBAC path as a human | AIAgent with a fixture-seeded `RoleAssignment` granting some other permission but not `ai_agent.update`, in `org_id` | Call `.../revoke` using the AIAgent's bearer key | 403 — same generic permission-denied shape a human `User` lacking `ai_agent.update` would get on the same route (not the human-only-gate's `actor_forbidden`; this proves the permission check itself, isolated from TC-AUTH-031's human-only gate) | P1 | AUTH-4 |
| TC-AUTH-034 | `has_permission` org-wide grant recognized (AUTH-4's own RBAC-matrix slice) | Actor (human or AIAgent) with an org-wide `RoleAssignment` (`project_id = null`) granting `ai_agent.update`, fixture-seeded directly | Call `.../revoke` | 403 does **not** occur — permission recognized without any project-scoped grant present, proving the org-wide resolution branch works standalone | P2 | AUTH-4 |
| TC-AUTH-013 | Login rejected, zero org memberships | User exists, no OrgMembership rows at all | POST `/auth/login` with correct credentials | 403 `no_active_organization`; no token issued | P1 | AUTH-1 |
| TC-AUTH-014 | Login rejected, only suspended/invited memberships | User has 1 `suspended` + 1 `invited` OrgMembership, none `active` | POST `/auth/login` with correct credentials | 403 `no_active_organization` | P1 | AUTH-1 |
| TC-AUTH-015 | Suspended/invited memberships excluded from org list | User has 1 `active` + 1 `suspended` OrgMembership | Login | `org_context: "auto"`; `orgs` contains only the active org, suspended org absent | P1 | AUTH-1 |
| TC-AUTH-016 | Login throttled after 5 failed attempts | 5 prior failed logins for same `(client_ip, email)` within 15 min | 6th login attempt for that pair | 429 `rate_limited`, regardless of whether attempt 6's credentials are correct | P1 | AUTH-1 / NFR-11 |
| TC-AUTH-017 | Successful login resets throttle counter | 3 failed attempts, then 1 successful login, same pair | 5 further failed attempts after the success | 429 triggers only after 5 new post-reset failures, not immediately on the next one | P2 | AUTH-1 / NFR-11 |

## RBAC & Multi-Tenancy

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-RBAC-001 | First-ever signup bootstraps org | Fresh instance, zero orgs | POST `/auth/signup` | 200; Organization+User+OrgMembership(active)+org-wide org_admin RoleAssignment created; tokens issued (`org_context: "auto"`) | P1 | RBAC-1 |
| TC-RBAC-002 | Cross-org data isolation | 2 orgs exist, each with a Project/Release/Requirement/TestCase | org_admin of Org A requests a resource id belonging to Org B | 404 (not 403, not data) | P1 | RBAC-1 / NFR-1 — **fully covered as of ADMIN-2/REQ-1** (see TC-PROJ-012 for `Project`, TC-PROJ-016 for `Release`, and **TC-ADMIN-006** for `Requirement` (direct resolver depth) and `TestCase` (multi-hop resolver depth), all reusing the `/orgs/{org_id}/agents*` 404-vs-403 pattern per ADR-0015/[ADR-0017](../adr/0017-project-creation-flow.md)/[ADR-0019](../adr/0019-release-creation-flow.md)/[ADR-0022](../adr/0022-generic-crud-router-factory.md)) — this row's original "Requirement/TestCase remain blocked until their own CRUD routes exist" note is now stale and superseded by ADMIN-2's factory landing |
| TC-RBAC-003 | Org slug uniqueness | Org "acme" exists | Authenticated org_admin: POST `/orgs` with slug "acme" | Rejected, 422 (not 409 — reserved for signup-closed, ADR-0016) | P2 | RBAC-1 |
| TC-RBAC-020 | Concurrent first-signup race is serialized | Fresh instance, zero orgs | Fire 2 concurrent `POST /auth/signup` requests | Exactly one `Organization` row exists afterward — `pg_advisory_xact_lock` prevents both succeeding | P2 | RBAC-1 |
| TC-RBAC-021 | Signup closes after bootstrap | 1 org already exists | POST `/auth/signup` | 409 `signup_closed`; no new User/Organization rows created | P1 | RBAC-1 |
| TC-RBAC-022 | Existing org_admin creates a second, isolated org | User is org_admin of Org A (org-wide RoleAssignment) | POST `/orgs` with `{name, slug}` | 201; new Organization created; creator gets OrgMembership(active)+org-wide org_admin RoleAssignment in it; Org A's own OrgMembership/RoleAssignment rows unchanged | P1 | RBAC-1 |
| TC-RBAC-023 | `has_permission_in_any_org` ignores project-scoped-only grants | Actor's only `organization.create`-granting RoleAssignment is project-scoped (`project_id` non-null) | POST `/orgs` | 403 — a project-scoped grant does not satisfy the any-org, org-wide-only gate | P2 | RBAC-1 |
| TC-RBAC-004 | Invite member by email | org_admin authenticated | POST invite with email | OrgMembership created, status `invited` | P1 | RBAC-2 |
| TC-RBAC-005 | Invited user completes signup | Pending invite exists | User signs up via invite link | OrgMembership status becomes `active` | P1 | RBAC-2 |
| TC-RBAC-006 | Suspend member blocks access, keeps RoleAssignment | Active member with RoleAssignment | org_admin suspends member; suspended user calls any API | 403/401 on all calls; RoleAssignment rows still present in DB | P1 | RBAC-2 |
| TC-RBAC-007 | Multi-org membership | — | Same user gets OrgMembership in 2 orgs | Both memberships valid independently | P2 | RBAC-2 |
| TC-RBAC-008 | Org-wide role grant | RoleAssignment with `project_id = null` granting `project.read`/`.update` | Grantee calls `GET`/`PATCH /projects/{id}` against 2+ distinct Projects in the org | 200 on every project in the org, not just one — real HTTP proof via the [ADR-0021](../adr/0021-role-assignment-creation-flow.md) fix, not a `has_permission()`-only assertion | P1 | RBAC-3 |
| TC-RBAC-009 | Project-scoped role grant | RoleAssignment scoped to Project A only | Grantee calls `GET`/`PATCH /projects/{A.id}`, then the same against Project B (same org, no separate grant) | Project A: 200; Project B: 403 (no implicit access outside the scoped project) | P1 | RBAC-3 |
| TC-RBAC-010 | No RoleAssignment → no implicit access | User has OrgMembership (any status) but zero RoleAssignment rows anywhere in the org | User calls `GET /projects/{id}` for a Project in that org | 403 | P1 | RBAC-3 |
| TC-RBAC-011 | AIAgent RoleAssignment | AIAgent actor, `RoleAssignment` created via `POST /orgs/{org_id}/role-assignments` | AIAgent authenticates (bearer key) and calls `GET`/`PATCH /projects/{id}` per the same org-wide/project-scoped/no-access matrix as TC-RBAC-008/009/010 | AIAgent's permission set resolves exactly like a human User's would — same outcomes, same `has_permission` join chain (07 principle #6) | P2 | RBAC-3 |
| TC-RBAC-024 | Create RoleAssignment, org-wide | org_admin authenticated, has `role_assignment.create` in `org_id`, target actor is an org member | POST `/orgs/{org_id}/role-assignments` with `{actor_id, role_id}`, `project_id` omitted | 201; row created with `project_id = null` | P1 | RBAC-3 |
| TC-RBAC-025 | Create RoleAssignment, project-scoped | Same as above, Project exists in `org_id` | POST with `{actor_id, role_id, project_id}` | 201; row created with the given `project_id` | P1 | RBAC-3 |
| TC-RBAC-026 | Create-endpoint 404-vs-403 boundary | (a) caller with zero OrgMembership in `org_id`; (b) caller with membership but no `role_assignment.create` | POST as (a), then as (b) | (a) 404; (b) 403 — never conflated (NFR-19 pattern reused) | P1 | RBAC-3 |
| TC-RBAC-027 | Cross-org `role_id`/`project_id` rejected as validation error | `role_id` belongs to a custom Role in a different org; separately, `project_id` belongs to a Project in a different org | POST with each bad field in turn | Both 422 (never 404 — [ADR-0021](../adr/0021-role-assignment-creation-flow.md), caller already proved membership in `org_id`) | P1 | RBAC-3 |
| TC-RBAC-028 | Unknown `actor_id` rejected | `actor_id` doesn't resolve to any `Actor` row | POST with that `actor_id` | 422 | P2 | RBAC-3 |
| TC-RBAC-029 | Duplicate RoleAssignment rejected | Identical `(actor_id, org_id, project_id, role_id)` grant already exists | POST the same payload again | 422 (unique-constraint violation, not a silent second row) | P2 | RBAC-3 |
| TC-RBAC-030 | User-actor OrgMembership precondition | Target `actor_id` resolves to a `User` with zero OrgMembership rows in `org_id` | POST a grant for that actor | 422 — a `RoleAssignment` for a non-member `User` is rejected | P1 | RBAC-3 |
| TC-RBAC-031 | Any-status membership satisfies the precondition | Target `User` has a `suspended`-status (not `active`) OrgMembership in `org_id` | POST a grant for that actor | 201 — any status satisfies the gate, not active-only (RBAC-2's suspension model keeps roles manageable) | P2 | RBAC-3 |
| TC-RBAC-032 | AIAgent actor skips the membership gate | Target `actor_id` resolves to an `AIAgent` (no OrgMembership row exists or ever will) | POST a grant for that AIAgent | 201 — gate not applied to AIAgent actors | P1 | RBAC-3 |
| TC-RBAC-033 | List RoleAssignments for an org | Org has 1 org-wide + 1 project-scoped grant; a different org has its own grant | GET `/orgs/{org_id}/role-assignments` | 200; both of this org's rows returned, the other org's row absent | P2 | RBAC-3 |
| TC-RBAC-034 | List-endpoint 404-vs-403 boundary | (a) caller with zero OrgMembership in `org_id`; (b) caller with membership but no `role_assignment.read` | GET as (a), then as (b) | (a) 404; (b) 403 | P2 | RBAC-3 |
| TC-RBAC-035 | Regression: project creator's own project-scoped role now works | Actor creates a Project (PROJ-1), auto-granted only a project-scoped `test_manager` `RoleAssignment` (no org-wide grant) | Same actor calls `GET`/`PATCH /projects/{id}` on the project they just created | 200 — proves the [ADR-0021](../adr/0021-role-assignment-creation-flow.md) fix, not just the new endpoint; would have 403'd before this story | P1 | RBAC-3 / PROJ-1 |
| TC-RBAC-036 | List roles for an org (UI dropdown source) | Org has 1 custom Role; a different org has its own custom Role | GET `/orgs/{org_id}/roles` | 200; all 5 RBAC-4 system roles present + this org's custom role; the other org's custom role absent | P2 | RBAC-3 |
| TC-RBAC-037 | Roles-endpoint 404-vs-403 boundary | (a) caller with zero OrgMembership in `org_id`; (b) caller with membership but no `role.read` | GET as (a), then as (b) | (a) 404; (b) 403 | P2 | RBAC-3 |
| TC-RBAC-038 | Role Assignments UI: grant org-wide via the form | org_admin on `OrgHome`, role dropdown populated from `GET /orgs/{org_id}/roles` | Open "New Role Assignment", paste actor id, select a role, submit with scope left at "Org-wide" | Grant appears in the table with scope "Org-wide"; `POST` body has no `project_id` | P2 | RBAC-3 |
| TC-RBAC-039 | Role Assignments UI: grant project-scoped via the form | Same as above, a Project exists in the org | Switch scope to "Project-scoped", enter a project id, submit | Grant appears in the table with scope "Project {id}"; `POST` body includes `project_id` | P2 | RBAC-3 |
| TC-RBAC-012 | System roles seeded on org creation | New org just created | Query available roles | `org_admin`, `test_manager`, `tester`, `auditor`, `ai_agent_scoped` all present, `is_system_role=true` | P1 | RBAC-4 |
| TC-RBAC-013 | Custom role creation | org_admin authenticated | Create a custom Role scoped to the org | Role created with `org_id` set, usable in RoleAssignment | P2 | RBAC-4 |
| TC-RBAC-014 | ai_agent_scoped never has approval permission | Seed migration applied | Inspect `ai_agent_scoped`'s RolePermission rows | `test_plan.approve` absent | P1 | RBAC-5 |
| TC-RBAC-015 | Reject adding approval permission to an AIAgent-targeted role | Custom role assigned to an AIAgent | Attempt to add `test_plan.approve` to that role via admin UI/API | Rejected | P1 | RBAC-5 |
| TC-RBAC-016 | Seed migration idempotent on re-run | Seed migration already applied | Apply the same migration a second time | `role`/`permission`/`role_permission` row counts unchanged; no error | P1 | RBAC-4 |
| TC-RBAC-017 | Partial unique index rejects duplicate system role | Seed migration applied | Insert a second `Role` row with `name='org_admin'`, `org_id=NULL` directly | Rejected by DB constraint | P1 | RBAC-4 |
| TC-RBAC-018 | org_admin bundle equals full Permission catalog | Seed migration applied | Count `org_admin`'s `RolePermission` rows vs. total `Permission` row count | Counts equal — every seeded permission is granted | P1 | RBAC-4 |
| TC-RBAC-019 | Downgrade removes roles, keeps Permission catalog | Seed migration applied | Run `alembic downgrade -1` for the seed migration | 5 system `Role` rows and their `RolePermission` rows gone; `Permission` catalog rows still present | P2 | RBAC-4 |

## Project & Release

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-PROJ-001 | Create project | User has `project.create` in `org_id` | POST `/orgs/{org_id}/projects` with name | 201; Project created, scoped to `org_id` | P1 | PROJ-1 |
| TC-PROJ-002 | No orphaned assets outside a project | — | Attempt to create Requirement/TestSuite/TestPlan without `project_id` | Schema-enforced (non-nullable `project_id` FK) **and** now live-executable via the API — **covered as of ADMIN-2** for `Requirement` specifically by **TC-ADMIN-010** (`POST /requirements` with no `project_id` in the body → `422`); `TestSuite`/`TestPlan` share the same generic-factory `scope_field` mechanism (ADR-0022) but aren't each individually enumerated as their own test case, per Test Plan §6's "representative entity per depth, not exhaustive per entity" posture. This row's original "no create route exists yet" / execution-deferred note ([ADR-0017](../adr/0017-project-creation-flow.md)) is now stale and superseded by ADMIN-2's factory landing | P1 | PROJ-1 |
| TC-PROJ-003 | Set standards_profile explicitly at creation | Org exists | POST with `standards_profile: "ISTQB-CTFL-v4.0.1 + ISO29119-3"` | Project created with that exact value, org default not consulted | P2 | PROJ-1 |
| TC-PROJ-004 | Create release | Project exists, `release.create` held | POST `/projects/{project_id}/releases` with version_label/target_date | 201; Release created, scoped to `project_id` | P1 | PROJ-2 |
| TC-PROJ-005 | Query cycles for a release | Release has 2 linked TestCycles, each with executions | GET `/releases/{id}/test-cycles` | 200; returns both cycles, each with its own `TestExecution`s nested (not a flat merged list) — one call answers "what was tested for release X" | P1 | PROJ-2 |
| TC-PROJ-006 | Inherit standards_profile from org default | `Organization.default_standards_profile` set; create payload omits `standards_profile` | POST without the field | New Project's `standards_profile` equals the org's default | P2 | PROJ-1 |
| TC-PROJ-007 | Explicit null overrides org default | `Organization.default_standards_profile` set (non-null) | POST with `standards_profile: null` explicitly | New Project's `standards_profile` is `null`, not the inherited default — proves omitted vs. explicit-null are distinguished | P2 | PROJ-1 |
| TC-PROJ-008 | Update standards_profile via PATCH | Project exists, actor has `project.update` | PATCH `/projects/{id}` with a new `standards_profile` | New value persists; omitting the field on a later PATCH leaves it unchanged (no org-default fallback on update) | P2 | PROJ-1 |
| TC-PROJ-009 | Creator auto-assigned project-scoped test_manager role | org_admin creates a Project | Inspect `RoleAssignment` rows after creation | New row: `role=test_manager`, `project_id`=new Project, `org_id`=Project's org; creator's pre-existing org-wide `org_admin` `RoleAssignment` unchanged (both coexist) | P1 | PROJ-1 |
| TC-PROJ-010 | Project name uniqueness is org-scoped | Project "Alpha" exists in Org X | POST another "Alpha" in Org X, then POST "Alpha" in Org Y | Org X duplicate → 422; Org Y same name → 201 (uniqueness is `(org_id, name)`, not global) | P2 | PROJ-1 |
| TC-PROJ-011 | 404-vs-403 boundary on project creation | (a) actor with zero `OrgMembership` in `org_id`; (b) actor with membership but no `project.create` | POST `/orgs/{org_id}/projects` as (a), then as (b) | (a) 404; (b) 403 — never conflated (NFR-19 pattern reused) | P1 | PROJ-1 |
| TC-PROJ-012 | Cross-org GET/PATCH rejected | Project P belongs to Org A; actor is a member of Org B only | GET `/projects/{P.id}` and PATCH same, authenticated as the Org B member | Both 404 — first concrete proof of TC-RBAC-002/NFR-1 against a real tenant-scoped resource | P1 | PROJ-1 / RBAC-1 (TC-RBAC-002) |
| TC-PROJ-013 | GET/PATCH membership-without-permission → 403 | Actor is a member of the Project's org but lacks `project.read`/`.update` | GET, then PATCH, the Project | Both 403 — distinct from TC-PROJ-012's 404 (member vs. non-member) | P2 | PROJ-1 |
| TC-PROJ-014 | Releases sortable by target_date, NULLS LAST both directions | 4 Releases in a Project: 3 with distinct `target_date`s, 1 with `null` | GET `/projects/{id}/releases?sort=target_date&order=asc`, then `...&order=desc` | `asc`: dated releases ascending, `null` row last. `desc`: dated releases descending, `null` row **still last** (not first — proves the pin isn't relying on the query engine's per-direction default) | P2 | PROJ-2 |
| TC-PROJ-015 | test-cycles query triple-permission gate | Actor is a member of the Release's org; holds exactly 2 of {`release.read`, `test_cycle.read`, `test_execution.read`} at a time (3 sub-cases, each missing a different one) | GET `/releases/{id}/test-cycles` under each sub-case | 403 in all 3 sub-cases, never a partial/degraded 200 — proves the gate requires all three, not any one or two | P1 | PROJ-2 |
| TC-PROJ-016 | Cross-org 404 on Release routes | Release R belongs to a Project in Org A; actor is a member of Org B only | GET `/releases/{R.id}` and GET `/releases/{R.id}/test-cycles`, authenticated as the Org B member | Both 404 — extends TC-RBAC-002/NFR-1 to `Release`, same pattern TC-PROJ-012 established for `Project` | P1 | PROJ-2 / RBAC-1 (TC-RBAC-002) |
| TC-PROJ-017 | test_manager can create/list Releases without org_admin | Actor holds only a `test_manager` `RoleAssignment` (no `org_admin` anywhere); RBAC bundle-extension migration applied | POST `/projects/{id}/releases`, then GET `/projects/{id}/releases` | Both succeed (201, 200) — proves the `test_manager` bundle extension ([ADR-0019](../adr/0019-release-creation-flow.md)) actually applied, not just that `org_admin` can reach these routes | P2 | PROJ-2 |

## Requirement & Test Case Authoring

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-REQ-001 | Capture a requirement | Project exists, `requirement.create` held | POST with title/description/source/external_ref | Requirement created, scoped to project | P1 | REQ-1 — `title` added to schema by [ADR-0025](../adr/0025-requirement-title-field.md); the create route itself (project-scoping, permission gate, 404-vs-403 boundary) was already delivered by ADMIN-2 |
| TC-REQ-002 | Search requirements | Multiple requirements exist | Search by title substring (`?q=`) and by external_ref (`?external_ref=`, exact) | Correct subset returned for each; the two params tested as distinct classes (a substring passed to `?external_ref=` must not match) | P2 | REQ-1 — `title`'s inclusion in `search_fields` per [ADR-0025](../adr/0025-requirement-title-field.md); `?q=`/`filter_fields` mechanism itself is ADR-0022's |
| TC-REQ-003 | Direct TestCase authoring (no TestCondition) | Requirement exists | POST test-case with `test_condition_id=null`, linked via RequirementTestCaseLink | TestCase traceable to Requirement without any TestCondition existing | P1 | REQ-2 |
| TC-REQ-004 | Add and reorder TestSteps | TestCase exists | Add 3 steps, reorder | Steps independently editable, sequence persists | P1 | REQ-2 |
| TC-REQ-005 | TestCondition authoring | Requirement exists | POST test-condition (description, priority) | Linked via RequirementTestConditionLink | P1 | REQ-3 |
| TC-REQ-006 | TestCase via TestCondition | TestCondition exists | POST test-case with `test_condition_id` set | Linked via TestConditionTestCaseLink; transitively traceable to Requirement | P1 | REQ-3 |
| TC-REQ-007 | Both authoring paths coexist | Same project | Create one TestCase via each path | Both valid, both visible, distinguished in the traceability view | P1 | REQ-3 |
| TC-REQ-008 | Suite membership many-to-many | TestSuite + TestCase exist | Add same TestCase to 2 suites | Both memberships persist independently | P1 | REQ-4 |
| TC-REQ-009 | Suite membership stays live pre-execution | TestSuite has 2 TestCases | Remove one, then list suite membership | Reflects current (updated) membership, not a stale snapshot | P2 | REQ-4 |

## Test Planning

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-PLAN-001 | Create test plan | Project exists, `test_plan.create` held | POST with identifier/scope/approach/staffing/schedule | Created with status `draft` | P1 | PLAN-1 |
| TC-PLAN-002 | Include suites in plan | TestPlan + TestSuite exist | Add suite to plan | "Which test cases does this plan cover" query returns the suite's cases | P1 | PLAN-1 |
| TC-PLAN-003 | Status transitions | TestPlan in `draft` | Approve, then supersede | draft→approved→superseded succeeds; draft→superseded directly rejected | P1 | PLAN-1 |
| TC-PLAN-004 | Add entry/exit criteria | TestPlan exists | POST criteria rows of each type | All 4 types (entry/exit/suspension/resumption) listed against the plan | P1 | PLAN-2 |
| TC-PLAN-005 | Exit criteria visible with execution progress | TestCycle running under a plan with exit criteria | Open cycle view | Exit criteria shown alongside live execution progress, one view | P2 | PLAN-2 |
| TC-PLAN-006 | Create test cycle | TestPlan + Release exist | POST cycle with environment_id | Linked to both plan and release | P1 | PLAN-3 |
| TC-PLAN-007 | Create environment inline | Setting up a cycle, no environment yet | Create environment inline during cycle creation | Environment created and cycle linked in one flow | P2 | PLAN-3 |
| TC-PLAN-008 | Execution scope enforcement | TestCase NOT a member of any suite included in the plan | Attempt to record an execution for that TestCase under the plan's cycle | Rejected (422) | P1 | PLAN-3 |

## Test Execution & Defects

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-EXEC-001 | Record execution result | TestCase in scope for active cycle | POST execution with result=pass, actual_result notes | Row created with `executed_by_actor_id`, `executed_at` | P1 | EXEC-1 |
| TC-EXEC-002 | Live dashboard aggregation | Cycle has mixed pass/fail/blocked/skipped executions | Open cycle dashboard | Counts match underlying rows exactly, no manual/stale summary | P1 | EXEC-1 |
| TC-EXEC-003 | Re-execution preserves history | TestCase already executed once in this cycle | Record a second execution for same TestCase+cycle | New row inserted, old row untouched, both visible in history | P1 | EXEC-1 |
| TC-EXEC-004 | Status change appends log, doesn't overwrite | Execution exists with result=pass | Correct to fail | New TestLog row appended (`status_change`), TestExecution's prior state not silently overwritten without a trace | P1 | EXEC-2 |
| TC-EXEC-005 | TestLog has no update/delete route | TestLog row exists | Attempt PATCH/DELETE on it | No such route exists (404 from router) | P1 | EXEC-2 |
| TC-EXEC-006 | Ordered log timeline | Execution has 3+ log entries | View execution history | Entries shown in chronological order, separate from current-state fields | P2 | EXEC-2 |
| TC-EXEC-007 | Raise defect from failed execution | Execution with result=fail | POST defect (external_ref, severity, status) | Defect linked to execution and, via TestCaseDefectLink, to the TestCase | P1 | EXEC-3 |
| TC-EXEC-008 | Defect external_ref without live integration | — | Create defect with a plain external_ref string/URL | Accepted, no external API call required | P2 | EXEC-3 |
| TC-EXEC-009 | TestCase shows all defects, most recent first | TestCase has defects across multiple executions | Open TestCase detail | All defects listed, most recent first | P2 | EXEC-3 |

## Governance

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-GOV-001 | Approve a test plan | TestPlan in `draft`, actor has `test_plan.approve` | POST approve | Approval row created; TestPlan → `approved` | P1 | GOV-1 |
| TC-GOV-002 | AIAgent cannot approve | AIAgent actor, any role | POST approve | 403, independent of RoleAssignment | P1 | GOV-1 / RBAC-5 |
| TC-GOV-003 | Approval record survives supersession | TestPlan approved, later superseded by a new version | Query original Approval row | Still present, unchanged, never deleted | P1 | GOV-1 |
| TC-GOV-004 | RiskItem linked to Requirement and/or TestPlan | `risk_item.create` held | POST RiskItem against a Requirement, another against a TestPlan | Each listed on its respective detail view | P2 | GOV-2 |
| TC-GOV-005 | RiskItem structured fields | RiskItem exists | Filter/sort by likelihood/impact | Structured enum values, filterable | P2 | GOV-2 |
| TC-GOV-006 | Attach file to test case | `test_case.update` held | Upload file to TestCase | Attachment row created (url_or_path, mime_type, size_bytes) | P2 | GOV-3 |
| TC-GOV-007 | Attachment size/type limits enforced | Configured max size/allowed types | Upload file over limit; upload disallowed mime type | Both rejected server-side, not just hidden client-side | P2 | GOV-3 |
| TC-GOV-008 | Attachment storage never defaults to third-party SaaS | `ATTACHMENT_STORAGE=local` (default) | Inspect stored file location | Local filesystem/volume, no outbound third-party call | P2 | GOV-3 |

## Taxonomy & Generic Admin CRUD

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-ADMIN-001 | Classify test case by taxonomy | Seeded TestLevel/TestType/TestDesignTechnique | Edit TestCase, select 1 level, 1 type, 2+ techniques | Selections persist via dropdowns/multi-select, not free text | P2 | ADMIN-1 |
| TC-ADMIN-002 | Design-technique coverage report | Project has TestCases, some with techniques assigned, some without | Open coverage report, filter by suite | Correct percentage, filterable | P3 | ADMIN-1 |
| TC-ADMIN-003 | Generic CRUD list renders from config | Any entity with a registered `entityConfigs` entry, user has `<entity>.read` | Navigate to its admin page | Paginated, filterable list renders with no entity-specific component code | P1 | ADMIN-2 |
| TC-ADMIN-004 | Field-type-driven form rendering | Entity config declares string/enum/FK/date fields | Open create/edit form | Each field type renders the matching input (text/select/FK-autocomplete/date picker) | P2 | ADMIN-2 |
| TC-ADMIN-005 | Generic CRUD permission parity | User lacks `<entity>.create` | Open that entity's admin page | Create button hidden/disabled; direct API POST still rejected (403) | P1 | ADMIN-2 |
| TC-ADMIN-006 | Cross-org 404 across resolver depths | One entity per resolver depth seeded in Org A: `Requirement` (direct), `TestCondition` (one-hop), `RiskItem` (branching), `TestCase` (multi-hop, via TestCondition) | Actor in Org B: GET each entity's item route by Org A's id | All 404 — proves the factory's per-entity `resolve_org_id` chain, not just `Project`/`Release`'s direct-column case, enforces tenant isolation ([ADR-0021](../adr/0021-generic-crud-router-factory.md)) | P1 | ADMIN-2 |
| TC-ADMIN-007 | Orphaned TestCase is unreachable, not globally-fallback-readable | TestCase with `test_condition_id IS NULL` and no `TestSuiteTestCase` link | GET/PATCH/DELETE `/test-cases/{id}` as any actor | 404 — proves the factory distinguishes "resolver returned None" (unresolvable, hide it) from "entity has no tenant by design" (global catalog, serve it) | P1 | ADMIN-2 |
| TC-ADMIN-008 | Global-catalog routes use has_permission_in_any_org, not the OrgMembership boundary | Actor holds `test_level.create` org-wide in Org A only | POST `/test-levels` (no org context in the request at all) | 201 — succeeds regardless of which org the grant is in; actor holding the permission nowhere → 403, never 404 (no tenant existence to hide) | P1 | ADMIN-2 |
| TC-ADMIN-009 | Role org_id-null read/write split | Seeded system-role template (`org_id IS NULL`) | GET `/roles/{id}`, then PATCH and DELETE the same id | GET succeeds (200, via has_permission_in_any_org fallback); PATCH and DELETE both 404 | P1 | ADMIN-2 |
| TC-ADMIN-010 | Scope field required on list/create | — | GET `/requirements` with no `?project_id=`; POST `/requirements` with no `project_id` in the body | Both 422 — never an unscoped list of every Requirement, never a create with an unresolvable tenant | P1 | ADMIN-2 |
| TC-ADMIN-011 | RESTRICT-blocked delete returns 409 | TestCase has an existing TestStep (RESTRICT FK) | DELETE `/test-cases/{id}` | 409, distinct from 422; deleting an unreferenced TestCase (no steps) → 204/200 | P1 | ADMIN-2 |
| TC-ADMIN-012 | RiskItem rejects both-FKs-set | — | POST `/risk-items` with both `requirement_id` and `test_plan_id` set | 422 — rejected at the schema-validation layer even though the DB CHECK alone would allow it | P2 | ADMIN-2 |
| TC-ADMIN-013 | Free-text search opt-in per entity | `Requirement` has `search_fields` configured; `TestSuite` does not | GET `/requirements?q=<substring of a seeded description>`; GET `/test-suites?q=anything` | Requirement search returns the matching subset; TestSuite's `?q=` is silently ignored (same result as omitting it), not a 422 | P2 | ADMIN-2 |

## Traceability Matrix

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-TRACE-001 | Full traceability chain view | Requirement has both direct and TestCondition-mediated TestCases, with executions and defects | Open Requirement detail | Both link classes shown, distinguished; latest execution result + linked defects shown per TestCase | P1 | TRACE-1 |
| TC-TRACE-002 | Zero-coverage requirement | Requirement has no linked TestCases at all | Open Requirement detail | Explicit "0 test cases cover this requirement" state, not an empty/ambiguous view | P1 | TRACE-1 |
| TC-TRACE-003 | Project-level RTM table | Project has multiple Requirements at varying coverage levels | Request traceability matrix | One row per Requirement: linked TestCase count, most recent execution status, open Defect count | P1 | TRACE-2 |
| TC-TRACE-004 | Auditor role read+export only | User with `auditor` role | Attempt any write action anywhere in the app | All rejected; RTM view + CSV export both accessible | P1 | TRACE-2 / RBAC-4 |
| TC-TRACE-005 | CSV export | RTM view open, `requirement.export_rtm` held | Trigger CSV export | Valid CSV file matching the table's rows/columns | P2 | TRACE-2 |

## AI Agent / MCP

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-MCP-001 | Create/list TestCases via MCP | AIAgent with `test_case.create`/`.read` | Call `create_test_case`, then `list_test_cases` | Same validation/permission path as REST; both tools succeed | P3 | MCP-1 |
| TC-MCP-002 | MCP write attributes AIAgent correctly | AIAgent has `acting_on_behalf_of_user_id` set | Create a TestCase via MCP | `created_by_actor_id` = the AIAgent; accountable human preserved via `acting_on_behalf_of_user_id` | P3 | MCP-1 |
| TC-MCP-003 | MCP/REST schema parity | TestCase created via MCP | Fetch same TestCase via REST | Identical field shape, no divergent contract | P3 | MCP-1 |
| TC-MCP-004 | Update TestCase via MCP | AIAgent with `test_case.update` | Call `update_test_case` | Change applied; attributable via audit fields | P3 | MCP-2 |
| TC-MCP-005 | MCP permission enforcement | AIAgent scoped to Project X only | Call `update_test_case` against a Project Y TestCase | 403 | P2 | MCP-2 |
| TC-MCP-006 | Create execution via MCP | AIAgent with `test_execution.create` | Call `create_test_execution` | Row created exactly as EXEC-1, `executed_by_actor_id` = agent | P3 | MCP-3 |
| TC-MCP-007 | Read-only Requirement via MCP | AIAgent with `requirement.read` | Call `read_requirement` | Same data a human sees via REST; no create/update tool exists for Requirement via MCP | P3 | MCP-3 |

---

## Layout & Navigation

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-SHELL-001 | Shell wraps every ProtectedRoute screen | Authenticated user | Visit `/orgs/pick`, `/orgs/:orgId`, `/orgs/:orgId/members` | `CSidebar`/`CSidebarNav` + `CHeader` render on all three, not a bespoke nav | P1 | SHELL-1 |
| TC-SHELL-002 | Sidebar lists org-home + org-members, current route active | On `/orgs/:orgId/members` | Inspect sidebar nav items | Both links present; "Members" shows active/current-route styling, "Org home" does not (prefix-match regression check) | P1 | SHELL-1 |
| TC-SHELL-003 | Sidebar org-home link fixes the members dead-end | On `/orgs/:orgId/members` | Click the sidebar's org-home nav link (Playwright, real click — not `page.goBack()`) | URL becomes `/orgs/:orgId`; `OrgHome` renders | P1 | SHELL-1 |
| TC-SHELL-004 | Sidebar collapses/toggles on narrow viewport | Narrow viewport (mobile width) | Load a protected route, click the header's `CHeaderToggler` | Sidebar hides/shows per `CSidebar`'s own `visible` prop behavior — no custom breakpoint logic | P2 | SHELL-1 |
| TC-SHELL-005 | Org-scoped nav items absent with no org selected | On `/orgs/pick` (no `orgId` route param) | Inspect sidebar | Brand renders; org-home/org-members nav items are absent (empty list, not disabled controls) | P2 | SHELL-1 |
| TC-SHELL-006 | New protected route reachable via single nav-item addition | A future story adds a new `ProtectedRoute` route | Add one entry to `AppSidebar`'s nav-item array, no other file touched | New route appears in the sidebar, reachable | P3 | SHELL-1 (structural/code-review criterion, not machine-verifiable against a route that doesn't exist yet) |
| TC-SHELL-007 | Breadcrumb resolves known route segments | On `/orgs/:orgId/members` | Inspect breadcrumb | Renders "Org Home / Members", no raw route param or `undefined` fragment | P2 | ADR-0020 (FR-SHELL-2) |
| TC-SHELL-008 | Breadcrumb on unmapped/root route degrades gracefully | On `/orgs/pick` | Inspect breadcrumb | Renders only resolvable segments (no crash, no blank/garbled fragment) | P3 | ADR-0020 (FR-SHELL-2) |
| TC-SHELL-009 | Footer renders on every protected screen | Authenticated user | Visit `/orgs/pick`, `/orgs/:orgId`, `/orgs/:orgId/members` | `CFooter` renders identically on all three | P3 | ADR-0020 (FR-SHELL-2) |
| TC-SHELL-010 | Dashboard widgets show real, seeded counts | Org with N projects, M active members (seeded fixture) | Load `/orgs/:orgId` | Project widget shows N, Org Member widget shows M — matches fixture, not a hardcoded value | P1 | ADR-0020 (FR-SHELL-3, NFR-27) — **interim status:** `GET /projects`/`GET /org-memberships` ([ADR-0022](../adr/0022-generic-crud-router-factory.md)'s generic-CRUD factory) are implemented (this merge) but this rewrite hasn't landed yet; unit-tested against a mocked resolved count (`OrgHome.widgets.test.tsx`), and E2E currently asserts the honest-error-state fallback instead (`shell-full-template.spec.ts`) — rewrite to real seeded counts as a follow-up |
| TC-SHELL-011 | Dashboard widget zero-state distinct from failed fetch | Org with 0 projects vs. list endpoint returning an error | Load `/orgs/:orgId` in each case | 0-projects case shows widget "0"; error case shows explicit error/loading state, never a false "0" | P2 | ADR-0020 (FR-SHELL-3, NFR-27) |
| TC-SHELL-012 | Dark/light toggle flips active theme | Authenticated user, any protected screen | Click the color-mode toggle | Theme switches (light↔dark), verified by the applied CoreUI color-mode attribute/class | P1 | ADR-0020 (FR-SHELL-4) |
| TC-SHELL-013 | Theme choice persists across reload | Theme toggled to dark | Reload the page | Theme remains dark after reload (`localStorage`-read on boot, not reset to default) | P1 | ADR-0020 (FR-SHELL-4, NFR-28) |
| TC-SHELL-014 | UI-element reference pages reachable, render without error | Authenticated user | Click each of Colors/Typography/Icons in the "UI Elements" nav group | Each page renders (smoke-level only — no FR/story backs their content, per ADR-0020) | P3 | ADR-0020 (no FR — scaffolding) |
| TC-SHELL-015 | Sidebar dark color scheme is independent of the app-wide light/dark toggle | Authenticated user, any protected screen | Toggle FR-SHELL-4's color mode through light, dark, and auto in turn | Sidebar keeps its dark (`sidebar-dark`) styling unchanged in all three states — never flips to light | P2 | ADR-0026 (FR-SHELL-5, NFR-36) |

## Design System / Shared Components

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-DS-001 | FormField pairs label to input via htmlFor/id | — | Render `<FormField id="email" label="Email" />` | `getByLabelText("Email")` resolves an input with `id="email"` — same accessibility contract as the hand-authored instances | P1 | DS-1 |
| TC-DS-002 | FormField defaults to type=text | — | Render `<FormField id="name" label="Name" />` with no `type` prop | Rendered input has `type="text"` | P3 | DS-1 |
| TC-DS-003 | FormField surfaces an error via CFormFeedback + invalid | — | Render `<FormField id="email" label="Email" error="Email is required." />` | Input has `invalid`/`is-invalid` styling; `CFormFeedback` renders the exact message text | P1 | DS-1 |
| TC-DS-004 | FormField renders no error state when error prop is absent | — | Render `<FormField id="email" label="Email" />` | Input is not marked invalid; no `CFormFeedback`/alert role present | P2 | DS-1 |
| TC-DS-005 | FormField forwards ref for RHF register() compatibility | — | Render `<FormField id="email" label="Email" ref={ref} />` | `ref.current` is the underlying `<input>` DOM node | P1 | DS-1 |
| TC-DS-006 | FormField spreads RHF register() rest props | — | Render `<FormField id="email" label="Email" name="email" onChange={fn} onBlur={fn} />` | `name`/`onChange`/`onBlur` land on the underlying input unchanged | P1 | DS-1 |
| TC-DS-007 | Login.tsx migration is behavior-preserving | `Login.tsx` migrated onto FormField + RHF + Zod | Run `auth-login.spec.ts` unmodified | All existing assertions (redirect on success, `/invalid email or password/i` on failure) pass with zero assertion changes | P1 | DS-1 |
| TC-DS-008 | Signup.tsx migration is behavior-preserving | `Signup.tsx` migrated onto FormField + RHF + Zod (5 fields) | Run `Signup.test.tsx`, `Signup.authFlow.test.tsx`, `auth-signup.spec.ts` unmodified | All existing assertions (labels, slug-format rejection alert, exact `signup()` payload, disabled/loading button text, `/login` link) pass with zero assertion changes | P1 | DS-1 |

## Landing Page

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-LANDING-001 | Logged-out visitor sees the landing page at root | No session (no access token, no restorable refresh cookie) | Load `/` | `LandingPage` renders — product name/tagline + "Log in"/"Sign up" CTAs — not `ScaffoldVerificationPage` (deleted) | P1 | LANDING-1 |
| TC-LANDING-002 | "Log in" CTA navigates to /login | On the landing page | Click "Log in" | URL becomes `/login`; `Login` renders | P1 | LANDING-1 |
| TC-LANDING-003 | "Sign up" link navigates to /signup | On the landing page | Click "Sign up" | URL becomes `/signup`; `Signup` renders | P3 | LANDING-1 |
| TC-LANDING-004 | Authenticated visitor is redirected off root | Valid session, `orgContext` resolved (`"auto"` with 1 org, and separately `"picker"` with 2+ orgs) | Load `/` | `"auto"` case → `/orgs/{orgs[0].id}`; `"picker"` case → `/orgs/pick` — landing content never renders in either case | P1 | LANDING-1 |
| TC-LANDING-005 | Landing page makes no authenticated API call | No session | Load `/`, spy/mock `apiFetch` | Zero calls recorded — page renders from static content only | P2 | LANDING-1 |

## Coverage summary

| Feature area | Test case count | P1 count |
|---|---|---|
| Auth | 34 | 22 |
| RBAC & Multi-Tenancy | 39 | 23 |
| Project & Release | 17 | 9 |
| Requirement & Test Case Authoring | 9 | 7 |
| Test Planning | 8 | 6 |
| Test Execution & Defects | 9 | 6 |
| Governance | 8 | 3 |
| Taxonomy & Generic Admin CRUD | 13 | 7 |
| Traceability Matrix | 5 | 4 |
| AI Agent / MCP | 7 | 0 |
| Layout & Navigation | 14 | 6 |
| Design System / Shared Components | 8 | 6 |
| Landing Page | 5 | 3 |
| **Total** | **176** | **102** |

(Recomputed at merge time — RBAC-3 and ADMIN-2 landed independently and each only updated their own row: RBAC & Multi-Tenancy corrected from a stale 19/13 to 39/23 (TC-RBAC-020..023 had been added by RBAC-1 without this table being updated, plus RBAC-3's own 16 new rows — TC-RBAC-024..035 (API) and TC-RBAC-036..039 (the `GET /orgs/{org_id}/roles` endpoint + Role Assignments UI, added on top of the original API-only scope per user direction)); Taxonomy & Generic Admin CRUD from 5/2 to 13/7 (ADMIN-2's TC-ADMIN-006..013). DS-1 then added its own new row, Design System / Shared Components (8/6, TC-DS-001..008), on merge into this table. Neither the RBAC-3/ADMIN-2 merge total (163/93) nor either individual branch's pre-merge total (155/88, 143/84, 143/85) accounted for every row above — 171/99 was the sum of all twelve rows as of the DS-1 merge. LANDING-1 then added its own new row, Landing Page (5/3, TC-LANDING-001..005), bringing the total to 176/102 — the sum of all thirteen rows in this table, not any single branch's pre-merge total.)

**REQ-1 (2026-09-05, [ADR-0025](../adr/0025-requirement-title-field.md)):** no row count change — TC-REQ-001/002 already existed with their current IDs/counts; this pass only annotated them (schema now matches, via the new `title` column) and corrected two stale cross-references elsewhere in this table (TC-RBAC-002, TC-PROJ-002) that had gone unfixed by the ADMIN-2 merge above.

MCP's P3-only weighting matches its exploratory, no-validated-WTP status per the personas doc — structural coverage exists, but nothing here blocks a release.
