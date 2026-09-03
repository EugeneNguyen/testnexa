# Test Design — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Master Test Plan](../test-plan/2026-09-03-master-test-plan.md), [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Database Document](../database/2026-09-03-database-design.md)

Applies ISTQB CTFL v4.0.1 design techniques deliberately — the same vocabulary this product's `TestDesignTechnique` entity asks its own users to declare (ADMIN-1) is used to design the tests below.

---

## 1. Technique selection by feature area

| Feature area | Primary technique(s) | Why |
|---|---|---|
| Auth (login, tokens) | Equivalence partitioning (valid/invalid credentials, valid/expired/revoked tokens) | Small, well-defined input classes |
| RBAC / permission checks | Decision table (role × permission code → allow/deny) | Combinatorial — the exact case ISTQB recommends a decision table for |
| Multi-tenancy isolation | Equivalence partitioning (same-org vs. cross-org resource) + boundary (org with 0 vs. 1 vs. 2+ orgs) | Isolation bugs cluster at the org-boundary edge |
| TestPlan / TestExecution / Defect status | State transition testing | Each has an explicit enum lifecycle (draft→approved→superseded; pass/fail/blocked/skipped; open→...→closed) |
| Requirement→TestCondition→TestCase traceability (2 paths) | Equivalence partitioning (direct-link class vs. TestCondition-mediated class) + state coverage of "0 linked test cases" boundary | ADR-0006 explicitly requires both classes tested, not just one |
| Generic CRUD (28 entities) | Equivalence partitioning per field type (string/enum/FK/date) applied once, reused across entities via `entityConfigs/` | Avoids writing 28 near-duplicate test suites — one technique, applied generically, matches how the UI itself is built (ADMIN-2) |
| Pagination / filtering | Boundary value analysis (page_size at 0, 1, 25, 26; empty result set; last-page boundary) | Classic BVA target |
| Attachment size/type limits | Boundary value analysis (at limit, one byte over, disallowed mime type) | NFR-7 |
| TestLog immutability | Negative testing (attempt update/delete, expect route not to exist / 405 or 404) | Verifying an absence, not a behavior |

## 2. Auth — equivalence classes

**Valid classes:** correct email+password → 200; valid non-expired access token → request succeeds; valid non-revoked refresh token → new access token issued.
**Invalid classes:** wrong password → 401 generic message; unknown email → 401 **identical** generic message (no enumeration leak, tested explicitly as its own case — response body/timing must not differ from the wrong-password case); expired access token → 401; revoked refresh token → 401 + forced re-login; AIAgent key used on a human-only route → 403.

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
- **Boundary — org count:** 0 orgs on a fresh instance → first signup creates one + grants org_admin (RBAC-1); exactly 1 org for a user → auto-select, no picker (AUTH-1); 2+ orgs for a user → picker shown (AUTH-1).

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

## 9. Negative testing — immutability

**TestLog:** attempt `PATCH`/`DELETE` against any TestLog row → route does not exist at all (404 from the router, not a 403 from a permission check — the absence is structural, per EXEC-2 and the Database Document's schema-level immutability note).
**Approval:** attempt `DELETE` on an Approval row → no such route exists; superseding a plan creates a new record, the original is asserted still present and unchanged.

## 10. MCP-specific design notes

Every MCP tool test asserts **contract parity** with its backing REST route (MCP-1's "no divergent data contract" requirement) — the same request/response fixture is run through both the REST endpoint and the MCP tool, and the two response bodies are diffed as part of the test, not just independently asserted against a hardcoded expectation.
