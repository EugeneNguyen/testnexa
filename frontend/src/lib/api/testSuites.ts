/**
 * REQ-4 TestSuite calls: the entity's own create/list (existing generic
 * factory routes, ADR-0022) plus the three bespoke membership routes
 * (ADR-0030).
 *
 * Source: `app/api/routes/test_suite_membership.py` (the membership trio) /
 * `app/api/routes/assets.py`'s `_TEST_SUITE_CONFIG` (the generic create/list) /
 * `app/schemas/assets.py`'s `TestSuiteSummary`/`TestCaseListResponse` — mirrors
 * `testConditions.ts`'s pattern.
 *
 * Asymmetry worth flagging, the mirror image of `testConditions.ts`'s: the
 * *create* here is the plain generic route (`POST /test-suites` with
 * `project_id` in the body — a `TestSuite` is a single row with no link table,
 * so the factory serves it fine and ADR-0030 explicitly leaves it alone),
 * while the *membership* calls are path-scoped bespoke routes, because a
 * many-to-many join row is not something the generic factory can express as a
 * usable membership view (ADR-0030's Alternatives section).
 *
 * `addTestCaseToSuite` is the only call here with story-specific error codes
 * worth branching on client-side — see its docstring for `422` vs `409`.
 */
import { apiFetch } from "./client";
import type { TestCaseListResponse } from "./testCases";

export interface TestSuiteSummary {
  id: string;
  project_id: string;
  name: string;
  purpose: string | null;
}

export interface CreateTestSuitePayload {
  name: string;
  purpose?: string | null;
}

export interface TestSuiteListResponse {
  items: TestSuiteSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListTestSuitesParams {
  page?: number;
  page_size?: number;
}

/**
 * Create a TestSuite in `projectId` via the generic factory route
 * (`POST /test-suites`) — `project_id` goes in the *body* here, not the path,
 * unlike this module's membership calls below.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no membership
 * in the project's org (NFR-1) or the project doesn't exist, `403
 * permission_denied` if they're a member but lack `test_suite.create`, `422` on
 * a missing/invalid field.
 */
export async function createTestSuite(
  projectId: string,
  payload: CreateTestSuitePayload,
): Promise<TestSuiteSummary> {
  return apiFetch<TestSuiteSummary>("/api/v1/test-suites", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, ...payload }),
  });
}

/**
 * List TestSuites scoped to `projectId`. `project_id` is required by the
 * generic factory's `scope_field` enforcement (422 if omitted) — always sent.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `createTestSuite`, gated on `test_suite.read`.
 */
export async function listTestSuites(
  projectId: string,
  params: ListTestSuitesParams = {},
): Promise<TestSuiteListResponse> {
  const query = new URLSearchParams({ project_id: projectId });
  if (params.page !== undefined) {
    query.set("page", String(params.page));
  }
  if (params.page_size !== undefined) {
    query.set("page_size", String(params.page_size));
  }
  return apiFetch<TestSuiteListResponse>(`/api/v1/test-suites?${query.toString()}`);
}

/**
 * List the TestCases currently in `testSuiteId` — a **live** query against the
 * `TestSuiteTestCase` join table on every call, never a cached snapshot
 * (ADR-0030). That liveness is the mechanism behind FR-REQ-4 AC2, which is why
 * callers re-fetch after every add/remove rather than splicing local state.
 *
 * A suite with no members resolves with `items: []` and `total: 0` — a `200`,
 * not a `404`. The suite existing and having no members yet are different
 * things.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no membership
 * in the suite's org (NFR-1) or the suite doesn't exist, `403
 * permission_denied` if they're a member but lack `test_suite.read`.
 */
export async function listSuiteTestCases(testSuiteId: string): Promise<TestCaseListResponse> {
  return apiFetch<TestCaseListResponse>(`/api/v1/test-suites/${testSuiteId}/test-cases`);
}

/**
 * Add TestCase `testCaseId` to TestSuite `testSuiteId`.
 *
 * Resolves with `void` — the route's `201` body carries only the two ids the
 * caller already had, so there is nothing to hand back; callers re-fetch
 * `listSuiteTestCases` instead.
 *
 * Two rejection codes are specific to this route and worth distinguishing in
 * the UI (both are `ApiError` with a `code` on `.body`, per API Document §7):
 * - `422 validation_error` — the TestCase resolves to a *different project*
 *   than the suite, same org. ADR-0030 rejects cross-project membership.
 * - `409 already_in_suite` — the pair already exists. Deliberately not `422`:
 *   the request is well-formed, the relationship is simply already true.
 *
 * Plus the usual boundary: `404` if either row is missing or in another org
 * (a cross-*org* TestCase is `404`, never the cross-*project* `422` — existence
 * is not confirmable across an org boundary), `403` if the caller is a member
 * but lacks `test_suite.update`.
 */
export async function addTestCaseToSuite(testSuiteId: string, testCaseId: string): Promise<void> {
  await apiFetch<unknown>(`/api/v1/test-suites/${testSuiteId}/test-cases/${testCaseId}`, {
    method: "POST",
  });
}

/**
 * Remove TestCase `testCaseId` from TestSuite `testSuiteId` (`204`, no body).
 *
 * Only the join row is deleted — the TestCase itself survives, as does its
 * membership in any other suite.
 *
 * Rejects with `404` if the pair isn't currently a membership (never added, or
 * already removed) — deliberately *not* an idempotent `204`, asymmetric with
 * `addTestCaseToSuite`'s `409`-on-already-true (ADR-0030). Same `404`/`403`
 * org boundary as the calls above otherwise.
 */
export async function removeTestCaseFromSuite(
  testSuiteId: string,
  testCaseId: string,
): Promise<void> {
  await apiFetch<void>(`/api/v1/test-suites/${testSuiteId}/test-cases/${testCaseId}`, {
    method: "DELETE",
  });
}
