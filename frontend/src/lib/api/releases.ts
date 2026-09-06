/**
 * PROJ-2 Release create/list/read + audit-query calls (ADR-0019).
 *
 * Source: `app/api/routes/releases.py` / `app/schemas/releases.py` (exact
 * request/response contracts) — mirrors `projects.ts`'s pattern: create/list
 * carry `project_id` in the path (no `org_id` segment exists at this depth,
 * ADR-0019 §1); single-fetch and the audit query drop `project_id` entirely,
 * resolving org from the fetched `Release` -> `Project` chain server-side.
 */
import { apiFetch } from "./client";

export interface ReleaseSummary {
  id: string;
  project_id: string;
  version_label: string;
  target_date: string | null;
}

export interface CreateReleasePayload {
  version_label: string;
  target_date?: string | null;
}

export interface ReleaseListResponse {
  items: ReleaseSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListReleasesParams {
  page?: number;
  page_size?: number;
  sort?: string;
  order?: "asc" | "desc";
}

export interface TestExecutionSummary {
  id: string;
  test_case_id: string;
  result: string;
  executed_at: string;
}

/**
 * PLAN-2 (ADR-0032): the backend's own `EntryExitCriteriaSummary`
 * (`app/schemas/planning.py`), nested verbatim into `TestCycleSummary` below.
 * No pre-existing frontend type covered this shape — `EntryExitCriteria` was
 * only ever reached through the generic CRUD surface, whose rows are typed as
 * the untyped `EntityRow` (`entityCrud.ts`), so this is the first concrete
 * declaration of it rather than a redundant parallel to an existing one.
 */
export interface EntryExitCriteriaSummary {
  id: string;
  test_plan_id: string;
  type: "entry" | "exit" | "suspension" | "resumption";
  condition_text: string;
}

export interface TestCycleSummary {
  id: string;
  release_id: string;
  test_plan_id: string;
  environment_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  executions: TestExecutionSummary[];
  /**
   * The parent `TestPlan`'s `type = exit` criteria rows, already filtered
   * server-side (ADR-0032) — the frontend renders them as-is, never
   * re-filtering. Always present: a plan with no `exit` rows yields `[]`,
   * never an omitted field.
   */
  exit_criteria: EntryExitCriteriaSummary[];
}

/**
 * Create a Release under `projectId`. Resolves with the new release's
 * `ReleaseSummary` on success.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no
 * membership at all in the project's org (NFR-1, existence never
 * confirmable across a tenant boundary) or the project doesn't exist,
 * `403 permission_denied` if they're a member but lack `release.create`.
 */
export async function createRelease(projectId: string, payload: CreateReleasePayload): Promise<ReleaseSummary> {
  return apiFetch<ReleaseSummary>(`/api/v1/projects/${projectId}/releases`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * List Releases under `projectId`, paginated and sorted. Defaults to
 * `sort=target_date&order=asc` (`NULLS LAST` pinned server-side, ADR-0019) —
 * matching the backend route's own defaults, so an empty `params` object
 * behaves the same as omitting the query string entirely.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `createRelease`, gated on `release.read`.
 */
export async function listReleases(projectId: string, params: ListReleasesParams = {}): Promise<ReleaseListResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) {
    query.set("page", String(params.page));
  }
  if (params.page_size !== undefined) {
    query.set("page_size", String(params.page_size));
  }
  if (params.sort !== undefined) {
    query.set("sort", params.sort);
  }
  if (params.order !== undefined) {
    query.set("order", params.order);
  }
  const queryString = query.toString();
  return apiFetch<ReleaseListResponse>(
    `/api/v1/projects/${projectId}/releases${queryString ? `?${queryString}` : ""}`,
  );
}

/**
 * Fetch a single Release by id. Resolves with its `ReleaseSummary` on
 * success.
 *
 * Rejects with an `ApiError` on failure: `404` if the release doesn't exist
 * or the caller has no membership in its resolved org (indistinguishable by
 * design, NFR-1), `403 permission_denied` if they're a member but lack
 * `release.read`.
 */
export async function getRelease(id: string): Promise<ReleaseSummary> {
  return apiFetch<ReleaseSummary>(`/api/v1/releases/${id}`);
}

/**
 * AC2's audit query: every TestCycle targeting `id`, each with its
 * TestExecutions *and* its parent plan's `exit`-type EntryExitCriteria nested
 * (ADR-0019, extended by ADR-0032) — read-only, no follow-up call needed.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `getRelease`, but gated on all four of `release.read` AND
 * `test_cycle.read` AND `test_execution.read` AND `entry_exit_criteria.read`
 * (`403` if any is missing, no partial response).
 */
export async function getReleaseTestCycles(id: string): Promise<TestCycleSummary[]> {
  return apiFetch<TestCycleSummary[]>(`/api/v1/releases/${id}/test-cycles`);
}
