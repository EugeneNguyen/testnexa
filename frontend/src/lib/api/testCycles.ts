/**
 * PLAN-3 `TestCycle` create (ADR-0033, UI Design Document
 * `docs/ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md`).
 *
 * One call only, and deliberately so: `TestCycle`'s `GET`/`PATCH`/`DELETE`
 * remain plain generic-factory routes reached through `entityCrud.ts`'s
 * generic helpers (`entityConfigs/test-cycle.ts`), and *listing* a plan's
 * cycles is likewise the generic `GET /test-cycles?test_plan_id=<id>` route —
 * neither needs a bespoke wrapper. Only `create` is bespoke, because the
 * route validates two *other* rows (`Release`, `Environment`) against the
 * target plan's own project, a shape the generic factory's single-row create
 * path has no hook for (ADR-0033 "Alternatives considered").
 *
 * Source: `app/api/routes/test_cycle_creation.py` /
 * `app/schemas/planning.py`'s `TestCycleSummary`.
 *
 * Note there is a *different* `TestCycleSummary` in `releases.ts` — that one
 * is the ADR-0019 audit query's nested shape (it carries an `executions`
 * array). This one is the plain entity summary the create route returns.
 * Import whichever the call site actually needs; they are not interchangeable.
 */
import { apiFetch } from "./client";

export interface TestCycleSummary {
  id: string;
  test_plan_id: string;
  release_id: string;
  environment_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Body for `POST /test-plans/{id}/test-cycles`.
 *
 * `test_plan_id` is deliberately absent — it comes from the path segment, and
 * the backend's `CreateTestCycleRequest` does not accept it in the body at
 * all (same path-carries-the-scope posture every other bespoke create route in
 * this API takes).
 */
export interface CreateTestCyclePayload {
  release_id: string;
  environment_id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
}

/**
 * Create a TestCycle under TestPlan `testPlanId`. Resolves with the new
 * cycle's `TestCycleSummary` (`201`).
 *
 * Rejects with an `ApiError` on failure (flat `{code, message, field_errors}`
 * body, API Document §1):
 * - `422 validation_error` — `release_id` or `environment_id` resolves to the
 *   *same org but a different project* than the plan (ADR-0033 Decision #1),
 *   or the insert violated a constraint. A cross-*org* id is `404`, never this
 *   `422`: existence is not confirmable across an org boundary (NFR-1).
 * - `403 permission_denied` — caller is a member of the plan's org but lacks
 *   `test_cycle.create`.
 * - `404` — the plan is missing, or the caller has no `OrgMembership` in its
 *   resolved org (indistinguishable by design).
 */
export async function createTestCycle(
  testPlanId: string,
  payload: CreateTestCyclePayload,
): Promise<TestCycleSummary> {
  return apiFetch<TestCycleSummary>(`/api/v1/test-plans/${testPlanId}/test-cycles`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
