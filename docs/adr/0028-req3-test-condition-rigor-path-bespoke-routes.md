# ADR-0028: REQ-3 TestCondition rigor-path bespoke routes, generic-create restriction, `test_manager` RBAC extension

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [FR-REQ-3](../requirements/2026-09-03-project-scaffold-requirements.md#24-requirement--test-case-authoring), [ADR-0005](0005-traceability-link-dedicated-join-tables.md) (dedicated link tables), [ADR-0006](0006-test-condition-optional.md) (TestCondition optional), [ADR-0022](0022-generic-crud-router-factory.md) (generic factory this ADR extends and partially restricts), [ADR-0019](0019-release-creation-flow.md) (precedent for a bespoke-route + `test_manager` RBAC-bundle-extension pair), [ADR-0025](0025-requirement-title-field.md) (precedent for a small, targeted gap-fill ADR), [ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md) (frontend `entityConfigs`/`usePermissions` surface this ADR's restriction must stay in sync with), [Database Document §3.6/§3.9](../database/2026-09-03-database-design.md), [API Document §3/§4](../api/2026-09-03-api-design.md), [design spec](../superpowers/specs/2026-09-05-req-3-test-condition-rigor-path-design.md).

## Context

`docs/api/2026-09-03-api-design.md` §4 already planned two bespoke routes for FR-REQ-3 (`POST /requirements/{id}/test-conditions`, `POST /test-conditions/{id}/test-cases`), atomically creating an entity row plus its corresponding dedicated link-table row (ADR-0005). Neither was built. Schema, migrations, and RBAC permission codes (`test_condition.*`, `test_case.*`) for both already existed from the initial migration and RBAC-4's seed catalog.

Two gaps surfaced while implementing this story, both decided here:

1. **The generic factory's existing `POST /test-conditions` (ADR-0022) never wrote the link table.** `TestCondition` was registered with full CRUD (`create` included) via `make_crud_router()`, which only ever inserts the entity's own row — it has no concept of a second, dedicated link-table insert. Calling this route today produces a `TestCondition` with its own `requirement_id` FK column set, but no corresponding `RequirementTestConditionLink` row, silently breaking FR-REQ-3 AC1's traceability claim for anyone who used it instead of the (unbuilt, until this ADR) bespoke route. `TestCase` was already excluded from the factory's `create` for exactly this class of reason (API Document §3 footnote); `TestCondition` was not, which is the actual gap, not a deliberate choice — no test in the codebase exercises `POST /test-conditions` over HTTP, confirming nothing already depends on the two-path behavior.
2. **`test_manager`'s seeded RBAC bundle grants `test_condition.read`/`test_case.read` but not `.create`** (`app/db/rbac_seed_catalog.py`). Marcus — REQ-3's own persona, a regulated compliance QA manager — reaches this story's routes only if he also holds `tester` or `org_admin`, which the story's text doesn't ask for. This mirrors the exact shape ADR-0019 already fixed once for `test_manager`/`release.*`: a role bundle that was seeded before the story needing it existed, discovered incomplete only once that story's own routes were built.

## Decision

### Two new bespoke, atomic-create routes

```
POST /requirements/{id}/test-conditions   (test_condition.create)
  -> INSERT TestCondition(requirement_id=id, description, priority)
  -> INSERT RequirementTestConditionLink(requirement_id=id, test_condition_id=new.id)

POST /test-conditions/{id}/test-cases   (test_case.create)
  -> INSERT TestCase(test_condition_id=id, test_level_id, test_type_id, title,
                      preconditions?, expected_result?, status=draft,
                      created_by_actor_id=<calling actor>)
  -> INSERT TestConditionTestCaseLink(test_condition_id=id, test_case_id=new.id)
```

Both routes are path-scoped (fetch the parent row first, resolve `org_id` via the existing `chain_resolver` helpers already built for `_TEST_CONDITION_CONFIG`/`resolve_test_case_org_id`, apply the standard 404-vs-403 `OrgMembership` boundary, then `has_permission` directly) — same shape as every other bespoke route in this codebase (`POST /projects/{project_id}/releases`, PROJ-2/ADR-0019). Each write is one DB transaction: entity row + link row both flush/commit together, so a link row is never created without its entity (or vice versa). New request schemas carry only the fields not already implied by the path (no `requirement_id`/`test_condition_id` in the body). Both live in a new module, `app/api/routes/test_condition_authoring.py`, kept separate from `assets.py` (generic-CRUD-only, per its own docstring).

### Restrict the generic factory's `TestCondition` create

`_TEST_CONDITION_CONFIG.methods` narrows to `{"list", "get", "update", "delete"}`, `create_schema` drops to `None` — identical posture to `_TEST_CASE_CONFIG`'s existing exclusion, for the identical reason (API Document §3 footnote, extended). This is a restriction, not a deprecation with a grace period: no test or shipped frontend flow depends on the two-path behavior today, so there's no migration window to design. The frontend's `entityConfigs/test-condition.ts` (ADR-0027) mirrors the backend's `methods` array 1:1 and is updated in lockstep — its `"create"` entry is removed, or the generic admin surface would show a "New" button calling a route that no longer accepts `POST`.

### `test_manager` RBAC bundle extension

`test_manager`'s bundle (`app/db/rbac_seed_catalog.py`) gains `test_condition.create`/`.update`/`.delete` and `test_case.create`/`.update`/`.delete` — full parity with `tester`'s existing bundle for both resources, `test_manager` already having `.read` on both. A new, idempotent (existence-check-then-insert) Alembic data migration backfills `role_permission` rows for already-seeded `test_manager` roles, mirroring `b7f3a1c9d2e4_add_project_permissions_to_test_manager`'s shape verbatim.

## Consequences

**Positive:** Closes a real, previously-undetected traceability gap (`TestCondition` creation without its link row) before any code path could depend on the broken behavior. Marcus's own persona can now execute this story's full acceptance criteria without an extra, unasked-for role grant. The two new routes reuse 100% of ADR-0022's existing resolver/permission-check primitives — no new backend architecture.

**Negative / accepted trade-offs:** `TestCondition` now has a narrower generic-CRUD surface than `TestSuite`/`TestStep` (its siblings in `assets.py`), which is a real asymmetry for anyone skimming the factory's entity list expecting uniform coverage — accepted because the alternative (leaving two divergent creation paths, one of them silently link-less) is strictly worse. `RequirementDetail` was reserved as a future dedicated page in the Sitemap (2026-09-05) for exactly this story's scope; this ADR instead extends `ProjectDetail`'s existing inline Requirement section (matching what REQ-1 actually shipped, not the reservation) — see the [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md)'s own correction note.

## Alternatives considered

- **Leave the generic `POST /test-conditions` create route in place alongside the new bespoke one** — rejected: two ways to create the same entity, only one of them correct, is a defect surface, not a feature; nothing in this codebase or its tests relies on the generic path today, so removing it costs nothing.
- **Fold the link-table insert into the generic factory's `create_item` itself** (e.g. a per-entity "also insert this link row" config field) — rejected: would need bespoke per-entity wiring inside code the factory's own docstring describes as deliberately generic (no per-entity mapping function), and every other atomic-create-plus-link case in this codebase (`TestCase`+`RequirementTestCaseLink`/`TestConditionTestCaseLink`, `Defect`+`TestCaseDefectLink`) is already handled as a bespoke route, not a factory extension — consistency with that established pattern outweighs saving one small route file.
- **Build a dedicated `RequirementDetail` page** (per the Sitemap's 2026-09-05 reservation) instead of extending `ProjectDetail` — rejected: REQ-1 already shipped its own Requirement list/create UI inline on `ProjectDetail`, not on a separate page; introducing a new page now for TestCondition/TestCase authoring would split one Requirement's UI across two screens for no user-facing benefit.
