# REQ-1: Capture a Requirement — Plan

**Date:** 2026-09-05
**Story:** [REQ-1](../../user-stories/2026-09-03-requirement-testcase-authoring-stories.md#story-req-1-capture-a-requirement)
**Related:** [ADR-0022](../../adr/0022-generic-crud-router-factory.md) (generic CRUD factory — delivers almost all of this story already), [ADR-0025](../../adr/0025-requirement-title-field.md) (the one real gap this story closes), [Database Doc §3.6](../../database/2026-09-03-database-design.md), [API Doc §3](../../api/2026-09-03-api-design.md)

## Decisions (confirmed with user, 2026-09-05)

All Q1–Q5 below confirmed as proposed — assumptions/suggestions in each are the final design, no changes.

## Open questions (resolved, kept for rationale)

**Q1 — `title` column doesn't exist.** AC, FR-REQ-1, and TC-REQ-001/002 all require a `title` field and title search, but `Requirement`'s schema had no such column (only `description`/`source`/`external_ref`).
- **Assumption/suggestion:** add `title: varchar, not null` via a new Alembic migration + update the `Requirement` model, `CreateRequirementRequest`/`UpdateRequirementRequest`/`RequirementSummary`, Database Doc §3.6. Confirmed real schema gap, not a doc typo. See [ADR-0025](../../adr/0025-requirement-title-field.md).

**Q2 — Title search vs. API conventions.** API Doc §1 originally said v1 filtering is exact-match only, no `contains`; AC/TC-REQ-002 explicitly want title *substring* search.
- **Assumption/suggestion:** by the time this story reached implementation, ADR-0022 had already generalized `?q=` into a per-entity opt-in substring-search mechanism (`search_fields`, `ILIKE '%term%'`, OR'd across configured columns) — API Doc §1 already carries that revision. `title` simply joins `Requirement`'s existing `search_fields` set (`description`, `external_ref`, `source`) as a fourth column; no new mechanism, no per-field-scoped exception needed.

**Q3 — Route shape / project scoping.** Confirmed: **already built.** API-1/ADMIN-2 (merged into `main` ahead of this story's implementation) made `Requirement` one of the 20 generic-CRUD-factory-served entities — `POST`/`GET /requirements`, `GET`/`PATCH`/`DELETE /requirements/{id}` all exist, `project_id` travels in the body (create) / as a required query param (list), org resolved via `Project.org_id` directly (`chain_resolver([])`), 404-vs-403 boundary and permission gating both generic. This story's worktree was rebased onto `main` specifically to pick this up rather than hand-rolling bespoke routes.

**Q4 — Permission-check `project_id` exclusivity bug.** `has_permission(..., project_id=X)` requires an *exact* project-scoped `RoleAssignment` match — it does not OR against org-wide grants. Flagged during REQ-1 planning as a risk if Requirement routes were built bespoke and passed `project_id` into the check.
- **Resolution:** moot — the generic factory's item routes call `has_permission` without a `project_id` argument for direct-scope entities like `Requirement` (org-wide check only, same posture PROJ-1 established), so this bug is not triggered by REQ-1. Left as a separately-tracked, pre-existing concern (not fixed by this story, not re-opened here).

**Q5 — `test_manager`/`tester` lack `requirement.create`.** Confirmed: only `org_admin`'s seeded bundle holds `requirement.create` today; no migration (RBAC-4 through the ADMIN-2 merge) has ever extended it to `test_manager`/`tester`.
- **Assumption/suggestion:** leave RBAC-4's seeded bundles untouched — same call PROJ-1's own Q2 made for `project.create`. Flagged as a known UX gap for Priya's (non-admin) persona, not fixed by this story.

---

## What already exists (do not rebuild)

- `Requirement` model + table (`backend/app/models/assets.py`, `fbf02a6e4764_initial_schema.py`): `id`, `project_id` (FK, not null, indexed), `external_ref` (nullable), `description` (not null), `source` (nullable).
- Full generic CRUD for `Requirement` via `make_crud_router` (ADR-0022, `backend/app/api/routes/assets.py`): `GET/POST /requirements`, `GET/PATCH/DELETE /requirements/{id}` — 404-vs-403 boundary, `requirement.create/.read/.update/.delete` permission gating, `project_id` scope-field enforcement (422 if missing) all already wired.
- Search: `filter_fields=("external_ref",)` (exact match), `search_fields=("description","external_ref","source")` (`?q=` → ILIKE substring, OR'd).
- `requirement.create/.read/.update/.delete` permission codes seeded (RBAC-4); only `org_admin` holds `.create` (Q5).

## Scope (this story's actual remaining work)

1. **Migration** — add `title: varchar, not null` to `requirement` table ([ADR-0025](../../adr/0025-requirement-title-field.md)).
2. **`backend/app/models/assets.py`** — add `title: Mapped[str]` to `Requirement`.
3. **`backend/app/schemas/assets.py`** — add `title: str` to `CreateRequirementRequest`, `title: str | None = None` to `UpdateRequirementRequest`, `title: str` to `RequirementSummary`.
4. **`backend/app/api/routes/assets.py`** — `_REQUIREMENT_CONFIG.search_fields` → add `"title"`.
5. **Docs** (this pass) — Requirements Document, WBS, ADR-0025 + index, Database Document §3.6, API Document §3, Test Cases (stale cross-references), all updated 2026-09-05.
6. **Tests** — unit: `title` required-on-create/optional-on-update schema validation; integration: extend `test_admin2_crud.py`'s Requirement coverage (or a new `test_requirements.py`) for TC-REQ-001 (create with title/description/source/external_ref) and TC-REQ-002 (search by title substring, by external_ref).
7. **Frontend** — none required by AC; skipped (YAGNI), no UI story attached to REQ-1.

## Edge cases

- Empty/whitespace `title` → `422` (plain Pydantic `str`, same non-empty-by-convention posture every other required string field in this codebase already uses — not a stricter `min_length` rule singling this field out).
- `?q=` search matches `title` OR `description` OR `external_ref` OR `source` (existing OR-across-`search_fields` behavior, ADR-0022) — AC only names title/external_ref, but the factory can't scope `?q=` to a subset; accepted per ADR-0025's Alternatives.
- Cross-tenant `project_id`, missing `requirement.create`, non-member org — all already handled generically by the factory, no new code path.

## Out of scope

- RBAC bundle changes (Q5).
- Scoping `?q=` to a subset of `search_fields` (ADR-0022's own accepted limitation, not re-opened by ADR-0025).
- Frontend UI.
