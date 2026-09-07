/**
 * EXEC-1 `TestExecution` create (ADR-0034, UI Design Document
 * `docs/ui-design/2026-09-07-exec-1-test-execution-recording-ui-design.md`).
 *
 * One call only, and deliberately so — exactly the same posture (and for the
 * same reason) as `testCycles.ts`'s single bespoke `createTestCycle`:
 *
 * - **Create is bespoke** because `POST /test-cycles/{id}/executions`
 *   (ADR-0033, `app/api/routes/execution_authoring.py`) enforces FR-PLAN-3
 *   AC3's scope check — is this `TestCase` reachable from the cycle's own
 *   `TestPlan` through an included `TestSuite`? — which the generic factory's
 *   single-row create path has no hook for. The generic `POST
 *   /test-executions` was *removed* in the same change that added this route,
 *   so there is no non-bespoke create to fall back to (it answers `405`).
 * - **Reading needs no wrapper.** Both reads this story performs are plain
 *   generic-factory list calls reached through `entityCrud.ts`'s helpers
 *   against `entityConfigs/test-execution.ts`: the history list (`GET
 *   /test-executions?test_cycle_id=<id>`) and the dashboard's four
 *   `&result=<value>&page_size=1` count calls (ADR-0034's "no new aggregate
 *   route" decision — the tiles read each response's `total`, never its
 *   `items`).
 *
 * Source: `app/api/routes/execution_authoring.py` /
 * `app/schemas/execution.py`'s `TestExecutionSummary` and
 * `CreateExecutionForCycleRequest`.
 */
import { apiFetch } from "./client";

/**
 * `TestExecution.result`'s four values (`app/models/execution.py`'s
 * `TestExecutionResult`). Note the DB/API *value* is `"pass"` while the
 * backend Python member is `passed` — `pass` is a Python keyword. The wire
 * value is what this type describes, so `"pass"` is correct here.
 */
export type TestExecutionResultValue = "pass" | "fail" | "blocked" | "skipped";

export const TEST_EXECUTION_RESULTS: TestExecutionResultValue[] = [
  "pass",
  "fail",
  "blocked",
  "skipped",
];

/** `TestExecutionSummary` (`app/schemas/execution.py`) — the create route's `201` body. */
export interface TestExecutionSummary {
  id: string;
  test_cycle_id: string;
  test_case_id: string;
  executed_by_actor_id: string;
  result: TestExecutionResultValue;
  actual_result: string | null;
  executed_at: string;
}

/**
 * Body for `POST /test-cycles/{id}/executions`.
 *
 * Two fields are deliberately absent, both server-owned:
 * - `test_cycle_id` comes from the path segment (same path-carries-the-scope
 *   posture every other bespoke create route in this API takes).
 * - `executed_by_actor_id` is stamped from the authenticated caller. It isn't
 *   on `CreateExecutionForCycleRequest` at all, so a body supplying one is
 *   *ignored* by Pydantic rather than honored — there is no client-side way
 *   to record an execution "as" another actor, by construction.
 */
export interface CreateTestExecutionPayload {
  test_case_id: string;
  result: TestExecutionResultValue;
  actual_result?: string | null;
  /** Full ISO-8601 datetime (a `datetime` column, not a `date` — time of day is significant). */
  executed_at: string;
}

/**
 * Record a TestExecution against TestCycle `testCycleId`. Resolves with the
 * new row's `TestExecutionSummary` (`201`).
 *
 * Each call **inserts a new row** — re-recording a result for a
 * `test_case_id` already executed in this cycle is not an update and not an
 * upsert (FR-EXEC-1 AC3): the prior row keeps its own `result`/
 * `actual_result`/`executed_at` untouched and both remain independently
 * readable. That is a property of the route being a plain insert, not
 * something this wrapper enforces.
 *
 * Rejects with an `ApiError` on failure (flat `{code, message, field_errors}`
 * body, API Document §1):
 * - `422 validation_error` — the `TestCase` is not in scope for this cycle's
 *   `TestPlan` (ADR-0033's scope check). **Never `404`**: by this point the
 *   caller has already proved org membership *and* the `TestCase` resolved to
 *   a real row in the same org, so there is no existence left to hide. The
 *   "Record Result" picker is scoped to `GET /test-plans/{id}/test-cases` to
 *   make this structurally unreachable from the UI, but the route stays the
 *   actual enforcement boundary (NFR-10) — hence this is still handled.
 * - `403 permission_denied` — caller is a member of the cycle's org but lacks
 *   `test_execution.create`.
 * - `404` — the cycle is missing, the caller has no `OrgMembership` in its
 *   resolved org, or `test_case_id` is missing/unresolvable/**in another
 *   org** (all four indistinguishable by design, NFR-1).
 */
export async function createTestExecution(
  testCycleId: string,
  payload: CreateTestExecutionPayload,
): Promise<TestExecutionSummary> {
  return apiFetch<TestExecutionSummary>(`/api/v1/test-cycles/${testCycleId}/executions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
