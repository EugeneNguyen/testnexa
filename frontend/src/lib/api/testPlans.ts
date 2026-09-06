/**
 * PLAN-1 TestPlan calls: the entity's own get/list/update (existing generic
 * factory routes, ADR-0022) plus the four bespoke membership/coverage routes
 * (ADR-0031).
 *
 * Source: `app/api/routes/test_plan_membership.py` (the membership trio plus
 * the coverage query) / `app/api/routes/planning.py`'s `_TEST_PLAN_CONFIG`
 * (the generic get/list/update) / `app/schemas/planning.py`'s
 * `TestPlanSummary`/`TestPlanListResponse` — mirrors `testSuites.ts`'s pattern
 * exactly, which is itself the shape ADR-0030 established for REQ-4's own
 * membership routes.
 *
 * Same asymmetry `testSuites.ts` flags: the entity's *own* fields
 * (identifier/scope/approach/staffing_and_training/schedule/status) are served
 * by the plain generic factory routes — ADR-0031 explicitly leaves those alone
 * — while the *membership* and *coverage* calls are path-scoped bespoke routes,
 * because a many-to-many join row (and the two-hop query derived from it) is
 * not something the generic factory can express.
 *
 * `addTestSuiteToPlan` and `updateTestPlan` are the two calls here with
 * story-specific error codes worth branching on client-side — see their
 * docstrings for `422` vs `409 already_included_in_plan`, and for
 * `409 invalid_status_transition` respectively.
 */
import { apiFetch } from "./client";
import type { TestCaseListResponse } from "./testCases";
import type { TestSuiteListResponse } from "./testSuites";

export type TestPlanStatus = "draft" | "approved" | "superseded";

export interface TestPlanSummary {
  id: string;
  project_id: string;
  created_by_actor_id: string;
  identifier: string;
  scope: string | null;
  approach: string | null;
  staffing_and_training: string | null;
  schedule: string | null;
  status: TestPlanStatus;
}

export interface TestPlanListResponse {
  items: TestPlanSummary[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Partial update body for `PATCH /test-plans/{id}` — every field optional, and
 * `project_id` deliberately absent: the backend's `UpdateTestPlanRequest` omits
 * the scope field entirely (scope is not reassignable through an update, same
 * posture every other `Update*Request` in this API takes).
 */
export interface UpdateTestPlanPayload {
  identifier?: string;
  scope?: string | null;
  approach?: string | null;
  staffing_and_training?: string | null;
  schedule?: string | null;
  status?: TestPlanStatus;
}

export interface ListTestPlansParams {
  page?: number;
  page_size?: number;
}

/**
 * Fetch one TestPlan by id via the generic factory route
 * (`GET /test-plans/{id}`).
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no membership
 * in the plan's org (NFR-1) or the plan doesn't exist — a cross-org plan is
 * `404`, never `403`, existence is not confirmable across an org boundary —
 * and `403 permission_denied` if they're a member but lack `test_plan.read`.
 */
export async function getTestPlan(testPlanId: string): Promise<TestPlanSummary> {
  return apiFetch<TestPlanSummary>(`/api/v1/test-plans/${testPlanId}`);
}

/**
 * List TestPlans scoped to `projectId` (`GET /test-plans?project_id=<id>`).
 * `project_id` is required by the generic factory's `scope_field` enforcement
 * (`422` if omitted) — always sent.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `getTestPlan`, gated on `test_plan.read`.
 */
export async function listTestPlans(
  projectId: string,
  params: ListTestPlansParams = {},
): Promise<TestPlanListResponse> {
  const query = new URLSearchParams({ project_id: projectId });
  if (params.page !== undefined) {
    query.set("page", String(params.page));
  }
  if (params.page_size !== undefined) {
    query.set("page_size", String(params.page_size));
  }
  return apiFetch<TestPlanListResponse>(`/api/v1/test-plans?${query.toString()}`);
}

/**
 * Partially update a TestPlan (`PATCH /test-plans/{id}`, the generic factory
 * route). Only the keys present in `payload` are written.
 *
 * One rejection code is specific to this route's PLAN-1 behavior and worth
 * distinguishing in the UI (an `ApiError` with a `code` on `.body`, per API
 * Document §1):
 * - `409 invalid_status_transition` — the body carried a `status` whose value
 *   isn't a legal successor of the row's current one. ADR-0031's guard allows
 *   only `draft -> approved` and `approved -> superseded`; every other pair
 *   (including `draft -> superseded`, a backward `approved -> draft`, any write
 *   out of the terminal `superseded`, and an idempotent same-value re-write) is
 *   rejected with this one code regardless of which pair was attempted. A
 *   request with no `status` key at all can never hit it.
 *
 * Plus the usual boundary: `404` if the plan is missing or in another org,
 * `403 permission_denied` if the caller is a member but lacks
 * `test_plan.update`, `422 validation_error` (with `field_errors`) on a
 * malformed field.
 */
export async function updateTestPlan(
  testPlanId: string,
  payload: UpdateTestPlanPayload,
): Promise<TestPlanSummary> {
  return apiFetch<TestPlanSummary>(`/api/v1/test-plans/${testPlanId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * List the TestSuites currently included in `testPlanId` — a **live** query
 * against the `TestPlanTestSuite` join table on every call, never a cached
 * snapshot (ADR-0031). That liveness is why callers re-fetch after every
 * include/remove rather than splicing local state.
 *
 * A plan with no included suites resolves with `items: []` and `total: 0` — a
 * `200`, not a `404`. The plan existing and having no suites yet are different
 * things.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no membership
 * in the plan's org (NFR-1) or the plan doesn't exist, `403 permission_denied`
 * if they're a member but lack `test_plan.read`.
 */
export async function listPlanTestSuites(testPlanId: string): Promise<TestSuiteListResponse> {
  return apiFetch<TestSuiteListResponse>(`/api/v1/test-plans/${testPlanId}/test-suites`);
}

/**
 * Coverage query (ADR-0031, FR-PLAN-1 AC2): every TestCase reachable from
 * `testPlanId` through the full two-hop chain — plan -> included TestSuites
 * (`TestPlanTestSuite`) -> their TestCases (`TestSuiteTestCase`) —
 * **deduplicated**, so a TestCase belonging to two included suites is returned
 * once, not twice.
 *
 * A plan with zero included suites, or included suites with zero members, is a
 * normal `200` with an empty list — never a `404`. Both causes collapse to the
 * same empty response; the route does not distinguish them.
 *
 * Rejects with an `ApiError` on failure: same `404`/`403` boundary as
 * `listPlanTestSuites`, gated on `test_plan.read`.
 */
export async function listPlanTestCases(testPlanId: string): Promise<TestCaseListResponse> {
  return apiFetch<TestCaseListResponse>(`/api/v1/test-plans/${testPlanId}/test-cases`);
}

/**
 * Include TestSuite `testSuiteId` in TestPlan `testPlanId`.
 *
 * Resolves with `void` — the route's `201` body carries only the two ids the
 * caller already had (`{test_plan_id, test_suite_id}`), so there is nothing to
 * hand back; callers re-fetch `listPlanTestSuites` (and `listPlanTestCases`,
 * which the same action invalidates) instead.
 *
 * Two rejection codes are specific to this route and worth distinguishing in
 * the UI (both are `ApiError` with a `code` on `.body`, per API Document §1):
 * - `422 validation_error` — the TestSuite belongs to a *different project*
 *   than the plan, same org. ADR-0031 rejects cross-project inclusion, same
 *   posture ADR-0030 took for `TestSuiteTestCase`.
 * - `409 already_included_in_plan` — the pair already exists. Deliberately not
 *   `422`: the request is well-formed, the relationship is simply already true.
 *   Note this is a *distinct* code from `testSuites.ts`'s own
 *   `409 already_in_suite` — different relationship, different code.
 *
 * Plus the usual boundary: `404` if either row is missing or in another org (a
 * cross-*org* TestSuite is `404`, never the cross-*project* `422` — existence is
 * not confirmable across an org boundary), `403` if the caller is a member but
 * lacks `test_plan.update`.
 */
export async function addTestSuiteToPlan(testPlanId: string, testSuiteId: string): Promise<void> {
  await apiFetch<unknown>(`/api/v1/test-plans/${testPlanId}/test-suites/${testSuiteId}`, {
    method: "POST",
  });
}

/**
 * Remove TestSuite `testSuiteId` from TestPlan `testPlanId` (`204`, no body).
 *
 * Only the join row is deleted — the TestSuite itself survives, as does its
 * inclusion in any other plan and its own TestCase membership.
 *
 * Rejects with `404` if the pair isn't currently a membership (never included,
 * or already removed) — deliberately *not* an idempotent `204`, asymmetric with
 * `addTestSuiteToPlan`'s `409`-on-already-true (ADR-0031). Same `404`/`403` org
 * boundary as the calls above otherwise, gated on `test_plan.update`.
 */
export async function removeTestSuiteFromPlan(
  testPlanId: string,
  testSuiteId: string,
): Promise<void> {
  await apiFetch<void>(`/api/v1/test-plans/${testPlanId}/test-suites/${testSuiteId}`, {
    method: "DELETE",
  });
}
