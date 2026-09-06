/**
 * Taxonomy read calls — `TestLevel`/`TestType` global catalogs (ADR-0022),
 * needed as `<select>` options for REQ-2's "New Test Case" form
 * (`TestCase.test_level_id`/`test_type_id` are required non-nullable FKs,
 * unrelated to ADR-0006's TestCondition-optional lightweness).
 *
 * Source: `app/api/routes/taxonomy.py` / `app/schemas/taxonomy.py`. No
 * `org_id`/`project_id` scope — these are global catalogs, gated via
 * `has_permission_in_any_org` server-side, same as every other global-catalog
 * list route.
 */
import { apiFetch } from "./client";

export interface TestLevelSummary {
  id: string;
  name: string;
}

export interface TestTypeSummary {
  id: string;
  name: string;
}

export interface TestLevelListResponse {
  items: TestLevelSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface TestTypeListResponse {
  items: TestTypeSummary[];
  total: number;
  page: number;
  page_size: number;
}

/** List every TestLevel in the catalog (global, unpaginated in practice — small lookup table). */
export async function listTestLevels(): Promise<TestLevelListResponse> {
  return apiFetch<TestLevelListResponse>("/api/v1/test-levels");
}

/** List every TestType in the catalog (global, unpaginated in practice — small lookup table). */
export async function listTestTypes(): Promise<TestTypeListResponse> {
  return apiFetch<TestTypeListResponse>("/api/v1/test-types");
}
