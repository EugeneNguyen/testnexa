# User Stories — Project & Release Management

**Date:** 2026-09-03
**Feature area:** Project, Release
**Context:** [Personas](../personas/2026-09-03-target-personas.md), [07-erd-draft.md](../product-discovery/07-erd-draft.md)

---

## Story PROJ-1: Create a project

**As** Priya (self-hosted OSS QA lead),
**I want** to create a Project within my Organization,
**so that** test assets for different products/codebases her team owns stay organized separately, each optionally with its own standards profile (07's `Project.standards_profile`).

**Acceptance criteria:**
- Given an authenticated user with `project.create` permission in an org, when they create a Project with a name, then it's scoped to that org (`org_id`) and the creator is auto-assigned a project-scoped role appropriate to their action (e.g., `test_manager` if they're already `org_admin`).
- Given a Project, when any Requirement/TestSuite/TestPlan is created, then it must reference that Project — no orphaned test assets outside a Project.
- `Project.standards_profile` is a free-text/enum field (e.g., "ISTQB-CTFL-v4.0.1 + ISO29119-3") settable at creation, editable later by anyone with `project.update`.

---

## Story PROJ-2: Create a release and target test cycles to it

**As** Marcus (regulated compliance QA manager),
**I want** to define a Release with a version label and target date, and later associate TestCycles with it,
**so that** I can answer "what was tested for release 2.3" as a defined, queryable unit — the basis for audit evidence (Job #2/#4, 02).

**Acceptance criteria:**
- Given a Project, when a user with `release.create` permission creates a Release (`version_label`, `target_date`), then it's scoped to that Project.
- Given a Release, when a TestCycle is created and linked to it (`TestCycle.release_id`), then querying "test cycles for release X" returns all cycles targeting that release, and transitively all TestExecutions within those cycles.
- Releases are listable/sortable by target date within a Project.
