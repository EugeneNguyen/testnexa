# User Stories — Test Planning (TestPlan, EntryExitCriteria, TestCycle, Environment)

**Date:** 2026-09-03
**Feature area:** TestPlan, EntryExitCriteria, TestCycle, Environment
**Context:** [Personas](../personas/2026-09-03-target-personas.md), [07-erd-draft.md](../product-discovery/07-erd-draft.md)

---

## Story PLAN-1: Create a test plan

**As** Marcus (regulated compliance QA manager),
**I want** to create a TestPlan with identifier, scope, approach, staffing/training, and schedule fields matching IEEE 829/ISO 29119-3 Test Plan sections,
**so that** the plan itself can be exported/reviewed in a format his auditors already recognize, instead of a proprietary structure (07: "How this answers the compatibility question" — IEEE 829 mapping).

**Acceptance criteria:**
- Given a Project, when a user with `test_plan.create` permission submits identifier/scope/approach/staffing_and_training/schedule, then a TestPlan is created with status `draft`.
- Given a TestPlan, when TestSuites are included in it (many-to-many), then the plan's scope is queryable as "which test cases does executing this plan cover."
- TestPlan status transitions draft → approved (see Governance stories for the Approval step) → superseded.

---

## Story PLAN-2: Define entry/exit criteria

**As** Marcus,
**I want** to attach structured entry/exit/suspension/resumption criteria to a TestPlan,
**so that** "are we ready to start testing" and "are we done" are answerable as checkable rows, not buried in prose (07: EntryExitCriteria covers this "explicitly as structured rows, not prose").

**Acceptance criteria:**
- Given a TestPlan, when a user adds an EntryExitCriteria row (type: entry/exit/suspension/resumption, condition_text), then it's listed against that plan.
- Given a TestCycle executing under a TestPlan, its exit criteria are visible alongside execution progress (not a separate lookup) so a reviewer can check completion against them in one view.

---

## Story PLAN-3: Run a test cycle in an environment

**As** Priya,
**I want** to create a TestCycle under a TestPlan, targeted at a Release, run in a named Environment,
**so that** "did we test this in staging vs. production-like config" is a recorded fact, not tribal knowledge.

**Acceptance criteria:**
- Given a TestPlan and a Release, when a user creates a TestCycle (name, start_date, end_date, environment_id), then it's linked to both.
- Given an Environment (name, config_notes) that doesn't yet exist, a user with `environment.create` permission can create one inline while setting up a TestCycle, or from an admin screen.
- A TestCycle's executions (see Execution stories) are only creatable against TestCases that are members of a TestSuite included in the parent TestPlan — prevents recording an execution for a test case the plan never scoped in.
