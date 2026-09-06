# ADR-0029: `TestCase` org-resolver direct-link fallback (REQ-2 gap-fill)

**Date:** 2026-09-05
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD router factory — the resolver this ADR corrects), [ADR-0006](0006-test-condition-optional.md) (TestCondition optional — the decision that created the direct-link shape this resolver failed to handle), [FR-REQ-2](../requirements/2026-09-03-project-scaffold-requirements.md#24-requirement--test-case-authoring--requirement-testcase-authoring-storiesmd), [TC-REQ-003/004](../test-cases/2026-09-03-test-cases.md#requirement--test-case-authoring), [Database Document §3.6](../database/2026-09-03-database-design.md#36-assetspy--requirement-testcondition-testcase-teststep-testsuite--junction), [API Document §3](../api/2026-09-03-api-design.md#3-generic-crud-routes-router-factory-adr-0022), [REQ-2 scope plan](../superpowers/plans/2026-09-05-req-2-direct-test-case-plan.md)

## Context

ADR-0022's `resolve_test_case_org_id` (`backend/app/api/crud_factory.py`) — the tenant-resolution function every `GET`/`PATCH`/`DELETE /test-cases/{id}` call runs, and that `TestStep`/`Attachment` delegate to one hop up — had exactly two branches: `test_condition_id` (if set) → `Requirement`, or, if `test_condition_id IS NULL`, any linked `TestSuiteTestCase` → `TestSuite`. A row satisfying neither resolved to `None`, treated as a genuinely orphaned, unresolvable-tenant row → `404`.

ADR-0006 already decided that `test_condition_id IS NULL` plus a direct `RequirementTestCaseLink` (no `TestCondition`, no `TestSuite` membership required) is a first-class, intentional shape — the entire point of REQ-2's lightweight authoring path. ADR-0022's resolver never accounted for it: a `TestCase` created via REQ-2's own `POST /requirements/{id}/test-cases` route had **no resolvable path** in its own item-route resolver, so it would `404` as "orphaned" on the very next `GET`/`PATCH`/`DELETE` — immediately after being created by the story that exists specifically to create it. Both the API Document and Database Document repeated this same incomplete resolver description ("no create path in this codebase produces it"), which was true only until REQ-2 shipped that exact create path.

This was caught during REQ-2's own implementation, via an integration test (`test_created_direct_link_test_case_is_readable_afterwards`) proving the bug before the fix, not by a prior story revisiting the decision — no earlier ADR ever decided "direct-link TestCases are unresolvable," it's a gap between ADR-0006's decision and ADR-0022's resolver implementation that nothing before REQ-2 needed to notice, since no create route produced the shape until now.

## Decision

Add a third fallback branch to `resolve_test_case_org_id`, checked **before** the `TestSuiteTestCase` fallback (not after) — the direct-link path is REQ-2's first-class shape, not a lower-priority edge case:

1. `test_condition_id` set → `TestCondition.requirement_id` → `Requirement.project_id` → `Project.org_id` (unchanged).
2. `test_condition_id IS NULL` → any linked `RequirementTestCaseLink` → `Requirement.project_id` → `Project.org_id` (**new**).
3. Neither of the above → any linked `TestSuiteTestCase` → `TestSuite.project_id` → `Project.org_id` (unchanged, now third rather than second).
4. None of the three → unresolvable → `404` (unchanged; still genuinely orphaned, still schema-legal, still no create path produces it — this class is now narrower than before, not eliminated).

No route or schema change — this is a pure resolver-logic fix inside the function ADR-0022 already specified. `TestStep`/`Attachment` need no change of their own; both delegate to this same function and inherit the fix automatically.

## Consequences

**Positive:** Closes the only real gap between ADR-0006's decision and ADR-0022's implementation. Every REQ-2-created `TestCase` is now fully manageable via the existing generic-factory item routes (`GET`/`PATCH`/`DELETE /test-cases/{id}`, and `TestStep` CRUD scoped through it) — no dead-end state where a row can be created but never read back. No behavior change for any `TestCase` created via REQ-3's TestCondition-mediated path or REQ-4's suite-only path — both existing branches are untouched, only reordered relative to the new one.

**Negative / Trade-offs:** One additional `db.scalar` query in the worst case (a `TestCase` with `test_condition_id IS NULL` and no `RequirementTestCaseLink` still falls through to the `TestSuiteTestCase` check, same as before — this ADR adds one query to that path, not two). Same "recorded here rather than silently folded into ADR-0022's original text" posture ADR-0025 established for its own gap-fill — ADR-0022's resolver prose is corrected to describe three branches, with this ADR as the record of why, not a silent rewrite of what ADR-0022 originally said.

## Alternatives considered

- **Check the `TestSuiteTestCase` fallback first, `RequirementTestCaseLink` second** — rejected: REQ-2's direct-link path is the story this scaffold is actively building test coverage against (TC-REQ-003/004); a `TestCase` could in principle satisfy both fallbacks (linked directly to a Requirement *and* added to a Suite) with no ordering-visible difference in practice today, but checking the intentional first-class shape (ADR-0006) ahead of the suite-membership shape (FR-REQ-4, a separate later concern) keeps the resolver's branch order matching each shape's design priority, not just implementation-arrival order.
- **Merge both fallbacks into one query (`UNION` across `RequirementTestCaseLink`/`TestSuiteTestCase`)** — rejected: two separate `db.scalar` calls, each trivially readable and independently testable (mirroring the unit tests already covering the prior two-branch resolver), is more consistent with ADR-0022's own "small bespoke resolver functions, not clever generic combinators" posture than a single combined query would be.
- **Leave the orphaned-row case as-is and instead have REQ-2's create route also insert a dummy `TestSuiteTestCase` row or similar workaround** — rejected outright: fabricating a fake suite membership to satisfy an unrelated resolver's existing branch is exactly the kind of implicit, undocumented coupling this codebase's ADR-first convention exists to prevent.
