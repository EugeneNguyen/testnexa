/**
 * REQ-2 TestStep create/list/update calls — generic-CRUD factory routes
 * (ADR-0022), scoped by `test_case_id`.
 *
 * Source: `app/api/routes/assets.py`'s `_TEST_STEP_CONFIG` /
 * `app/schemas/assets.py`'s `CreateTestStepRequest`/`TestStepSummary`/
 * `UpdateTestStepRequest`/`TestStepListResponse` — mirrors
 * `requirements.ts`'s pattern: `test_case_id` carried in the body on
 * create, as a required query param on list.
 */
import { apiFetch } from "./client";

export interface TestStepSummary {
  id: string;
  test_case_id: string;
  sequence: number;
  action: string;
  expected_result: string | null;
}

export interface CreateTestStepPayload {
  test_case_id: string;
  sequence: number;
  action: string;
  expected_result?: string | null;
}

export interface UpdateTestStepPayload {
  sequence?: number;
  action?: string;
  expected_result?: string | null;
}

export interface TestStepListResponse {
  items: TestStepSummary[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Create a TestStep under `payload.test_case_id`. Resolves with the new
 * step's `TestStepSummary` on success.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same tenant boundary as
 * every other generic-CRUD entity, gated on `test_step.create`; `422` on a
 * `(test_case_id, sequence)` collision (`uq_test_step_case_sequence`) or a
 * missing required field.
 */
export async function createTestStep(payload: CreateTestStepPayload): Promise<TestStepSummary> {
  return apiFetch<TestStepSummary>("/api/v1/test-steps", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * List TestSteps for `testCaseId`, ordered by `sequence` client-side (the
 * generic factory's `list` route has no `sort` param — callers sort the
 * returned `items` themselves).
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `createTestStep`, gated on `test_step.read`.
 */
export async function listTestSteps(testCaseId: string): Promise<TestStepListResponse> {
  const query = new URLSearchParams({ test_case_id: testCaseId });
  return apiFetch<TestStepListResponse>(`/api/v1/test-steps?${query.toString()}`);
}

/**
 * Partially update a TestStep — each step is independently editable
 * (REQ-2 AC3): editing one step's `action`/`expected_result` never touches
 * any other step's row.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `createTestStep`, gated on `test_step.update`; `422` if a `sequence`
 * change collides with another step already at that position.
 */
export async function updateTestStep(id: string, payload: UpdateTestStepPayload): Promise<TestStepSummary> {
  return apiFetch<TestStepSummary>(`/api/v1/test-steps/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
