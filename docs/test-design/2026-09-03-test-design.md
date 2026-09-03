# Test Design — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Master Test Plan](../test-plan/2026-09-03-master-test-plan.md), [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Database Document](../database/2026-09-03-database-design.md), [ADR-0011](../adr/0011-login-rate-limiting.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md), [ADR-0014](../adr/0014-logout-session-revocation-policy.md), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md), [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)

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

**AUTH-4's slice of this table ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)):** `has_permission`/`require_permission` themselves are implemented by AUTH-4, but only the org-wide-grant branch (`RoleAssignment.project_id IS NULL`) is exercised by AUTH-4's own tests, against a fixture-seeded custom `Role`/`Permission`/`RoleAssignment` (not the full 5-system-role catalog, which doesn't exist until RBAC-4's seed migration lands). The full decision table above — 5 named system roles × the complete seeded `Permission` catalog, including the project-scoped branch — remains RBAC-3/RBAC-4's own coverage obligation, not satisfied by AUTH-4.

## 4. Multi-tenancy isolation — equivalence classes + boundary

- **Class A (same-org access):** Actor in Org X requests a resource in Org X → 200.
- **Class B (cross-org access):** Actor in Org X requests a resource in Org Y → 404 (never 403 — NFR-1). Tested against every entity type that carries an `org_id` path, not just one representative entity, since the router factory (ADMIN-2) is generic but a per-entity regression is still possible if a bespoke route forgets the filter.
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

Permission-parity is tested once generically (any entity, lacking `.create`/`.update`/`.delete` → action button hidden **and** API still rejects — ADMIN-2's explicit non-bypass requirement) rather than 28 times.

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
