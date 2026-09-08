/**
 * EXEC-3 raise-a-Defect (ADR-0044): the two client entry points this story
 * adds — `POST /executions/{id}/defects` (create, atomic Defect+
 * TestCaseDefectLink) and `GET /test-cases/{id}/defects` (the ordered,
 * most-recent-first read `TestCase`'s detail view uses, AC3).
 *
 * Source: `app/api/routes/execution.py`, `app/schemas/execution.py`'s
 * `CreateDefectForExecutionRequest`/`DefectSummary`/`DefectListResponse`.
 * Mirrors `testLogs.ts`'s existing shape (bespoke wrapper per route, typed
 * payload/response, `ApiError` on failure via `apiFetch`).
 */
import { apiFetch } from "./client";

/** `DefectSeverity` (`app/models/execution.py`). */
export type DefectSeverityValue = "low" | "medium" | "high" | "critical";

/** `DefectSummary` (`app/schemas/execution.py`). */
export interface DefectSummary {
  id: string;
  test_execution_id: string;
  reported_by_actor_id: string;
  external_ref: string | null;
  severity: DefectSeverityValue;
  status: string;
}

interface DefectListResponse {
  items: DefectSummary[];
  total: number;
  page: number;
  page_size: number;
}

/** Body for `POST /executions/{id}/defects`. */
export interface CreateDefectForExecutionPayload {
  external_ref?: string | null;
  severity: DefectSeverityValue;
  status?: string | null;
}

/**
 * Raise a Defect from a failed `TestExecution` (FR-EXEC-3 AC1). Resolves with
 * the newly created `DefectSummary` (`201`).
 *
 * Rejects with an `ApiError` on failure:
 * - `422 validation_error` — the target execution's `result != fail` (AC1's
 *   own literal precondition), or a request-validation failure.
 * - `403 permission_denied` — caller lacks `defect.create`.
 * - `404` — the execution is missing, or the caller has no `OrgMembership`
 *   in its resolved org (NFR-1, indistinguishable by design).
 */
export async function createDefectForExecution(
  testExecutionId: string,
  payload: CreateDefectForExecutionPayload,
): Promise<DefectSummary> {
  return apiFetch<DefectSummary>(`/api/v1/executions/${testExecutionId}/defects`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Every Defect ever raised against any of `testCaseId`'s executions, most
 * recent first (`GET /test-cases/{id}/defects`, FR-EXEC-3 AC3) — the
 * ordering-guaranteed, `Defect`-field-bearing purpose-built read, not the
 * generic factory's bare `GET /test-case-defect-links?test_case_id=`
 * equivalent.
 *
 * Unpaginated on the client, same "modest scale" posture `listTestExecutionLogs`
 * already takes — a single `TestCase`'s own defect history is expected to be
 * small enough at scaffold scale that a second page isn't a realistic case yet.
 */
export async function listDefectsForTestCase(testCaseId: string): Promise<DefectSummary[]> {
  const response = await apiFetch<DefectListResponse>(
    `/api/v1/test-cases/${testCaseId}/defects`,
  );
  return response.items;
}
