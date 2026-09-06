/**
 * TestCase create/list calls — REQ-2's direct-link path (ADR-0006, no
 * TestCondition involved) and REQ-3's TestCondition-mediated rigor path
 * (ADR-0028's bespoke atomic-create route), which coexist per-TestCase
 * within a project (ADR-0006).
 *
 * Source: `app/api/routes/assets.py` (bespoke `POST`/`GET
 * /requirements/{id}/test-cases`, REQ-2) / `app/api/routes/test_condition_authoring.py`
 * (bespoke `POST /test-conditions/{id}/test-cases`, REQ-3) /
 * `app/schemas/assets.py`'s `CreateTestCaseRequest`/
 * `CreateTestCaseForTestConditionRequest`/`TestCaseSummary`/
 * `TestCaseListResponse` — mirrors `releases.ts`'s pattern: the parent id
 * (`requirementId`/`testConditionId`) is a path segment, not a body/query
 * field, and org is resolved server-side.
 *
 * There is deliberately **no `listTestCases*` function for the
 * TestCondition-mediated path**: no backend route lists TestCases by test
 * condition (or at all via the generic factory — `TestCase` has no
 * factory-registered `list`, see `entityConfigs/test-case.ts`), so REQ-3's UI
 * renders no per-condition TestCase list. That's an explicit YAGNI call in
 * ADR-0028's design spec, not an omission. `listTestCasesForRequirement`
 * below covers REQ-2's direct-link path only.
 */
import { apiFetch } from "./client";

export type TestCaseStatus = "draft" | "reviewed" | "approved" | "deprecated";

export interface TestCaseSummary {
  id: string;
  test_condition_id: string | null;
  test_level_id: string;
  test_type_id: string;
  created_by_actor_id: string;
  title: string;
  preconditions: string | null;
  expected_result: string | null;
  status: TestCaseStatus;
}

export interface CreateTestCasePayload {
  title: string;
  test_level_id: string;
  test_type_id: string;
  preconditions?: string | null;
  expected_result?: string | null;
  status?: TestCaseStatus;
}

export interface CreateTestCaseForTestConditionPayload {
  title: string;
  preconditions?: string;
  expected_result?: string;
  test_level_id: string;
  test_type_id: string;
}

export interface TestCaseListResponse {
  items: TestCaseSummary[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Create a TestCase directly under Requirement `requirementId`, linked via
 * `RequirementTestCaseLink` — `test_condition_id` always comes back `null`
 * (ADR-0006's lightweight path, REQ-2). Resolves with the new TestCase's
 * `TestCaseSummary` on success.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no
 * membership in the requirement's org (NFR-1) or the requirement doesn't
 * exist, `403 permission_denied` if they're a member but lack
 * `test_case.create`, `422` on a missing/invalid field (e.g. no
 * `test_level_id`).
 */
export async function createTestCase(
  requirementId: string,
  payload: CreateTestCasePayload,
): Promise<TestCaseSummary> {
  return apiFetch<TestCaseSummary>(`/api/v1/requirements/${requirementId}/test-cases`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Create a TestCase under `testConditionId`, atomically linked to it
 * (`TestConditionTestCaseLink`) server-side (REQ-3, ADR-0028). Resolves with
 * the new case's `TestCaseSummary`.
 *
 * `test_condition_id` is absent from the body (stamped from the path),
 * and so are `status` (always `draft`) and `created_by_actor_id` (stamped
 * from the calling actor) — the schema simply doesn't accept them.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no
 * membership in the condition's org (NFR-1) or the condition doesn't exist,
 * `403 permission_denied` if they're a member but lack `test_case.create`,
 * `422` on a missing/invalid field or an unknown `test_level_id`/
 * `test_type_id` (FK violation surfaced as 422).
 */
export async function createTestCaseForTestCondition(
  testConditionId: string,
  payload: CreateTestCaseForTestConditionPayload,
): Promise<TestCaseSummary> {
  return apiFetch<TestCaseSummary>(`/api/v1/test-conditions/${testConditionId}/test-cases`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * List TestCases directly linked to Requirement `requirementId` (REQ-2's
 * direct-link path only — TestCondition-mediated TestCases, REQ-3, aren't
 * included here).
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `createTestCase`, gated on `test_case.read`.
 */
export async function listTestCasesForRequirement(requirementId: string): Promise<TestCaseListResponse> {
  return apiFetch<TestCaseListResponse>(`/api/v1/requirements/${requirementId}/test-cases`);
}
