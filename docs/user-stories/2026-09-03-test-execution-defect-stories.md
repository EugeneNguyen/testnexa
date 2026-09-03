# User Stories — Test Execution, Test Log, Defects

**Date:** 2026-09-03
**Feature area:** TestExecution, TestLog, Defect, TestCaseDefectLink
**Context:** [Personas](../personas/2026-09-03-target-personas.md), [Journeys](../user-journeys/2026-09-03-target-persona-journeys.md), [07-erd-draft.md](../product-discovery/07-erd-draft.md)

---

## Story EXEC-1: Record a test execution result

**As** Priya (self-hosted OSS QA lead),
**I want** to record the result of running a TestCase within a TestCycle (pass/fail/blocked/skipped, actual_result notes),
**so that** "are we ready to ship" is answerable from real recorded status, not memory (Job #2, 02 — every sprint/release cycle).

**Acceptance criteria:**
- Given a TestCase that's in scope for an active TestCycle (per PLAN-3), when a user with `test_execution.create` permission records a result, then a TestExecution row is created with `executed_by_actor_id` (human or AI agent, via the shared Actor model) and `executed_at` timestamp.
- Given a TestCycle, its dashboard shows pass/fail/blocked/skipped counts aggregated live from TestExecution rows — not a manually maintained summary.
- Re-running the same TestCase within the same TestCycle creates a new TestExecution row (history preserved), not an overwrite of the prior result.

---

## Story EXEC-2: Append-only test log

**As** Marcus (regulated compliance QA manager),
**I want** every status change, comment, attachment, or agent action related to a TestExecution recorded as an immutable, timestamped log entry,
**so that** I have an audit-grade chronological record, not just a current-status field an auditor can't verify wasn't edited after the fact (07 design principle #4: "ISTQB's 'test log' is a chronological record... audits want an immutable history, not just current status").

**Acceptance criteria:**
- Given a TestExecution, when its result is later changed (e.g., corrected from pass to fail), when a comment is added, or when an agent takes an action against it, then a TestLog row is appended (`event_type`, `payload`, `logged_at`) — the prior TestExecution state is not overwritten, only superseded by a newer log entry.
- TestLog rows are immutable once written (no update/delete endpoint exists for TestLog — enforced at the API layer, not just by convention).
- A TestExecution's full history is viewable as an ordered TestLog timeline, separate from its current-state fields.

---

## Story EXEC-3: Raise a defect from a failed execution

**As** Priya,
**I want** to raise a Defect directly from a failed TestExecution, linked to that execution and (via `TestCaseDefectLink`) traceable back to the TestCase and Requirement,
**so that** I can give developers full context (which test, which requirement, what actually happened) without re-explaining it in a separate bug tracker with no link back (Job #3, 02).

**Acceptance criteria:**
- Given a TestExecution with result `fail`, when a user creates a Defect (external_ref, severity, status) from it, then the Defect is linked to that TestExecution (`reported_by_actor_id` recorded) and, via `TestCaseDefectLink`, traceable to the originating TestCase.
- Given a Defect, its `external_ref` field supports linking to an external bug tracker id (Jira/GitHub/GitLab) without requiring a live integration for this scaffold — plain text/URL reference is sufficient for v1.
- A TestCase's detail view shows all Defects ever raised against any of its executions, most recent first.
