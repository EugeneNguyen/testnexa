# ADR-0030: REQ-4 TestSuite membership bespoke routes, cross-project rejection, duplicate-add conflict

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD router factory — already serves `TestSuite`'s own name/purpose CRUD in full, unaffected by this ADR), [ADR-0028](0028-req3-test-condition-rigor-path-bespoke-routes.md) (precedent for a small, targeted bespoke-route ADR), [ADR-0006](0006-test-condition-optional.md)/[ADR-0029](0029-testcase-resolver-direct-link-fallback.md) (the `TestCase` org-resolver this ADR's routes reuse, not re-derive), [FR-REQ-4](../requirements/2026-09-03-project-scaffold-requirements.md#24-requirement--test-case-authoring), [Database Document §3.6](../database/2026-09-03-database-design.md#36-assetspy--requirement-testcondition-testcase-teststep-testsuite--junction), [API Document §4](../api/2026-09-03-api-design.md#4-bespoke-routes), [TC-REQ-008/009](../test-cases/2026-09-03-test-cases.md#requirement--test-case-authoring)

## Context

`TestSuite` (name, purpose, project-scoped) already has full generic CRUD via ADR-0022's factory — no gap there. The gap FR-REQ-4 actually needed closed is the many-to-many membership side: `TestSuiteTestCase` (migrated in the initial schema, model present) had no route at all. `docs/api/2026-09-03-api-design.md` §4 already reserved two rows for this (`POST`/`DELETE /test-suites/{id}/test-cases/{case_id}`, `test_suite.update`) but neither was built, and no route existed to read current membership at all — without one, AC2's "listing its TestCases reflects current membership" claim has nothing to call.

Two decisions were needed before writing the routes, both resolved by direct CTO confirmation (2026-09-06), not left to implementation-time judgment:

1. **Cross-project add.** `TestSuite.project_id` and a `TestCase`'s own resolved project (via `test_condition_id`/`RequirementTestCaseLink`/an existing `TestSuiteTestCase` link — the same three-branch chain [ADR-0029](0029-testcase-resolver-direct-link-fallback.md) built) can differ even within the same org — nothing in the schema prevents a `TestCase` native to Project A from being added to a `TestSuite` in Project B. Decided: **reject**, not allow. A suite's membership is meant to be a reusable, purpose-tagged (regression/smoke/acceptance) set of that suite's own project's test cases (FR-REQ-4's own framing) — cross-project membership would let a suite silently accumulate test cases whose lifecycle (deletion, requirement changes) is governed by a different project's own scope, undermining the "reusable set without rebuilding it" premise the story exists for.
2. **Duplicate add.** The `(test_suite_id, test_case_id)` unique constraint already exists at the schema level (initial migration). Decided: **409**, mirroring `org_memberships.py`'s `membership_already_exists` precedent (an idempotency conflict on an already-true relationship state) rather than `422` (which this codebase reserves for malformed/invalid input, not "the thing you asked for already exists").

## Decision

### Three new bespoke routes, one new module

`app/api/routes/test_suite_membership.py` (kept separate from `assets.py`'s generic-factory-only scope, same split ADR-0028's `test_condition_authoring.py` made):

```
POST   /test-suites/{id}/test-cases/{case_id}   test_suite.update   -- add to suite (join row)
DELETE /test-suites/{id}/test-cases/{case_id}   test_suite.update   -- remove from suite
GET    /test-suites/{id}/test-cases             test_suite.read     -- live membership list (new — not in the original API Document)
```

`POST`/`DELETE` reuse the exact shape every other bespoke route in this codebase uses: fetch the `TestSuite` row, resolve its `org_id` via the same `chain_resolver([])` `_TEST_SUITE_CONFIG` already uses, `404` on missing/cross-org, `has_permission` called directly (no `org_id` path segment at this depth) for `403`. No new resolver logic — the `TestCase` side reuses `resolve_test_case_org_id` verbatim (ADR-0029's three-branch chain), not a re-derived one.

**Add** (`POST`), in order:
1. `TestSuite`/`TestCase` both exist and resolve to the caller's org → else `404` (existence-hiding, NFR-1; a cross-org `case_id` is indistinguishable from a missing one).
2. `TestCase`'s own resolved `project_id` equals the `TestSuite`'s `project_id` → else `422 validation_error` (same-org, cross-project rejection, decision #1 above — a business-rule rejection, not a tenant boundary, so `422` not `404`: the caller has already proven membership in the shared org, there is no existence to hide, only an invalid relationship being requested).
3. Insert `TestSuiteTestCase(test_suite_id, test_case_id)` → `IntegrityError` on the unique constraint → rollback → `409 already_in_suite` (decision #2 above), distinct from this API's other two `409` meanings (RESTRICT-blocked delete, signup-closed) — the third, and last, meaning `409` carries here.

**Remove** (`DELETE`): same `404`/`403` boundary; the join row not existing (case never was a member, or was already removed) → `404` — a `DELETE` verb's "already true" case reads as "nothing to find here," not a conflict, unlike `POST`'s "already true."

**List** (`GET`): same `404`/`403` boundary, gated `test_suite.read`. Returns every `TestCase` currently joined via `TestSuiteTestCase` as `TestCaseSummary[]` (paginated, same `{items, total, page, page_size}` shape every other list route uses) — a live query against the join table, not a cached/materialized snapshot, which is the literal mechanism behind AC2's "reflects current membership" claim: nothing is denormalized or copied at add/remove time, so there is nothing that could go stale between them.

### No RBAC catalog change

`test_suite.read`/`.update` are already seeded (`org_admin`: full catalog; `test_manager`: `test_suite.*`; `tester`: `test_suite.read` only) — unlike REQ-3, this story needs no bundle extension, no new migration. Priya's own persona (the story's narrator) reaches `test_manager`'s existing bundle without any change here.

## Consequences

**Positive:** Closes the only real gap FR-REQ-4 had (membership, not the already-complete `TestSuite` entity CRUD). Reuses 100% of existing resolver/permission-check primitives (ADR-0022's `chain_resolver`, ADR-0029's `resolve_test_case_org_id`) — no new backend architecture, matching every prior bespoke-route ADR's own stated posture. The live-`GET` route is a small, honest addition the original API Document missed (it only ever planned the two write routes) rather than a workaround.

**Negative / accepted trade-offs:** Cross-project add being a hard `422` (not even an opt-in override) means a test case genuinely intended to be shared across two projects' suites has no path to do so in this scaffold — accepted, since no story or persona interview asked for cross-project suite sharing, and the schema's own `TestSuite.project_id`/`TestCase`-via-`Requirement.project_id` shapes were never designed with that in mind. `409`'s third meaning in this API (alongside RESTRICT-blocked-delete and signup-closed) is one more code path a client must distinguish by route family, not a universal "conflict" semantic — accepted per the existing precedent (`org_memberships.py`'s `membership_already_exists`) rather than inventing a fourth error shape.

## Alternatives considered

- **Allow cross-project add, since the org boundary is where NFR-1 tenant isolation actually lives** — rejected: this isn't a tenant-isolation question (both rows are in the same org, already-authorized), it's a data-modeling one — a suite's purpose (regression/smoke/acceptance for *this project's* releases) doesn't compose with test cases governed by a different project's own scope, per direct CTO decision.
- **`422` for duplicate-add instead of `409`** — rejected: this codebase's own convention (`org_memberships.py`) already draws exactly this line — `422` for malformed/invalid input, `409` for "the request is well-formed but the target relationship already exists" — and duplicate-suite-membership is squarely the latter, not the former.
- **Fold the live membership `GET` into the generic factory as a `TestSuiteTestCase` list route** (mirroring the 4 read-only link tables, ADR-0027) — rejected: those 4 tables list *link rows* (raw FK pairs) for the admin/traceability surface; this route needs to return `TestCaseSummary` (title, status, etc.) for a usable membership view, which the generic factory's per-entity summary-schema mapping can't produce from a junction table's own columns without per-entity mapping logic the factory deliberately doesn't have (ADR-0022's own stated non-goal).
