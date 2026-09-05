# API-1: Generic CRUD Router Factory — Plan

**Date:** 2026-09-05
**Related:** [ADR-0021](../../adr/0021-generic-crud-router-factory.md) (decisions/rationale), [API Doc §3](../../api/2026-09-03-api-design.md#3-generic-crud-routes-router-factory-applied-to-24-of-36-tables), [ADR-0017](../../adr/0017-project-creation-flow.md)/[ADR-0019](../../adr/0019-release-creation-flow.md) (bespoke-route precedent this factory generalizes)

## Decisions (confirmed with user, 2026-09-05)

- Q1 (approach): **A** — router-factory function (`make_crud_router()`), not base-class inheritance.
- Q2 (scope): all 20 entities in one pass, one factory.
- Q3 (Role mutation on `org_id IS NULL` system-role rows): **404**.
- Q4 (list filtering): exact-match by column **and** free-text search (`?q=`) across configured columns.
- Q5 (ADR): yes — [ADR-0021](../../adr/0021-generic-crud-router-factory.md).

## What already exists (do not rebuild)

- All ~100 RBAC permissions (`<resource>.create/.read/.update/.delete`) already seeded (`backend/app/db/rbac_seed_catalog.py`) for every `CRUD_RESOURCES` entry — zero new permission-catalog work.
- `has_permission`, `has_permission_in_any_org`, `get_current_actor`, the any-status-`OrgMembership` 404-vs-403 pattern, flush-then-catch-`IntegrityError`-for-422, the `{items, total, page, page_size}` list envelope — all reusable as-is (`app/core/rbac.py`, existing route modules).
- `Project` create/read/update (`app/api/routes/projects.py`) and all 4 `Release` routes (`app/api/routes/releases.py`) — untouched, factory only fills `Project`'s missing `DELETE`.
- `Organization` create (`app/api/routes/organizations.py` + `auth.py`'s signup) — untouched, factory only adds `GET`/`PATCH`/`DELETE /organizations/{id}`.
- Frontend already calls `GET /projects` and `GET /org-memberships` list routes (`frontend/src/lib/api/dashboard.ts`, SHELL-3 widgets) — currently 404 (retry disabled, f4047ef). This work makes both resolve; **no frontend change needed** for that alone (widget code already handles the existing envelope shape).

## Scope

### Backend

1. **`app/api/crud_factory.py`** (new) — the factory itself:
   - `CrudEntityConfig` dataclass (see ADR-0021 for the exact field list).
   - `chain_resolver(hops: list[tuple[type[Base], str]]) -> Callable` — builds a `resolve_org_id(db, row)` that walks parent FKs via `db.get`, terminating at a model with a direct `org_id` or `project_id` column (further resolving `project_id` → `Project.org_id` internally so every resolver ultimately returns an `org_id`, never a `project_id`).
   - `make_crud_router(config: CrudEntityConfig) -> APIRouter` — registers whichever of `list`/`get`/`create`/`update`/`delete` are in `config.methods`:
     - `list`: requires `?<scope_field>=` if `scope_field` is set (else `422`), applies `filter_fields`/`?q=` search, paginates, resolves org from the scope row, 404-vs-403, `has_permission(..., f"{resource}.read")`.
     - `get`/`update`/`delete`: fetch row by id, 404 if missing, resolve org via `resolve_org_id`, 404-vs-403 (or `has_permission_in_any_org` if `resolve_org_id` returns `None` — global catalog), `has_permission`, then the per-method body. `delete` catches `IntegrityError` (RESTRICT-blocked FK) → `409`, not `422` (distinct from validation failures) and not an unhandled 500.
     - `create`: requires scope field in body (validated by the entity's own `create_schema`, not the factory), resolves org from the scope value, 404-vs-403, `has_permission(..., f"{resource}.create")`, insert, flush-then-catch-`IntegrityError` → `422`.
   - Unit-testable without a DB: `chain_resolver`'s hop-walking logic and the query-param → filter-clause translation are pure enough to mock `db.get`/`db.execute` around (mirrors this codebase's existing unit/integration split, `CLAUDE.md`).

2. **`app/schemas/<cluster>.py`** (new, one file per model-file cluster, mirroring `app/models/` naming) — `Create*Request`/`Update*Request`/`*Summary`/`*ListResponse` per entity that doesn't already have schemas:
   - `schemas/assets.py`: `Requirement`, `TestCondition`, `TestCase`, `TestStep`, `TestSuite`.
   - `schemas/planning.py`: `TestPlan`, `EntryExitCriteria`, `Environment`, `TestCycle`.
   - `schemas/taxonomy.py`: `TestDesignTechnique`, `TestLevel`, `TestType`.
   - `schemas/governance.py`: `RiskItem`, `Attachment` (not `Approval` — no `create/update/delete` in `CRUD_RESOURCES`'s API surface beyond what FR-GOV-1's bespoke `/test-plans/{id}/approve` already owns; excluded from this pass, no AC asks for generic `Approval` CRUD).
   - `schemas/rbac.py`: `Role`, `RoleAssignment` (`Permission` reuses a plain read-only summary, no create/update schema needed).
   - Extend `schemas/organizations.py`/`schemas/org_memberships.py` only if a list/detail shape is missing for the factory's added methods (check both files first — `Organization`/`OrgMembership` likely already have most of what's needed from their existing bespoke routes).

3. **New route modules**, each: build a `CrudEntityConfig` per entity, call `make_crud_router()`, `router = APIRouter()` combining them (or one `APIRouter` per file with multiple `include_router`/`add_api_route` calls, matching the one-file-per-model-cluster split):
   - `app/api/routes/assets.py` — `Requirement`, `TestCondition`, `TestCase` (no `create`), `TestStep`, `TestSuite`.
   - `app/api/routes/planning.py` — `TestPlan`, `EntryExitCriteria`, `Environment`, `TestCycle` (no `create`).
   - `app/api/routes/taxonomy.py` — `TestDesignTechnique`, `TestLevel`, `TestType` (global-catalog resolver).
   - `app/api/routes/governance.py` — `RiskItem`, `Attachment`.
   - `app/api/routes/rbac_routes.py` (name avoids colliding with `app/core/rbac.py`) — `Role`, `Permission` (`list`/`get` only), `RoleAssignment`.
   - Extend `app/api/routes/organizations.py` — add factory `GET`/`PATCH`/`DELETE /organizations/{id}`.
   - Extend `app/api/routes/projects.py` — add factory `DELETE /projects/{id}` only.
   - Extend `app/api/routes/org_memberships.py` — add factory `GET`/`PATCH`/`DELETE /org-memberships/{id}` and `GET /org-memberships` list (verify no path collision with its existing bespoke `/orgs/{org_id}/members...` routes first — different path prefix, should be additive, not a conflict, but confirm before wiring).
   - `Defect` needs a home: add to `app/api/routes/execution.py` (new file, mirrors `app/models/execution.py`) — `create` excluded (bespoke `/executions/{id}/defects`, not built yet), `get`/`update`/`delete` only.

4. **`app/main.py`** — register all new/extended routers.

### Resolver map (per entity, ADR-0021's chain-resolver composition)

| Entity | `scope_field` (list/create) | `resolve_org_id` chain |
|---|---|---|
| `Requirement`, `TestSuite`, `Environment`, `TestPlan` | `project_id` | direct: `Project.org_id` |
| `TestCondition` | `requirement_id` | `Requirement.project_id` → `Project.org_id` |
| `EntryExitCriteria`, `TestCycle` | `test_plan_id` | `TestPlan.project_id` → `Project.org_id` |
| `RiskItem` | `requirement_id` OR `test_plan_id` (exactly one, per its `CHECK`) | bespoke resolver: branch on whichever is non-null, one hop to `project_id` |
| `TestCase` | n/a (no `create` via factory) | bespoke resolver: `test_condition_id` (if set) → `TestCondition.requirement_id` → `Requirement.project_id`; else any `TestSuiteTestCase` link → `TestSuite.project_id`; else `None` (orphaned, 404) |
| `TestStep` | `test_case_id` | `TestCase.*` (delegates to `TestCase`'s resolver) |
| `Attachment` | `test_case_id` | same, delegates to `TestCase`'s resolver |
| `Defect` | n/a (no `create` via factory) | `TestExecution.test_cycle_id` → `TestCycle.test_plan_id` → `TestPlan.project_id` → `Project.org_id` |
| `OrgMembership`, `Role`, `RoleAssignment` | `org_id` | direct column (Role: `None` if `org_id IS NULL` → 404 per Q3) |
| `Organization`, `Project` | n/a (id is itself the scope, or already bespoke) | `id` is `org_id` / direct `org_id` column |
| `TestDesignTechnique`, `TestLevel`, `TestType`, `Permission` | none | global — `has_permission_in_any_org` |

### Filter/search fields (initial set, extend later as needed)

- `Requirement`: filter `external_ref`; search `description`, `external_ref`, `source`.
- `TestCase`: filter `status`, `test_level_id`, `test_type_id`; search `title`, `preconditions`, `expected_result`.
- `Defect`: filter `severity`, `status`; search `external_ref`.
- `RiskItem`: filter `likelihood`, `impact`.
- Everything else: no `search_fields` initially (silently ignores `?q=`, per ADR-0021); `filter_fields` limited to obvious FK/enum columns per table, expand on demand rather than front-loading every column now.

### Tests

- **Unit** (`backend/tests/unit/test_crud_factory.py`): `chain_resolver` hop-walking (mocked `db.get`), query-param → filter/search clause building, pagination clamping — no DB.
- **Integration** (`backend/tests/integration/test_<cluster>_crud.py`, one per new route module): full CRUD happy path + 404-vs-403 boundary + `422` on bad scope/validation + `409` on RESTRICT-blocked delete, for at least one representative entity per resolver depth (direct, one-hop, branching, multi-hop, global-catalog) — not all 20 exhaustively in this pass; the factory itself is what's under test, not each entity's business rules.
- Confirm `docs/test-cases/` coverage for whichever FR/NFR this closes (API-1 itself has no story file yet — check whether one needs writing per `CLAUDE.md`'s "every FR/NFR traces to a test case" rule before calling this done).

## Edge cases (carried from ADR-0021, restated for implementation)

1. `TestCase` orphaned row (`test_condition_id IS NULL`, no `TestSuiteTestCase` link) → `resolve_org_id` returns `None` → factory treats as global-catalog-style (`has_permission_in_any_org`)? **No** — this is wrong for a genuinely tenant-owned row with no *resolvable* tenant; correct behavior is `404` (can't prove membership, same as a missing row) — factory must distinguish "config says global" (`resolve_org_id` statically `None`) from "this particular row's chain resolved to `None`" (still tenant-owned, just unreachable) and 404 the latter, not fall back to any-org.
2. `Role.org_id IS NULL` on `GET` (not just write) — decision needed at implementation time even though Q3 only asked about writes: leaning `has_permission_in_any_org` fallback for `GET` (system-role catalog needs to be readable for role-assignment UI) while `PATCH`/`DELETE` 404 — flag explicitly in the PR description since it's a read/write split Q3 didn't literally spell out.
3. `Attachment`'s `size_bytes`/`mime_type`/`url_or_path` — factory's generic `create` doesn't handle file upload itself (no multipart handling in this factory); `POST /attachments` accepts already-uploaded metadata only (`ATTACHMENT_STORAGE` upload mechanics are a separate, not-yet-built concern) — confirm this is acceptable scope before building `Attachment`'s create route, or exclude `create` for it too pending that story.
4. `org_memberships.py` route-path collision check (listed above) — must verify before wiring, not assumed.
5. `RiskItem` create with **both** `requirement_id` and `test_plan_id` set, or **neither** — the DB `CHECK` constraint catches "neither," but "both" is legal per the constraint (`OR`, not `XOR`); decide whether the factory's `create_schema` should reject "both" at the Pydantic/validation layer (422) before it reaches the DB, since the resolver's "branch on whichever is non-null" logic is ambiguous if both are set.

## Open items to resolve before/during implementation (not blocking this plan's approval, but flagged)

- Edge case 2 above (Role GET on system rows) — proposed default stated, not yet explicitly confirmed.
- Edge case 3 (Attachment create scope) — proposed default (metadata-only, no upload) stated, not yet explicitly confirmed.
- Edge case 5 (RiskItem both-FKs-set) — proposed default (422 reject "both") stated, not yet explicitly confirmed.
