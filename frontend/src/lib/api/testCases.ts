/**
 * REQ-3 TestCase create call (ADR-0028 bespoke atomic-create route).
 *
 * Source: `app/api/routes/test_condition_authoring.py` /
 * `app/schemas/assets.py` (`CreateTestCaseForTestConditionRequest`,
 * `TestCaseSummary`) — same `apiFetch` conventions as `requirements.ts`.
 *
 * There is deliberately **no `listTestCases*` function here**: no backend
 * route lists TestCases by test condition (or at all — `TestCase` has no
 * factory-registered `list`, see `entityConfigs/test-case.ts`), so REQ-3's UI
 * renders no per-condition TestCase list. That's an explicit YAGNI call in
 * ADR-0028's design spec, not an omission.
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

export interface CreateTestCaseForTestConditionPayload {
  title: string;
  preconditions?: string;
  expected_result?: string;
  test_level_id: string;
  test_type_id: string;
}

/**
 * Create a TestCase under `testConditionId`, atomically linked to it
 * (`TestConditionTestCaseLink`) server-side. Resolves with the new case's
 * `TestCaseSummary`.
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
