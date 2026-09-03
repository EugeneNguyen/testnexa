# User Stories — Traceability Matrix

**Date:** 2026-09-03
**Feature area:** Cross-entity RTM view over the join tables (RequirementTestCaseLink, RequirementTestConditionLink, TestConditionTestCaseLink, TestCaseDefectLink)
**Context:** [Personas](../personas/2026-09-03-target-personas.md), [Journeys](../user-journeys/2026-09-03-target-persona-journeys.md) (Marcus's journey — the traceability gap flagged at step 3), [07-erd-draft.md](../product-discovery/07-erd-draft.md)

---

## Story TRACE-1: View a requirement's full traceability chain

**As** Marcus (regulated compliance QA manager),
**I want** to see, for any Requirement, the full chain of TestConditions (if any) → TestCases → TestExecutions → Defects it's connected to, in one view,
**so that** "prove you tested requirement X" is answerable by pulling up a screen, not manually reconstructing links from memory across three tools (Job #4, 02 — this is the pain his whole persona is built around, 03 #10).

**Acceptance criteria:**
- Given a Requirement, when its detail view is opened, then it shows: directly-linked TestCases (via `RequirementTestCaseLink`), TestConditions linked to it (via `RequirementTestConditionLink`) and each TestCondition's own linked TestCases (via `TestConditionTestCaseLink`), and for every reachable TestCase, its most recent TestExecution result and any linked Defects.
- The view distinguishes which path each TestCase reached the Requirement through (direct link vs. via a TestCondition) — both are valid per REQ-2/REQ-3, and the UI should not silently collapse that distinction.
- Given a Requirement with no linked TestCases at all, the view clearly shows "0 test cases cover this requirement" rather than an empty/ambiguous state — this is itself a finding an auditor cares about.

---

## Story TRACE-2: Project-level traceability matrix export

**As** Marcus,
**I want** a tabular, exportable (CSV at minimum for this scaffold) view of every Requirement in a Project against its coverage status,
**so that** I can hand over or archive an audit artifact without building it by hand in Excel — the exact workaround pattern (Ketryx-style manual RTM-in-Jira) his persona currently relies on (11 Tier 2, 03 #10).

**Acceptance criteria:**
- Given a Project, when a user with `requirement.read`/RTM-export permission requests the traceability matrix, then a table is returned: one row per Requirement, columns for linked TestCase count, most recent execution status per linked TestCase, and open Defect count.
- The `auditor` system role (RBAC-4) has read + RTM-export permission and no write access at all — matches 07's explicit note that regulated buyers specifically ask for a read-only auditor role.
- CSV export is available from this view; richer document-format export (IEEE 829 style) is explicitly out of scope for this story (see scaffold design's "out of scope" section) and would be its own future story.
