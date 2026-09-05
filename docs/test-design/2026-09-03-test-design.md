# Test Design — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Master Test Plan](../test-plan/2026-09-03-master-test-plan.md), [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Database Document](../database/2026-09-03-database-design.md), [ADR-0011](../adr/0011-login-rate-limiting.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md), [ADR-0014](../adr/0014-logout-session-revocation-policy.md), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md), [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md), [ADR-0017](../adr/0017-project-creation-flow.md), [ADR-0018](../adr/0018-admin-shell-sidebar-layout.md), [ADR-0019](../adr/0019-release-creation-flow.md), [ADR-0020](../adr/0020-admin-shell-full-template-parity.md), [ADR-0021](../adr/0021-role-assignment-creation-flow.md), [ADR-0022](../adr/0022-generic-crud-router-factory.md), [ADR-0023](../adr/0023-frontend-shared-component-location.md), [ADR-0024](../adr/0024-public-landing-page.md)

Applies ISTQB CTFL v4.0.1 design techniques deliberately — the same vocabulary this product's `TestDesignTechnique` entity asks its own users to declare (ADMIN-1) is used to design the tests below.

---

## 1. Technique selection by feature area

| Feature area | Primary technique(s) | Why |
|---|---|---|
| Auth (login, tokens, logout) | Equivalence partitioning (valid/invalid credentials, valid/expired/revoked/rotated-out refresh tokens, active/suspended/invited/zero org memberships, idempotent-no-op logout classes) | Small, well-defined input classes |
| Login rate limiting | Boundary value analysis (attempt count at 4, 5, 6 within the window; just-inside vs. just-outside the 15-minute window) | NFR-11/ADR-0011 — classic BVA target, same as pagination/attachment limits below |
| RBAC / permission checks | Decision table (role × permission code → allow/deny) | Combinatorial — the exact case ISTQB recommends a decision table for |
| Multi-tenancy isolation | Equivalence partitioning (same-org vs. cross-org resource) + boundary (org with 0 vs. 1 vs. 2+ orgs) | Isolation bugs cluster at the org-boundary edge |
| TestPlan / TestExecution / Defect status | State transition testing | Each has an explicit enum lifecycle (draft→approved→superseded; pass/fail/blocked/skipped; open→...→closed) |
| Requirement→TestCondition→TestCase traceability (2 paths) | Equivalence partitioning (direct-link class vs. TestCondition-mediated class) + state coverage of "0 linked test cases" boundary | ADR-0006 explicitly requires both classes tested, not just one |
| Generic CRUD (28 entities) | Equivalence partitioning per field type (string/enum/FK/date) applied once, reused across entities via `entityConfigs/` | Avoids writing 28 near-duplicate test suites — one technique, applied generically, matches how the UI itself is built (ADMIN-2) |
| Pagination / filtering | Boundary value analysis (page_size at 0, 1, 25, 26; empty result set; last-page boundary) | Classic BVA target |
| Attachment size/type limits | Boundary value analysis (at limit, one byte over, disallowed mime type) | NFR-7 |
| TestLog immutability | Negative testing (attempt update/delete, expect route not to exist / 405 or 404) | Verifying an absence, not a behavior |
| Admin shell (sidebar + navbar) | Equivalence partitioning (org-context-present vs. absent, current-route-active vs. not) + state coverage (sidebar visible/collapsed) | Layout is a small, enumerable set of UI states, not a combinatorial one |
| Admin shell extras (breadcrumb, footer, dashboard widgets, dark/light toggle) | Equivalence partitioning (route-with-known-breadcrumb-segment vs. root; theme=light vs. dark vs. unset-defaults-to-system) + state coverage (toggle on/off, persisted vs. fresh session) | Same small-enumerable-state shape as the base shell; widget counts additionally verified against seeded fixture data, not just "renders a number" |
| Shared `FormField` component + Login/Signup migration | Equivalence partitioning (error-present vs. absent, default vs. explicit `type`) + regression/negative testing (pre-migration behavior reproduced exactly) | Small, enumerable prop-driven states for the component itself; the migration's own risk is regression, not new-behavior combinatorics |
| Public landing page (LANDING-1) | Equivalence partitioning (no-session vs. authenticated-session, each its own render/redirect outcome) | Small, binary auth-state partition, same shape as the admin shell's org-context classes above |

## 2. Auth — equivalence classes

**Valid classes:** correct email+password with ≥1 active org membership → 200; valid non-expired access token → request succeeds; valid non-revoked, non-expired, not-yet-used refresh token → new access token issued + new refresh token issued (rotation).
**Invalid classes:** wrong password → 401 generic message; unknown email → 401 **identical** generic message (no enumeration leak, tested explicitly as its own case — response body/timing must not differ from the wrong-password case); expired access token → 401; revoked refresh token → 401 + forced re-login; **rotated-out refresh token (already consumed by a prior refresh) → 401**, tested as a distinct case from "explicitly revoked" even though both return the same generic body ([ADR-0013](../adr/0013-refresh-token-rotation-policy.md) — single-use enforcement is the mechanism under test, not just the revoked-flag path); missing refresh cookie entirely → 401; AIAgent key used on a human-only route → 403.
**Org-membership classes at login (distinct from the credentials check above — all use correct credentials):** exactly 1 `active` membership → 200, `org_context: "auto"`; 2+ `active` memberships → 200, `org_context: "picker"`; 0 `active` memberships (none at all, or only `suspended`/`invited`) → 403 `no_active_organization`, no token issued — tested as its own case, distinct from the 401 credentials-failure class, since the failure reasons and status codes must not be conflated.
**Org-membership classes at refresh (ADR-0013 — same partition re-applied at a second choke point):** ≥1 active membership at refresh time → normal rotation proceeds; 0 active memberships (e.g. suspended after login, before this refresh) → 403 `no_active_organization`, refresh token itself left un-revoked — tested as distinct from the token-validity classes above, since this failure is about the actor's current standing, not the token's own state.
**Rotation-chain class:** a token rotated N times still enforces the *original* session's `expires_at` on refresh N+1 — tested by asserting the Nth-generation token's `expires_at` equals the 1st generation's, not `now + 30d`.
**Logout classes (ADR-0014 — deliberately equivalence-partitioned around idempotency, not just success/failure):** valid session + valid refresh cookie → `204`, `RefreshToken.revoked_reason="logout"`, a subsequent `POST /auth/refresh` with the same cookie now 401s (the actual revocation assertion, not just the `204` status — a route that always returns `204` without revoking anything would pass a status-only test). **Idempotent-no-op class (all collapse to the same `204`, tested as one equivalence class with multiple representative members, not four separate behaviors):** no refresh cookie present, cookie hash not found, cookie already revoked/rotated-out, cookie belongs to a different `user_id` than the authenticated caller. **Invalid-access-token class:** missing/expired/malformed bearer token → 401 (same generic `get_current_actor` body `GET /auth/me` uses) — the one and only non-2xx outcome this route has. **Isolation class:** two `RefreshToken` rows for the same user (or two different users) — logging out session A must leave session B's refresh usable, tested as a distinct case from the single-session rotation isolation `TC-AUTH-008` already covers for `/auth/refresh`, since logout's cross-user `WHERE` clause is new relative to that route.
**Rate-limit class:** 6th failed attempt for the same `(client_ip, email)` pair within the 15-minute window → 429 `rate_limited`, regardless of whether attempt 6 itself used correct credentials (the throttle fires before the credentials check completes evaluating a new attempt); a successful login resets the counter for that pair, tested explicitly (attempt 3 fails, attempt 4 succeeds, attempts 5–8 fail — must take 5 more failures to trigger 429, not fail on attempt 2 post-reset).

**AIAgent bearer-key classes ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)):** valid, non-revoked `tnx_agent_...` key → `get_current_actor` resolves the `AIAgent` (not any `User`) and updates `last_used_at`; revoked key (`revoked_at` set) → 401, same generic `invalid_token` body as every other rejection, `last_used_at` **not** updated (rejection happens at the lookup, before any update); well-formed-looking key whose `key_prefix` matches a real row but whose secret segment fails the argon2 verify (e.g. a truncated/corrupted key sharing another key's prefix by chance) → 401, tested as a distinct case from "prefix not found at all" to prove the lookup-narrowing step doesn't short-circuit the verify; bearer token that doesn't start with `tnx_agent_` → falls through to the JWT-decode branch as today (no new failure mode introduced for the human path).

## 3. RBAC — decision table (representative slice)

Full table generated mechanically from the seeded `Permission` catalog (~100 codes, 29 resources — [Database Document](../database/2026-09-03-database-design.md) §3.3) × 5 system roles at test-authoring time (per Master Test Plan §14 risk mitigation); representative slice below illustrates the shape:

| Permission code | org_admin | test_manager | tester | auditor | ai_agent_scoped |
|---|---|---|---|---|---|
| `test_plan.approve` | ✅ | ✅ | ❌ | ❌ | 🚫 (structurally excluded, never seeded) |
| `test_case.create` | ✅ | ❌ | ✅ | ❌ | ✅ |
| `test_case.delete` | ✅ | ❌ | ✅ | ❌ | ❌ (no delete in the ai_agent bundle) |
| `test_case.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `requirement.export_rtm` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `org_membership.create` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `role.create` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `.read` (any of the 29 resources) | ✅ | resource-dependent | resource-dependent | ✅ (all) | resource-dependent |
| `.delete` (any resource) | ✅ (all) | resource-dependent | ❌ | ❌ | ❌ (never, by design) |

`org_admin` has no ❌ cells at all — its assertion is "bundle size == full catalog size", not a per-code allow/deny walk. Every other ❌/✅/🚫 cell is a distinct test case: authenticate as an actor holding exactly that role, call the route gated by that permission code, assert the resulting status code (200/201 for ✅, 403 for ❌, 403-and-unconditional for 🚫 — RBAC-5's double-enforcement means the 🚫 cells are tested twice: once confirming the permission was never seeded, once confirming the endpoint rejects it even if it somehow were).

**AUTH-4's slice of this table ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)):** `has_permission`/`require_permission` themselves are implemented by AUTH-4, but only the org-wide-grant branch (`RoleAssignment.project_id IS NULL`) is exercised by AUTH-4's own tests, against a fixture-seeded custom `Role`/`Permission`/`RoleAssignment` (not the full 5-system-role catalog, which doesn't exist until RBAC-4's seed migration lands). The project-scoped branch is RBAC-3's coverage obligation — see §18, satisfied against `Project` (the tenant-scoped resource PROJ-1 already built) rather than a synthetic route.

## 4. Multi-tenancy isolation — equivalence classes + boundary

- **Class A (same-org access):** Actor in Org X requests a resource in Org X → 200.
- **Class B (cross-org access):** Actor in Org X requests a resource in Org Y → 404 (never 403 — NFR-1). Tested against every entity type that carries an `org_id` path, not just one representative entity, since the router factory (ADMIN-2) is generic but a per-entity regression is still possible if a bespoke route forgets the filter. First concretely exercised against `Project` (PROJ-1, `GET`/`PATCH /projects/{id}`) — TC-RBAC-002's originally-blocked scope, now achievable for this one entity. Extended to `Release` (PROJ-2, `GET /releases/{id}` and `GET /releases/{id}/test-cycles`) one level deeper in the resource tree, same boundary re-derived via the fetched `Release`'s `Project`. **Class B'** (RBAC-3, body-field variant, [ADR-0021](../adr/0021-role-assignment-creation-flow.md)): a `role_id`/`project_id` supplied in `POST /orgs/{org_id}/role-assignments`'s body that resolves in a *different* org than the caller's already-proven `org_id` → `422`, deliberately **not** `404` — the caller already cleared Class C's boundary on `org_id` itself before this check runs, so there's no existence-hiding purpose left for a 404 here; tested as its own equivalence class specifically to confirm this isn't Class B's 404 by another name.
- **Boundary — org count (instance level, RBAC-1, [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)):** 0 orgs on a fresh instance → first signup creates one + grants org_admin; ≥1 org already exists → `POST /auth/signup` returns `409 signup_closed` instead, tested as a distinct case from the 0-org success path, not just "signup always works." Two simultaneous first-signup calls (race class) → exactly one `Organization` results, the loser's request either 409s or is serialized to run second by the advisory lock (either outcome acceptable, "two orgs created" is the only failure).
- **Boundary — org count (per-user, at login, AUTH-1 — see §2's org-membership classes for the full case list):** exactly 1 active org membership for a user → auto-select, no picker; 2+ → picker shown; 0 active memberships → 403, login rejected, distinct from both of the above.
- **Class C (org-scoped route, no membership at all vs. membership-but-no-permission — NFR-19, [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)):** first exercised by `/orgs/{org_id}/agents*`. Caller with zero `OrgMembership` in the path's `org_id` (including a nonexistent `org_id`) → 404, same existence-hiding rule as Class B. Caller with an `OrgMembership` in that `org_id` but lacking the route's `require_permission` code → 403. The two must be tested as distinct cases against the same route, not conflated — a caller who's a member of the org but merely under-permissioned must never see a 404 (that would incorrectly imply the org itself is unreachable), and a genuine outsider must never see a 403 (that would confirm the org exists).
- **Class D (any-org permission gate, `POST /orgs` only — RBAC-1, [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)):** deliberately does NOT follow Class C's shape, since there is no target org to apply a 404-vs-403 boundary against. Actor holding `organization.create` org-wide in *at least one* org they belong to → 200/201, regardless of which org that grant is in. Actor holding it nowhere (including an actor with zero org memberships at all, and an actor whose only grant is project-scoped, `project_id` non-null) → 403, one flat outcome, no 404 variant.

## 5. State transition testing

**TestPlan.status:** `draft → approved → superseded`. Invalid transitions tested as negative cases: `draft → superseded` directly (should be rejected — must pass through `approved`), `approved → approved` (idempotent re-approval — define as rejected, a new plan version is the correct path per GOV-1).

**TestExecution.result:** `pass | fail | blocked | skipped` — no transition graph (each execution is a new row per EXEC-1, not a mutable state machine), but re-execution behavior itself is tested: creating a second TestExecution for the same TestCase+TestCycle pair must insert, never update, the prior row.

**Defect.status:** `open → ... → closed` (exact intermediate states are an implementation choice deferred to the eventual task plan) — test that `status` is a structured enum, not free text (NFR-5), and that no transition path allows skipping tenant/permission checks.

**OrgMembership.status:** `invited → active` (on signup completion), `active → suspended → active` (admin action) — tested per RBAC-2, including the specific assertion that a `suspended` member's `RoleAssignment` rows remain in the DB (queryable) while all API calls under that membership 403/401.

## 6. Traceability path coverage (ADR-0006)

Both classes must appear in the same test project, not just individually:
- **Class 1 — direct path:** Requirement → RequirementTestCaseLink → TestCase (`test_condition_id IS NULL`).
- **Class 2 — TestCondition-mediated path:** Requirement → RequirementTestConditionLink → TestCondition → TestConditionTestCaseLink → TestCase (`test_condition_id IS NOT NULL`).
- **Boundary — zero coverage:** Requirement with no links of either kind → RTM/detail view must show an explicit "0 test cases cover this requirement" state (TRACE-1), tested as a distinct case from "links exist but all are Class 2," to catch a query that silently drops the direct-link class.

## 7. Generic CRUD — technique applied once, reused per entity

Rather than 28 bespoke test suites, one parametrized equivalence-partitioning suite runs against every entity in the [Database Document](../database/2026-09-03-database-design.md) §3 driven by its `entityConfigs/` field-type declarations:

- **string field:** empty string (boundary), max-length+1 (boundary), valid string (valid class).
- **enum field:** each declared enum value (valid classes), a value outside the enum (invalid class).
- **FK field:** existing id in the same org/project (valid), existing id in a different org/project (invalid — cross-tenant FK, must reject), non-existent id (invalid).
- **date field:** valid ISO date, malformed string (invalid class).

Permission-parity is tested once generically (any entity, lacking `.create`/`.update`/`.delete` → action button hidden **and** API still rejects — ADMIN-2's explicit non-bypass requirement) rather than 28 times. §18 below extends this section with the specific classes ADR-0021's per-entity tenant-resolution depth requires — the equivalence classes above (field-type validation) generalize cleanly across all 20 factory-served entities, but the *cross-tenant 404 boundary* does not, since it depends on each entity's own resolver chain, not just its field types.

## 8. Boundary value analysis — pagination & attachments

**Pagination:** `page_size=0` (reject or clamp — define as clamp-to-1), `page_size=25` (default, valid), `page_size=26` (reject or clamp to max — define as clamp-to-25 per NFR-6), empty result set (`total=0`, empty `items`), exact last-page boundary (`page` beyond `total/page_size` → empty `items`, not an error).

**Attachments:** file at exactly the configured size limit (valid), one byte over (rejected), allowed mime type (valid), disallowed mime type (rejected) — limits themselves are configurable per NFR-7, so this suite must read the configured limit rather than hardcoding a number.

**Login throttle (NFR-11/ADR-0011):** 4th failed attempt for a `(client_ip, email)` pair (still allowed, 401), 5th failed attempt (still allowed, 401 — the 5th failure itself is not throttled, it's what *causes* the next attempt to be throttled), 6th attempt (429, regardless of credential correctness), a successful attempt between failures resets the count to 0 for that pair. Window boundary: an attempt just inside the 15-minute window from the first counted failure still counts toward the threshold; an attempt just after the window has elapsed since the oldest counted failure does not.

## 9. Negative testing — immutability

**TestLog:** attempt `PATCH`/`DELETE` against any TestLog row → route does not exist at all (404 from the router, not a 403 from a permission check — the absence is structural, per EXEC-2 and the Database Document's schema-level immutability note).
**Approval:** attempt `DELETE` on an Approval row → no such route exists; superseding a plan creates a new record, the original is asserted still present and unchanged.

**AIAgent credential human-only gate ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)):** an `AIAgent` bearer credential calling `POST /orgs/{org_id}/agents` or `.../revoke` → 403 `actor_forbidden`, unconditionally, even if that agent's `RoleAssignment` happens to grant `ai_agent.create`/`.update` — same double-enforcement pattern as RBAC-5's Approval check, tested the same two ways (permission never seeded to an agent-eligible role bundle in practice; endpoint rejects it even if it somehow were).

## 10. AIAgent credential lifecycle — state coverage

`AIAgent` has no enum status field, but `revoked_at` behaves as a one-way state flip (`NULL` → set), analogous in test shape to the state-transition techniques in §5:

- **Issuance:** `POST /orgs/{org_id}/agents` with valid `acting_on_behalf_of_user_id` (active `OrgMembership` in `org_id`) → `AIAgent` row created, raw key returned once; response body's `api_key` is asserted absent from any subsequent response (identity/list views, if any exist for `AIAgent` via the generic CRUD surface, must never re-expose it — only `key_prefix`).
- **Revocation:** `revoked_at` set once → subsequent revoke calls on the same agent are idempotent (200, unchanged `revoked_at`), not an error — tested as a distinct case from "revoke a nonexistent agent_id" (404).
- **Post-revocation reuse:** the same raw key, presented again after revocation, → 401, tested immediately after the revoke call in the same test to rule out a caching/eventual-consistency gap.
- **`last_used_at` progression:** `NULL` at issuance (never used yet) → set on first successful authentication → advances (not reset) on each subsequent successful authentication, tested across at least 2 authenticated calls to confirm it's a running "last used," not a write-once "first used" field.

## 11. MCP-specific design notes

Every MCP tool test asserts **contract parity** with its backing REST route (MCP-1's "no divergent data contract" requirement) — the same request/response fixture is run through both the REST endpoint and the MCP tool, and the two response bodies are diffed as part of the test, not just independently asserted against a hardcoded expectation.

## 12. RBAC-4 seed migration — idempotency (negative/regression testing)

**Re-run class:** apply the seed migration to a fresh DB, record `role`/`permission`/`role_permission` row counts, apply it a second time (simulating a redeploy re-running migrations), assert identical counts — no duplicate system-role rows, no unique-constraint error surfaced to the caller. Distinct from a plain "insert succeeds" happy-path test, since the risk here is silent duplication, not a crash.
**Constraint-boundary class:** attempt to insert a second `Role` row with `name='org_admin'`, `org_id=NULL` directly (bypassing the migration's own existence check) → rejected by the partial unique index at the DB level, proving the constraint — not just the migration's own care — is what prevents duplicates.
**Non-interference class:** insert a custom `Role` with `org_id` set to a real org and `name='org_admin'` (same name as a system role) → succeeds, proving the partial index scopes only to `org_id IS NULL` rows and doesn't block per-org custom-role naming.

## 13. RBAC-1 organization bootstrap & creation — equivalence classes ([ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md))

**`POST /auth/signup` classes:** 0 orgs exist → 200, `Organization`+`User`+`OrgMembership(active)`+org-wide `org_admin` `RoleAssignment` created, tokens issued (same shape as login). ≥1 org already exists → `409 signup_closed`, no rows created — tested as its own case, not inferred from the 0-org case's absence. `org_slug` collides with an existing org's slug (only reachable in the 0-org window, i.e. this is the deployment's first org but the slug happens to match — degenerate but possible if a prior org was hard-deleted) → `422`, not `409`.
**`POST /auth/signup` concurrency class:** two requests fired concurrently while 0 orgs exist → exactly one `Organization` row exists afterward (assert by count, not by inspecting either individual response) — the advisory lock is the mechanism under test, not just "no crash."
**`POST /orgs` classes:** actor holds `organization.create` org-wide in some org → 201, new `Organization` + creator's own `OrgMembership(active)` + org-wide `org_admin` `RoleAssignment` in it. Actor holds it nowhere → 403. Actor holds it only project-scoped (`project_id` non-null) in some org → 403 (an org-wide-only grant is required — a project-scoped `organization.create` doesn't exist in the seeded catalog's shape today, but the check must not accidentally treat a hypothetical project-scoped row as sufficient). `slug` collides with an existing org → `422`.
**Isolation class (AC2's core claim):** an `org_admin` of Org A creating Org B does not gain any implicit access to Org A-scoped resources from B, nor vice versa — Org A's `OrgMembership`/`RoleAssignment` rows are unaffected by Org B's creation, asserted by re-querying Org A's rows unchanged after the `POST /orgs` call. Full cross-resource isolation (Project/Requirement/TestCase — TC-RBAC-002) is out of this story's reach until those CRUD routes exist (§3 of the API Document); this class only proves the two new orgs' own RBAC rows don't leak into each other.

## 14. PROJ-1 Project creation — equivalence classes + boundary ([ADR-0017](../adr/0017-project-creation-flow.md))

**`POST /orgs/{org_id}/projects` classes:** actor with `project.create` in `org_id` → 201, `Project` row created scoped to `org_id`, creator gets a project-scoped `test_manager` `RoleAssignment` (`org_id` + `project_id` both set to the new values). Actor with no `OrgMembership` in `org_id` at all (or a nonexistent `org_id`) → 404 (Class C, reused verbatim from §4). Actor with membership but no `project.create` → 403. `(org_id, name)` collision with an existing Project in the same org → 422; the identical `name` in a *different* org → succeeds (uniqueness is org-scoped, not global) — tested as a distinct positive case, not assumed from the negative one.

**Creator role-assignment class (the AC1 rule under test):** every reachable creator today holds `org_admin` (RBAC-4's seeded bundles — no other role currently reaches `project.create`); the assigned role is asserted to be exactly `test_manager`, project-scoped (`project_id` = the new Project, not `NULL`), distinct from the creator's own pre-existing org-wide `org_admin` `RoleAssignment` (both rows must coexist afterward, neither replacing the other).

**`standards_profile` inheritance classes (AC3, NFR-23):** field omitted from the create payload + `Organization.default_standards_profile` set → new Project's `standards_profile` equals the org's default. Field omitted + org's default is `NULL` → new Project's `standards_profile` is `NULL` (not an error, not a placeholder string). Field explicitly supplied (non-null) → that value used regardless of the org's default. Field explicitly `null` in the payload + org has a non-null default → new Project's `standards_profile` is `NULL`, proving explicit-null is distinguished from omitted, not collapsed into "inherit." Same three-way split (omit/explicit-value/explicit-null) re-tested against `PATCH /projects/{id}`, where "omitted" instead means "leave the current value unchanged" (no org-default fallback on update — inheritance is create-time-only).

**`GET`/`PATCH /projects/{id}` classes:** same Class B/C reuse as §4 — missing row or non-member of the row's org → 404; member without `project.read`/`.update` → 403; member with the right permission → 200, current field values (`PATCH`: post-update values). Rename via `PATCH` colliding with another Project's `name` in the same org → 422, same shape as create's collision.

**Schema-level-only class (NFR-22, deferred execution path):** `Requirement`/`TestSuite`/`TestPlan`'s `project_id` FK is asserted non-nullable directly against the migrated schema (introspect the column, not an API call) — the corresponding "attempt to create one via the API without `project_id` → 422" case has no route to exercise yet and is explicitly not attempted here; recorded as a known gap, not silently skipped.

## 15. SHELL-1 admin shell layout — equivalence classes + state coverage ([ADR-0018](../adr/0018-admin-shell-sidebar-layout.md))

**Shell-presence class:** every `ProtectedRoute` screen (`/orgs/pick`, `/orgs/:orgId`, `/orgs/:orgId/members`) renders `CSidebar`/`CSidebarNav` + `CHeader` — tested once per route, not just the two org-scoped ones, since AC1's claim is "any `ProtectedRoute` route," including the org-less picker.

**Org-context classes (the `/orgs/pick` edge case, [ADR-0018](../adr/0018-admin-shell-sidebar-layout.md)):** `orgId` present (on `/orgs/:orgId`, `/orgs/:orgId/members`) → org-home and org-members nav items both render, pointing at that `orgId`. `orgId` absent (`/orgs/pick`, no org selected yet) → sidebar still mounts (brand only), nav-item list is empty — not disabled/greyed items, an absent list. Tested as a distinct case from a rendering bug, since an empty list and a crashed nav-item lookup both "show nothing" but only one is correct.

**Active-route class:** on `/orgs/:orgId`, the org-home nav item shows active styling, org-members does not. On `/orgs/:orgId/members`, the reverse — and critically, org-home must **not** show active styling here too (its path is a prefix of the members path; the `NavLink` `end` match is the mechanism under test, a regression here would show both items "active" simultaneously).

**Navigation class (AC3, the FACT-level defect fix):** from `/orgs/:orgId/members`, clicking the sidebar's org-home nav link (a real Playwright click, not `page.goBack()`) lands on `/orgs/:orgId` and renders `OrgHome`. This is the one case in this section that must run as an E2E test against a live app, not a component-level unit test — the defect it fixes (`OrgMembers.tsx`'s missing link) is itself a routing/integration-level absence, not a unit-testable one.

**Responsive class (AC4, NFR-24):** narrow viewport (e.g. Playwright's mobile viewport preset) → sidebar starts collapsed/overlaid, `CHeaderToggler` click shows it, per `CSidebar`'s own `visible` prop contract — tested as an observed behavior (does the sidebar become visible/hidden), not by asserting internal CSS breakpoint values CoreUI itself owns.

**Extension-point class (AC5, P3/structural — not machine-verifiable as a negative test, see Master Test Plan §14 risk log):** the nav-item list is a single array in `AppSidebar.tsx`; adding a future route's entry there (and nowhere else) is verified by code review at the time that route ships, not by an automated test today (there is no future route yet to assert against).

## 16. PROJ-2 Release creation & audit query — equivalence classes + boundary ([ADR-0019](../adr/0019-release-creation-flow.md))

**`POST /projects/{project_id}/releases` classes:** actor with `release.create` in the project's org → 201, `Release` row created scoped to `project_id`. Actor with no `OrgMembership` in the project's org at all (or a nonexistent `project_id`) → 404 (Class C, reused verbatim). Actor with membership but no `release.create` → 403. Two Releases in the same Project sharing a `version_label` → both succeed (no uniqueness constraint, unlike `Project.name`) — tested as a positive case, proving the absence of a constraint is intentional, not an untested gap.

**`test_manager` RBAC-bundle-extension class (the ADR-0019 rule under test):** a `test_manager`-only actor (no `org_admin` grant anywhere) successfully calls `POST`/`GET /projects/{project_id}/releases` — the only class that would catch the bundle-extension migration silently failing to apply, or `test_manager`'s bundle silently reverting to pre-PROJ-2 shape. Distinct from the `release.create` positive class above, which is satisfiable by `org_admin` alone and wouldn't catch a `test_manager`-bundle regression.

**`GET /projects/{project_id}/releases` sort classes (AC3, NFR-25):** 3 Releases with distinct non-null `target_date`s → returned ascending by default. Same 3 + a 4th Release with `target_date = NULL` → the `NULL` row sorts last under `?order=asc` **and** under `?order=desc` — both directions asserted as their own case, since Postgres's own default (`NULLS FIRST` for `DESC` unless overridden) would silently pass an `asc`-only test suite while still shipping a `desc`-direction regression.

**`GET /releases/{id}` classes:** same Class B/C reuse as §4/§14 — missing row or non-member of the row's (via its Project's) org → 404; member without `release.read` → 403; member with it → 200.

**`GET /releases/{id}/test-cycles` classes (AC2, NFR-26):** Release with 2 linked `TestCycle`s, each with ≥1 `TestExecution` → 200, both cycles returned, each with its own executions nested (not a flat merged list, not requiring a second call). Release with 0 linked TestCycles → 200, empty list, **not** 404 (Release's own existence is independent of whether anything targets it yet). Same Class B/C 404 boundary as the single-fetch route.

**Triple-permission-gate classes (NFR-26, the ADR-0019 departure from single-permission-per-route):** actor is a member of the Release's org in every case below (so the 404-vs-403 boundary itself isn't what's under test here — that's the Class B/C reuse above). Actor holding `release.read` + `test_cycle.read` but missing `test_execution.read` → 403. Actor holding `release.read` + `test_execution.read` but missing `test_cycle.read` → 403. Actor holding `test_cycle.read` + `test_execution.read` but missing `release.read` → 403 (not 404 — the actor has `OrgMembership`, so the 404-vs-403 boundary has already resolved in their favor; `release.read`'s absence is an ordinary permission-denial, same as any other missing-permission case, not re-triggering the existence-hiding boundary). All three of "missing exactly one of the three" tested as distinct cases, not inferred from "missing all three."

## 17. SHELL-2/3/4 full template parity — equivalence classes + state coverage ([ADR-0020](../adr/0020-admin-shell-full-template-parity.md))

**Breadcrumb class (FR-SHELL-2):** route with a known static label (`/orgs/:orgId` → "Org Home", `/orgs/:orgId/members` → "Org Home / Members") vs. an unmapped/root route (`/orgs/pick`) → breadcrumb renders only the segments it can resolve, never a raw route param or `undefined` fragment. Tested as unit-level path-to-label mapping, not E2E.

**Footer class (FR-SHELL-2):** renders once, identically, on every `ProtectedRoute` screen — smoke-level presence check only, no dynamic content to partition.

**Dashboard widget class (FR-SHELL-3, NFR-27):** widget count reflects a seeded fixture's actual `total` (integration/E2E against real rows: 0 projects, 1 project, N projects; same for active org-member count) — **not** asserted against a hardcoded expected value that happens to match whatever the DB currently contains. Zero-state (`total = 0`) is its own tested class, distinct from "widget failed to load," since both can render "0" — a failed fetch must show an explicit error/loading state, not a false zero.

**Dark/light toggle class (FR-SHELL-4, NFR-28):** unset (first visit, no `localStorage` key, defaults to system preference or CoreUI's own default) vs. explicitly set light vs. explicitly set dark — each is a distinct equivalence class. **State coverage:** toggle click flips the active theme; page reload after a toggle preserves the last-set theme (the `localStorage`-persistence claim, tested E2E — a unit test can't prove survival across a reload).

**UI-element reference pages class (Colors/Typography/Icons, no FR/NFR):** smoke-level only — page renders, sidebar link reaches it, no content-correctness assertions (no acceptance criteria exist to test against, per ADR-0020's explicit "not product scope" framing).

## 18. RBAC-3 RoleAssignment creation & project-scoped enforcement — equivalence classes ([ADR-0021](../adr/0021-role-assignment-creation-flow.md))

**`POST /orgs/{org_id}/role-assignments` mechanics classes:** actor with `role_assignment.create` in `org_id`, valid `role_id` + `actor_id` (+ optional `project_id`) → 201, row created with exactly the fields given (`project_id` omitted → `NULL`, org-wide). Actor with no `OrgMembership` in `org_id` at all → 404 (Class C, reused). Actor with membership but no `role_assignment.create` → 403. `role_id` resolving to a *different* org's custom `Role` (`Role.org_id` set to some other org) → 422 (Class B', §4) — a system-template `role_id` (`Role.org_id IS NULL`) is always valid regardless of `org_id`. Unknown `actor_id` (no `Actor` row at all) → 422. `project_id` resolving to a *different* org's `Project` → 422 (Class B'). Duplicate `(actor_id, org_id, project_id, role_id)` → 422 (unique-constraint `IntegrityError`, same shape as `organizations.py`'s slug collision), tested as a distinct case from "first grant succeeds."

**`OrgMembership` precondition class (AC-adjacent, [ADR-0021](../adr/0021-role-assignment-creation-flow.md)):** target `actor_id` resolves to a `User` with zero `OrgMembership` rows in `org_id` → 422. Target `User` with an `OrgMembership` in `org_id` of **any** status (`invited`, `active`, or `suspended` — not active-only) → gate passes, tested with a `suspended`-status membership specifically to prove the check isn't accidentally active-only. Target `actor_id` resolves to an `AIAgent` → gate skipped entirely regardless of any `OrgMembership` state (an `AIAgent` never has one) — tested as its own positive case, not inferred from the `User` classes.

**Org-wide vs. project-scoped resolution classes (AC1/AC2/AC3 — the story's core claim, tested against the real `GET`/`PATCH /projects/{id}` routes per [ADR-0021](../adr/0021-role-assignment-creation-flow.md)'s fix, not `has_permission()` in isolation):**
- **Org-wide class (AC1):** grantee has one `RoleAssignment` with `project_id = NULL` granting `project.read`/`.update` → `GET`/`PATCH` succeeds against *every* Project in the org, not just one — tested against at least 2 distinct Projects in the same org to prove "every," not "the first one tried."
- **Project-scoped class (AC2):** grantee has one `RoleAssignment` scoped to Project A only → `GET`/`PATCH` Project A succeeds; the identical call against Project B (same org, same permission code, no separate grant) → 403 — tested as one paired case (both projects, one actor, one test), not two independent tests that could each pass by accident.
- **No-implicit-access class (AC3):** actor has an `OrgMembership` in the org (any status) but zero `RoleAssignment` rows anywhere in it → 403 on any Project in that org — proves `OrgMembership` alone confers nothing, the negative-space case decision tables (§3) don't otherwise cover.
- **Regression class (the concrete bug this story fixes):** a Project's own creator, who per PROJ-1/ADR-0017 is auto-granted *only* a project-scoped `test_manager` `RoleAssignment` (not org-wide), can now `GET`/`PATCH` the project they just created without also holding org-wide `org_admin` — tested by asserting success for a creator actor stripped down to exactly that one grant (no other `RoleAssignment` rows), not the usual `org_admin` creator fixture that would mask the regression.

**AIAgent grantee class (AC4):** `RoleAssignment` created with `actor_id` = an `AIAgent`'s `actor_id` → identical resolution to the `User` classes above when that `AIAgent` later authenticates (bearer key) and calls `GET`/`PATCH /projects/{id}` — same org-wide/project-scoped/no-access outcomes, proving `has_permission`'s join chain treats `Actor.id` uniformly regardless of `actor_type` (07 principle #6).

**List class:** `GET /orgs/{org_id}/role-assignments` with actor holding `role_assignment.read` → returns both an org-wide and a project-scoped row seeded in the same org, neither filtered out; a row belonging to a *different* org never appears (Class B, §4, reused). Actor with no `OrgMembership` in `org_id` → 404; membership without `role_assignment.read` → 403.

## 19. ADMIN-2 generic CRUD router factory — additional equivalence classes ([ADR-0022](../adr/0022-generic-crud-router-factory.md))

**Resolver-depth class (extends §4's Class B/C to every tenant-resolution shape, not just `Project`/`Release`'s direct-column case):** at least one representative entity per depth is tested against the same cross-org 404 boundary — direct column (`Requirement` via `project_id`), one-hop (`TestCondition` via `requirement_id`), branching (`RiskItem`, whichever of `requirement_id`/`test_plan_id` is set), multi-hop (`TestCase` via `test_condition_id`→`requirement_id`, or `Defect` via its 3-hop chain), and global-catalog (`TestLevel`, no tenant at all — see the Global-catalog class below instead of a 404 boundary). A pass on `Project`/`Release` alone does not generalize to "the factory's tenant isolation works" — each resolver is separately hand-written code (ADR-0022), separately testable, separately breakable.

**Unresolvable-tenant class (distinct from cross-org — same org, but no resolvable chain at all):** a `TestCase` with `test_condition_id IS NULL` and no `TestSuiteTestCase` link → `GET`/`PATCH`/`DELETE /test-cases/{id}` → `404`, tested as its own case distinct from both "cross-org" (Class B) and "global catalog, no tenant by design" (below) — a factory implementation that conflates "resolver returned `None`" with "this entity has no tenant at all" would wrongly serve this row via the `has_permission_in_any_org` fallback instead of hiding it.

**Global-catalog class (no `OrgMembership` boundary applies at all):** `TestLevel`/`TestType`/`TestDesignTechnique`/`Permission` list/create/item routes gated via `has_permission_in_any_org` — actor holding the resource permission org-wide in *any* org they belong to → success, regardless of which org; actor holding it nowhere → `403`, never `404` (there's no tenant existence to hide, so no 404-vs-403 boundary applies here at all, distinct from every tenant-scoped entity above).

**`Role` null-`org_id` read/write split class (NFR-33):** a system-role template (`org_id IS NULL`) → `GET /roles/{id}` succeeds (via the global-catalog fallback) but `PATCH`/`DELETE /roles/{id}` → `404` — tested as two distinct assertions against the *same* row, since an implementation could easily 404 both or neither instead of splitting by method.

**Scope-required-on-list/create class:** `GET /requirements` with no `?project_id=` → `422` (not an empty list, not every Requirement across every project); `POST /requirements` with no `project_id` in the body → `422`, same posture. Tested against at least one entity with a direct scope column and one with a resolved-via-parent scope column (e.g. `Requirement` vs. `TestCondition`), since the validation point differs (the scope value itself vs. a value that must additionally resolve to a real parent row).

**RESTRICT-delete class (NFR-31):** `DELETE` on a row still referenced by a RESTRICT FK (e.g. a `TestCase` with an existing `TestStep`) → `409`, tested as a distinct status from `422` (a `DELETE` on a row that fails Pydantic validation isn't a real scenario, but a `DELETE` on a nonexistent id — `404` — and a RESTRICT-blocked delete — `409` — must not collapse into the same code). `DELETE` on an unreferenced row → `204`/`200`, positive case, proving the `409` path isn't firing unconditionally.

**`RiskItem` both-FKs-set class:** `POST /risk-items` with both `requirement_id` and `test_plan_id` set → `422`, tested as distinct from "neither set" (also `422`, but via the DB `CHECK` rather than the factory's own validator — both must reject, for different underlying reasons, and a test suite that only tries "neither" would miss a validator that forgot the "both" case).

**Search/filter class (NFR-32):** an entity with `search_fields` configured (e.g. `Requirement`) — `?q=<substring>` matches rows via `ILIKE` across the configured columns, case-insensitive, partial match. An entity with none configured (e.g. `TestSuite`, at least initially) — `?q=<anything>` returns the same result as omitting it entirely (silently ignored, not `422`), tested as its own case so "search not implemented for this entity" is provably a no-op, not an unhandled parameter causing an error.

**`RoleAssignment` overlap note:** this factory's `RoleAssignment` config registers only `get`/`update`/`delete` (§3 of the API Document), deliberately not `create`/`list` — §18 above already covers those two verbs' equivalence classes under RBAC-3; nothing here duplicates that coverage.

## 20. DS-1 FormField component & Login/Signup migration — equivalence classes + regression testing ([ADR-0023](../adr/0023-frontend-shared-component-location.md))

**`FormField` rendering classes (AC1):** `label`+`id` supplied → `CFormLabel htmlFor`/`CFormInput id` pair exactly, `getByLabelText(label)` resolves the input (the same accessibility contract the 7 hand-authored instances already produce). `type` omitted → defaults to `"text"`; `type` explicitly `"email"`/`"password"` → passed through unchanged. Rest props (RHF `register()`'s `name`/`onChange`/`onBlur`/`ref`) spread onto the underlying input — a ref-forwarding class distinct from the others, since RHF's `ref` must reach the actual DOM `<input>` node for its own internal wiring to work, not merely render without error.

**Error-state classes (AC2, NFR-34):** `error` prop absent → `invalid` is `false` on `CFormInput`, no `CFormFeedback` rendered (`queryByRole("alert")` returns null). `error` prop set to a non-empty message → `invalid` is `true`, `CFormFeedback` renders that exact message text — tested as two exclusive classes, not inferred from one another, since a component that always renders `CFormFeedback` (even empty) or never marks `invalid` would each pass a single-case test.

**Login/Signup migration — regression classes (AC3, the story's core verification burden):** every existing `Signup.test.tsx`/`Signup.authFlow.test.tsx` assertion (label text via `getByLabelText`, alert text on invalid slug, exact `signup()` payload shape, disabled/loading submit button text, `/login` link) must still pass with **zero assertion changes** after the migration — this is tested by literally not touching those two files, not by writing new tests that happen to assert the same thing. Same posture for `auth-login.spec.ts`/`auth-signup.spec.ts` at the E2E layer. The `orgSlug` regex-format rejection (`Signup.test.tsx`'s "rejects a slug with uppercase/space/symbol characters" case) moves from `handleSubmit`'s imperative check into a Zod `.regex()` rule — tested as a class in its own right, since a Zod-resolver wiring mistake (e.g. the resolver not actually invoked, or the regex ported incorrectly) would only surface as this specific pre-existing test failing, not as a `FormField`-level unit-test gap.

**Non-goal boundary (AC5):** no checkbox/select/radio variant, no `Controller`-based binding path, and no second component in `components/shared/` are exercised by this section's tests — their absence is the story's own explicit scope boundary, not an oversight.

## 21. LANDING-1 public landing page — equivalence classes ([ADR-0024](../adr/0024-public-landing-page.md))

**Auth-state class (the story's core partition):** no session (no access token, no restorable refresh-cookie session) → `LandingPage` renders (product name/tagline, "Log in"/"Sign up" CTAs). Authenticated session (`orgContext` resolved) → redirected off `/` before the landing content ever paints, reusing `Login.tsx`'s own `orgContext`/`orgs`-driven `useEffect` redirect (`"auto"` → `/orgs/{orgs[0].id}`, `"picker"` → `/orgs/pick`) rather than a second, independently-implemented check — tested as the same two branches `Login.tsx`'s own redirect tests already cover, not a new decision space.

**CTA-navigation class:** click "Log in" → lands on `/login`. Click "Sign up" → lands on `/signup`. Both are plain `react-router-dom` links, no API call involved in the click itself — same assertion shape as `Login.tsx`'s existing "New to TestNexa? Sign up" link test.

**No-auth-call class (the public-route posture under test):** render the page with no token/cookie present at all → no network call fires (a spied/mocked `apiFetch` records zero invocations, or the page renders with no `useQuery`/data-fetch hook at all) — proves the route is genuinely public, not silently gated behind a call that would otherwise 401 and be masked by an error boundary.

**Non-goal boundary:** no marketing-depth content (features grid, testimonials, persona-targeted copy) is exercised by this section's tests — bare-bones scope is this story's explicit boundary (ADR-0024), not an oversight.
