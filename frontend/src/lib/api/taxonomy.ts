/**
 * Global taxonomy-catalog reads (`TestLevel`, `TestType`) for bespoke
 * workflow screens that need to populate a `<select>` — REQ-2's and REQ-3's
 * "New Test Case" forms are both callers (`TestCase.test_level_id`/
 * `test_type_id` are required non-nullable FKs regardless of which
 * atomic-create path produces the row, unrelated to ADR-0006's
 * TestCondition-optional lightweness).
 *
 * These are **thin named wrappers over the existing generic
 * `listEntities()` helper** (`lib/api/entityCrud.ts`), not a second
 * hand-rolled `apiFetch` path per catalog — the generic helper already builds
 * `GET /api/v1/test-levels` / `GET /api/v1/test-types` correctly, and
 * `FkAutocomplete` sets the precedent of reusing it outside the generic admin
 * pages. What this module adds on top is a concrete row type (`{id, name}`)
 * and a stable, greppable name for bespoke callers, so a workflow screen
 * doesn't have to know anything about entity configs just to fill a dropdown.
 *
 * Neither catalog is org- or project-scoped (API Document §4 shape A), so
 * these take no scope argument. Both return the backend's first page, whose
 * `page_size` is capped at 25 (`crud_factory.clamp_pagination`) — fine for a
 * taxonomy catalog of a handful of ISTQB test levels/types; a catalog that
 * ever outgrows one page needs real pagination here, not a bigger constant.
 *
 * --- ADR-0053: why this module does NOT fetch a schema ----------------------
 *
 * Until ADR-0053 these two calls passed `entityConfigs/test-level.ts` /
 * `entityConfigs/test-type.ts` straight to `listEntities()`. Those files are
 * gone, and the obvious replacement — `useEntitySchema("test-levels")` — is a
 * React hook, which this module cannot call: it is a plain API-lib module with
 * no component, no render, and no hook context (the Rules of Hooks make that
 * structural, not a style preference).
 *
 * It also doesn't need one. `listEntities()` reads exactly four keys off the
 * config it is handed — `path`, `listPath`, `createPath`, `methods` — and only
 * the first is relevant to an unscoped, unfiltered, unparameterised list call.
 * What these two functions need is **routing** (which URL), not **field
 * shape** (which columns), and routing is precisely the half ADR-0053 kept
 * frontend-static in `entityConfigs/overrides.ts`. So each builds a minimal
 * local descriptor from `pathFor()` instead — a fetch here would add a network
 * round-trip and an async failure mode purely to re-derive a string this
 * module already knows.
 */
import { pathFor } from "../../entityConfigs/overrides";
import type { EntityConfig } from "../../entityConfigs/types";
import { listEntities, ListEnvelope } from "./entityCrud";

/**
 * The smallest thing `listEntities()` accepts: the route, plus the two keys
 * `EntityConfig` requires structurally but which this call path never reads.
 *
 * `fields: []` and `methods: []` are deliberately empty rather than guessed —
 * this descriptor makes no claim about the entity's shape or capabilities, and
 * anything that *does* need those must fetch the real schema
 * (`useEntitySchema`) rather than extend this. `resource` is kept accurate
 * (it's the backend permission-code segment) so a descriptor is still
 * identifiable if it ever surfaces in a log or a test assertion.
 */
function catalogRoute(resource: string, entityKey: string): EntityConfig {
  return { resource, path: pathFor(entityKey), methods: [], fields: [] };
}

const TEST_LEVEL_ROUTE = catalogRoute("test_level", "test-levels");
const TEST_TYPE_ROUTE = catalogRoute("test_type", "test-types");

export interface TestLevelSummary {
  id: string;
  name: string;
}

export interface TestTypeSummary {
  id: string;
  name: string;
}

/**
 * `GET /test-levels`. Rejects with an `ApiError` on `403` when the caller
 * lacks `test_level.read`.
 */
export async function listTestLevels(): Promise<ListEnvelope<TestLevelSummary>> {
  return listEntities<TestLevelSummary>(TEST_LEVEL_ROUTE);
}

/**
 * `GET /test-types`. Rejects with an `ApiError` on `403` when the caller
 * lacks `test_type.read`.
 */
export async function listTestTypes(): Promise<ListEnvelope<TestTypeSummary>> {
  return listEntities<TestTypeSummary>(TEST_TYPE_ROUTE);
}
