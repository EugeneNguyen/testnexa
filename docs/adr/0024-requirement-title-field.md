# ADR-0024: `Requirement.title` schema gap-fill + inclusion in generic-CRUD search

**Date:** 2026-09-05
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [FR-REQ-1](../requirements/2026-09-03-project-scaffold-requirements.md#24-requirement--test-case-authoring--requirement-testcase-authoring-storiesmd) (the requirement this ADR closes a gap against), [TC-REQ-001/002](../test-cases/2026-09-03-test-cases.md#requirement--test-case-authoring), [Database Document §3.6](../database/2026-09-03-database-design.md#36-assetspy--requirement-testcondition-testcase-teststep-testsuite--junction), [API Document §3](../api/2026-09-03-api-design.md#3-generic-crud-routes-router-factory-adr-0022), [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD router factory — the `search_fields`/`?q=` mechanism this ADR reuses, not extends), [REQ-1 plan](../superpowers/plans/2026-09-05-req-1-capture-requirement-plan.md)

## Context

`docs/user-stories/2026-09-03-requirement-testcase-authoring-stories.md`'s REQ-1 acceptance criteria, `FR-REQ-1`, and `TC-REQ-001`/`TC-REQ-002` have all specified a `title` field on `Requirement` since 2026-09-03. The physical schema never carried one: `Requirement` (`backend/app/models/assets.py`, migrated in `fbf02a6e4764_initial_schema.py`) has only `project_id`, `external_ref`, `description`, `source` — no `title` column, and `CreateRequirementRequest`/`UpdateRequirementRequest`/`RequirementSummary` (added later by API-1/ADMIN-2's generic-CRUD schemas, `backend/app/schemas/assets.py`) inherited the same gap. This was caught during REQ-1's own implementation planning, not by a prior story — no earlier ADR ever decided "Requirement has no title," it's a plain oversight in the original 07 ERD → Database Document transcription that nothing since has needed to notice, since REQ-1 (the first story to actually build Requirement's create/list routes) is the first to require the field to exist.

## Decision

Add `title: varchar, not null` to `Requirement` via a new Alembic migration, and thread it through the existing generic-CRUD surface ADMIN-2 already built — no new routes, no new mechanism:

- `Requirement.title` — non-nullable, no default (existing rows, if any, must be backfilled or the migration run before any real data exists; this scaffold has shipped no production data, so a plain `nullable=False` add is sufficient here, not a two-step nullable-then-backfill-then-constrain migration).
- `CreateRequirementRequest.title: str` (required), `UpdateRequirementRequest.title: str | None = None` (partial-update, `exclude_unset` semantics — same posture every other optional `PATCH` field in this codebase already uses), `RequirementSummary.title: str`.
- `_REQUIREMENT_CONFIG.search_fields` gains `"title"` alongside the existing `("description", "external_ref", "source")` — `title` becomes one more `ILIKE`-matched column under the `?q=` parameter ADR-0022 already built, not a new search mechanism or a per-field-scoped variant of it. A caller cannot restrict `?q=` to title alone; a search term matches if it appears in *any* of the four columns, same as today's three-column behavior — this is an accepted, generic-factory-wide limitation (ADR-0022's own "the factory doesn't support scoping `?q=` to a subset" trade-off), not something this ADR re-opens.
- `filter_fields` stays `("external_ref",)` unchanged — `external_ref`'s existing exact-match filter already satisfies FR-REQ-1's "searchable... by external_ref" half; `title`'s substring-match need is satisfied by `search_fields`, not a new `filter_fields` entry.

## Consequences

**Positive:** Closes the only real implementation gap between REQ-1's long-ratified acceptance criteria and the schema — every other REQ-1 behavior (create, list, project-scoping, permission gating, 404-vs-403 boundary, cross-tenant isolation) was already fully delivered by API-1/ADMIN-2's generic CRUD factory before this ADR, since `Requirement` was already one of the 20 factory-served entities. No new backend mechanism, no new migration pattern, no new test infrastructure — `title` rides the exact rails ADR-0022 already built for every other string field.

**Negative / Trade-offs:** A one-column, single-field migration this late (after `Requirement`'s table, schemas, and generic routes already exist and are exercised by `test_admin2_crud.py`) is a visible seam — a straight-through implementation would have caught this at the original `07-erd-draft.md` → Database Document transcription step in 2026-09-03, not two stories later. Recorded here rather than silently folded into the original migration's history, per this repo's own "don't silently edit history" convention. `?q=` still can't be scoped to `title` alone if a future story needs "search *only* titles" — that remains ADR-0022's own accepted limitation, unchanged by this ADR.

## Alternatives considered

- **Reuse `description` as the de-facto "title," no schema change** — rejected: AC/FR-REQ-1/TC-REQ-001 all treat `title` and `description` as two distinct fields with two distinct purposes (a short label vs. free-text detail); collapsing them would fail TC-REQ-001's own literal request shape (`title`/`description`/`source`/`external_ref`, four fields) and TC-REQ-002's "search by title substring" (which would then be indistinguishable from searching `description`).
- **Nullable `title` with no backfill requirement** — rejected: every other required-at-creation string field in this codebase (`Project.name`, `TestCase.title` itself, `TestSuite.name`) is non-nullable; a nullable `Requirement.title` would be the one inconsistent field and would let `POST /requirements` silently create untitled rows the AC never contemplates.
- **New per-entity "scoped search" mechanism (`?title_q=` distinct from `?q=`)** — rejected as unjustified scope creep for this ADR: no story asks for title-only search today, and ADR-0022 already accepted the all-columns-OR'd `?q=` trade-off deliberately; revisit only if a future story explicitly needs field-scoped search across the generic factory, not as a one-off for `Requirement`.
