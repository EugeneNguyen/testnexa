# User Stories — Requirement & Test Case Authoring

**Date:** 2026-09-03
**Feature area:** Requirement, TestCondition (optional), TestCase, TestStep, and the direct Requirement↔TestCase link
**Context:** [Personas](../personas/2026-09-03-target-personas.md), [Journeys](../user-journeys/2026-09-03-target-persona-journeys.md), [07-erd-draft.md](../product-discovery/07-erd-draft.md) open question #1 (resolved: TestCondition optional — see [scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md))

---

## Story REQ-1: Capture a requirement

**As** Priya (self-hosted OSS QA lead),
**I want** to record a Requirement (title, description, source, optional external reference to a Jira/GitHub issue),
**so that** every test case can trace back to the thing it's actually verifying (Job #1/#4, 02) — the starting point of her weekly authoring workflow (Journey 1, step 5).

**Acceptance criteria:**
- Given a Project, when a user with `requirement.create` permission submits title/description (and optionally an `external_ref`), then a Requirement is created scoped to that Project.
- Requirements are listable/searchable within a Project by title and `external_ref`.

---

## Story REQ-2: Author a test case directly from a requirement (lightweight path)

**As** Priya, who doesn't need ISTQB-rigor test conditions for her team's workflow,
**I want** to create a TestCase and link it directly to a Requirement without going through a TestCondition,
**so that** the tool doesn't force process overhead she didn't ask for (07's open question #1 — mandatory TestCondition was flagged as an adoption-friction risk; resolved as optional for exactly this reason).

**Acceptance criteria:**
- Given a Requirement, when a user creates a TestCase with `test_condition_id = null` and links it via the direct `RequirementTestCaseLink` join table, then the TestCase is traceable to the Requirement without any TestCondition existing.
- TestCase includes: title, preconditions, expected_result, status (draft/reviewed/approved/deprecated), `created_by_actor_id` (via the shared Actor model — human or AI agent).
- Given a TestCase, when the user adds TestSteps (sequence, action, expected_result), then they're orderable and independently editable.

---

## Story REQ-3: Author a test case via the rigor path (optional TestCondition layer)

**As** Marcus (regulated compliance QA manager),
**I want** to optionally decompose a Requirement into one or more TestConditions (ISTQB: testable aspects derived from a requirement) before writing TestCases against each,
**so that** I can produce ISTQB-vocabulary-aligned traceability when an auditor expects it, without every team being forced through this step (07's two-layer design; Journey 2, the traceability gap flagged there).

**Acceptance criteria:**
- Given a Requirement, when a user creates a TestCondition (description, priority) linked to it, then it's traceable to the Requirement via `RequirementTestConditionLink`.
- Given a TestCondition, when a user creates a TestCase with `test_condition_id` set, then it's traceable to the TestCondition via `TestConditionTestCaseLink`, and transitively to the originating Requirement.
- Both paths (REQ-2's direct link and REQ-3's TestCondition-mediated link) can coexist within the same Project — this is a per-TestCase choice, not a project-wide setting.

---

## Story REQ-4: Organize test cases into suites

**As** Priya,
**I want** to group TestCases into a TestSuite by purpose (regression/smoke/acceptance),
**so that** I can execute a consistent, reusable set without rebuilding it from scratch each release (Job #1, 02 — the single highest-frequency job in the whole discovery set).

**Acceptance criteria:**
- Given a Project, when a user creates a TestSuite (name, purpose), then TestCases can be added/removed from it many-to-many (a TestCase can belong to more than one Suite).
- Given a TestSuite, listing its TestCases reflects current membership, not a point-in-time snapshot (membership changes are live until the suite is included in a TestPlan/TestCycle, at which point execution records freeze what was actually run).
