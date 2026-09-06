/**
 * REQ-2 TestCase create/list calls — the direct-link path (ADR-0006, no
 * TestCondition involved).
 *
 * Source: `app/api/routes/assets.py` (bespoke `POST`/`GET
 * /requirements/{id}/test-cases`) / `app/schemas/assets.py`'s
 * `CreateTestCaseRequest`/`TestCaseSummary`/`TestCaseListResponse` — mirrors
 * `releases.ts`'s pattern: the parent id (`requirementId`) is a path
 * segment, not a body/query field, and org is resolved server-side.
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
