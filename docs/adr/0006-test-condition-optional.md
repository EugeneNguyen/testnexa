# ADR-0006: TestCondition is optional, not mandatory

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [07 ERD open question #1](../product-discovery/07-erd-draft.md), [REQ-2/REQ-3 user stories](../user-stories/2026-09-03-requirement-testcase-authoring-stories.md)

## Context

ISTQB CTFL models `TestCondition` as a first-class unit between `Requirement` and `TestCase`. Making it mandatory adds real adoption friction for teams (Priya's persona) who don't need CTFL-rigor traceability and just want a requirement linked straight to a test case.

## Decision

`TestCase.test_condition_id` is nullable. A direct `RequirementTestCaseLink` join table provides a lightweight path that bypasses `TestCondition` entirely (REQ-2); the `TestCondition`-mediated path (via `RequirementTestConditionLink` + `TestConditionTestCaseLink`, REQ-3) remains available. Both paths coexist within the same project, chosen per-`TestCase`, not as a project-wide setting.

## Consequences

**Positive:** no forced process overhead for lightweight teams; regulated teams still get the ISTQB-vocabulary-aligned rigor path when an auditor expects it; the choice is granular (per test case), matching how real teams actually mix rigor levels within one project.

**Negative / Trade-offs:** the Requirement detail/RTM view (TRACE-1) must distinguish and display both path shapes rather than presenting one uniform traceability chain — adds UI/query complexity that a mandatory single path wouldn't have.

## Alternatives considered

- **Mandatory TestCondition** — rejected: 07 itself flags this as an adoption-friction risk needing interview validation.
- **Project-level toggle (all-TestCondition or all-direct)** — rejected: REQ-3 explicitly requires per-TestCase coexistence within one project, not a project-wide mode switch.
