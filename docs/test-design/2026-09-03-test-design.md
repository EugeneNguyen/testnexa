# Test Design — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Master Test Plan](../test-plan/2026-09-03-master-test-plan.md), [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Database Document](../database/2026-09-03-database-design.md), [ADR-0011](../adr/0011-login-rate-limiting.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md), [ADR-0014](../adr/0014-logout-session-revocation-policy.md)

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

## 3. RBAC — decision table (representative slice)

Full table generated mechanically from the seeded `Permission` catalog × 5 system roles at test-authoring time (per Master Test Plan §14 risk mitigation); representative slice below illustrates the shape:

| Permission code | org_admin | test_manager | tester | auditor | ai_agent_scoped |
|---|---|---|---|---|---|
| `test_plan.approve` | ✅ | ✅ | ❌ | ❌ | 🚫 (structurally excluded, never seeded) |
| `test_case.create` | ✅ | ✅ | ✅ | ❌ | ✅ (project-scoped only) |
| `requirement.export_rtm` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `org.manage_members` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `*.delete` (any entity) | project-dependent | ❌ | ❌ | ❌ | ❌ |

Every ❌/✅/🚫 cell is a distinct test case: authenticate as an actor holding exactly that role, call the route gated by that permission code, assert the resulting status code (200/201 for ✅, 403 for ❌, 403-and-unconditional for 🚫 — RBAC-5's double-enforcement means the 🚫 cells are tested twice: once confirming the permission was never seeded, once confirming the endpoint rejects it even if it somehow were).

## 4. Multi-tenancy isolation — equivalence classes + boundary

- **Class A (same-org access):** Actor in Org X requests a resource in Org X → 200.
- **Class B (cross-org access):** Actor in Org X requests a resource in Org Y → 404 (never 403 — NFR-1). Tested against every entity type that carries an `org_id` path, not just one representative entity, since the router factory (ADMIN-2) is generic but a per-entity regression is still possible if a bespoke route forgets the filter.
- **Boundary — org count (instance level, RBAC-1):** 0 orgs on a fresh instance → first signup creates one + grants org_admin.
- **Boundary — org count (per-user, at login, AUTH-1 — see §2's org-membership classes for the full case list):** exactly 1 active org membership for a user → auto-select, no picker; 2+ → picker shown; 0 active memberships → 403, login rejected, distinct from both of the above.

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

## 10. MCP-specific design notes

Every MCP tool test asserts **contract parity** with its backing REST route (MCP-1's "no divergent data contract" requirement) — the same request/response fixture is run through both the REST endpoint and the MCP tool, and the two response bodies are diffed as part of the test, not just independently asserted against a hardcoded expectation.
