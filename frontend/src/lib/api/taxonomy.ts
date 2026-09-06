/**
 * Global taxonomy-catalog reads (`TestLevel`, `TestType`) for bespoke
 * workflow screens that need to populate a `<select>` — REQ-2's and REQ-3's
 * "New Test Case" forms are both callers (`TestCase.test_level_id`/
 * `test_type_id` are required non-nullable FKs regardless of which
 * atomic-create path produces the row, unrelated to ADR-0006's
 * TestCondition-optional lightweness).
 *
 * These are **thin named wrappers over the existing generic
 * `listEntities()` helper** (`lib/api/entityCrud.ts`) plus the existing
 * `entityConfigs/test-level.ts` / `entityConfigs/test-type.ts` configs, not a
 * second hand-rolled `apiFetch` path per catalog — the generic helper already
 * builds `GET /api/v1/test-levels` / `GET /api/v1/test-types` correctly, and
 * `FkAutocomplete` sets the precedent of reusing it outside the generic admin
 * pages. What this module adds on top is a concrete row type (`{id, name}`)
 * and a stable, greppable name for bespoke callers, so a workflow screen
 * doesn't have to import `entityConfigs` just to fill a dropdown.
 *
 * Neither catalog is org- or project-scoped (API Document §4 shape A), so
 * these take no scope argument. Both return the backend's first page, whose
 * `page_size` is capped at 25 (`crud_factory.clamp_pagination`) — fine for a
 * taxonomy catalog of a handful of ISTQB test levels/types; a catalog that
 * ever outgrows one page needs real pagination here, not a bigger constant.
 */
import testLevelConfig from "../../entityConfigs/test-level";
import testTypeConfig from "../../entityConfigs/test-type";
import { listEntities, ListEnvelope } from "./entityCrud";

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
  return listEntities<TestLevelSummary>(testLevelConfig);
}

/**
 * `GET /test-types`. Rejects with an `ApiError` on `403` when the caller
 * lacks `test_type.read`.
 */
export async function listTestTypes(): Promise<ListEnvelope<TestTypeSummary>> {
  return listEntities<TestTypeSummary>(testTypeConfig);
}
