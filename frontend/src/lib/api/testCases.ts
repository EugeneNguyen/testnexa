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
 * REQ-3 shipped with deliberately **no `listTestCases*` function for the
 * TestCondition-mediated path**: no backend route lists TestCases by test
 * condition (or at all via the generic factory — `TestCase` has no
 * factory-registered `list`, see `entityConfigs/test-case.ts`), an explicit
 * YAGNI call in ADR-0028's design spec. REQ-4's UI Design Document needs that
 * list after all (to hang an "Add to suite" action off each case), and closes
 * the gap **client-side** rather than with a new backend route:
 * `listTestCasesForTestCondition` below composes the existing read-only
 * link-table route (`GET /test-condition-test-case-links?test_condition_id=`,
 * ADR-0027) with the existing item route (`GET /test-cases/{id}`). A bounded
 * fan-out — typically single-digit TestCases per condition — not a new
 * endpoint.
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

/**
 * Fetch one TestCase by id (the generic factory's item route).
 *
 * Rejects with an `ApiError`: `404` if it doesn't exist, is in another org, or
 * is orphaned (unresolvable tenant — ADR-0029's three-branch resolver found no
 * path to an org); `403` if the caller is a member but lacks `test_case.read`.
 */
export async function getTestCase(testCaseId: string): Promise<TestCaseSummary> {
  return apiFetch<TestCaseSummary>(`/api/v1/test-cases/${testCaseId}`);
}

interface TestConditionTestCaseLinkRow {
  test_condition_id: string;
  test_case_id: string;
}

interface TestConditionTestCaseLinkListResponse {
  items: TestConditionTestCaseLinkRow[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * List the TestCases linked to `testConditionId`, composed client-side from
 * two existing routes (REQ-4's UI Design Document §2): the read-only
 * link-table list (ADR-0027) to get the ids, then one `getTestCase` per id to
 * get titles/statuses the junction table doesn't carry.
 *
 * Deliberately **not** a new backend route — see this module's docstring. The
 * fan-out is bounded by how many TestCases one TestCondition has (single
 * digits in practice), and the calls are issued concurrently.
 *
 * Individually unreadable cases are skipped rather than failing the whole
 * list: a link row can outlive the caller's ability to read its TestCase
 * (a `403` on `test_case.read`, or a case since deleted), and one such row
 * shouldn't blank out an otherwise-valid list. A failure of the *link* fetch
 * itself does reject, since that means the list is genuinely unknown rather
 * than partially readable.
 */
export async function listTestCasesForTestCondition(
  testConditionId: string,
): Promise<TestCaseSummary[]> {
  const query = new URLSearchParams({ test_condition_id: testConditionId });
  const links = await apiFetch<TestConditionTestCaseLinkListResponse>(
    `/api/v1/test-condition-test-case-links?${query.toString()}`,
  );
  const settled = await Promise.allSettled(
    links.items.map((link) => getTestCase(link.test_case_id)),
  );
  return settled
    .filter(
      (result): result is PromiseFulfilledResult<TestCaseSummary> => result.status === "fulfilled",
    )
    .map((result) => result.value);
}
