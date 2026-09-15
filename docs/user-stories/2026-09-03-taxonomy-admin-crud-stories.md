# User Stories — Taxonomy & Generic Admin CRUD

**Date:** 2026-09-03
**Feature area:** TestDesignTechnique, TestLevel, TestType (taxonomy lookups) + generic CRUD admin surface for all remaining entities
**Context:** [Personas](../personas/2026-09-03-target-personas.md), [07-erd-draft.md](../product-discovery/07-erd-draft.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md) (generic CRUD + bespoke workflow screens decision)

---

## Story ADMIN-1: Classify a test case by design technique, level, and type

**As** Marcus (regulated compliance QA manager),
**I want** to tag a TestCase with the ISTQB design technique it was built with (equivalence partitioning, BVA, decision table, etc.), its TestLevel (component/integration/system/acceptance), and TestType (functional/non-functional/structural/change-related),
**so that** I can report "% of test cases using a documented design technique" — a report 07 notes no competitor in this research offers.

**Acceptance criteria:**
- Given the seeded `TestDesignTechnique`, `TestLevel`, `TestType` lookup tables (ISTQB CTFL v4.0.1 vocabulary, seeded via Alembic data migration), when a user edits a TestCase, then they can select one TestLevel, one TestType, and zero-or-more TestDesignTechniques from dropdowns/multi-select — not free-text fields. **Status (2026-09-13, two independently-landed same-day stories): `TestLevel` ships via ADMIN-5/[ADR-0066](../adr/0066-admin-5-seed-test-level-catalog.md); `TestType` ships via [ADR-0067](../adr/0067-testtype-catalog-default-seed.md) — this AC's precondition now holds for both dropdowns. `TestDesignTechnique` remains unseeded, the one still-open piece of this AC.**
- Given a Project, a report view shows "% of test cases with at least one TestDesignTechnique assigned," filterable by TestSuite/TestPlan.

---

## Story ADMIN-2: Generic CRUD admin for all remaining entities

**As** Marcus or Priya, acting as `org_admin` or `test_manager`,
**I want** a generic list/create/edit/delete screen for every entity that doesn't have a bespoke workflow screen (Role, Permission, Environment, TestDesignTechnique, TestLevel, TestType, and any other entity not covered by a dedicated workflow),
**so that** every one of the 28 ERD entities is manageable through the UI without every entity needing a hand-built screen (scaffold design decision: generic schema-driven CRUD + bespoke workflow screens only where needed).

**Acceptance criteria:**
- Given any entity with a registered field-config (per the scaffold design's `entityConfigs/`), when a user with the corresponding `<entity>.read` permission navigates to its admin page, then a paginated, filterable list renders driven entirely by that config — no entity-specific component code required to add a new entity to this surface. **Status (2026-09-15, [ADR-0072](../adr/0072-entity-table-filter-modal.md)/ENTITY-FILTER-1): the "filterable" half of this AC was silently false for most of this surface's life and now holds properly.** Two separate gaps, both closed by that ADR: the per-column filter row this AC's own UI Design Document specified was dropped by an early refactor and never replaced (`EntityTable` kept declaring `filters`/`onFilterChange` props it never rendered, so exact-match filters were reachable only by hand-editing a query string), *and* the backend allow-list those filters drew from was a per-entity opt-in only **7 of 27** registered entities ever declared — so even a working control would have been empty on the other 20. The list surface now carries a header "Filter" button and modal, and the allow-list is derived from the served schema (every field except type `text`) rather than hand-declared per entity. Pagination and the `?q=` search box were unaffected throughout.
- Given create/edit forms rendered from the same config, field types (string, enum, FK reference, date) render appropriate inputs (text, select, FK-lookup autocomplete, date picker) automatically.
- Permission checks on this generic surface use the same `require_permission` dependency as every bespoke route (RBAC-3) — the generic UI is not a bypass of RBAC, it's a thin rendering layer over the same permission-checked API.
- Given an entity the current user lacks `<entity>.create`/`.update`/`.delete` permission for, the corresponding action buttons are hidden/disabled, and the underlying API rejects the action regardless (UI hiding is a UX convenience, not the enforcement boundary).
