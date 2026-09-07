/**
 * EXEC-2 append-only `TestLog` (this story's own ADR): the ordered-timeline
 * read (`GET /executions/{id}/logs`) and the comment-append write
 * (`POST /executions/{id}/comments`) — the only two client entry points into
 * `TestLog`, matching the backend's own read-only-plus-one-bespoke-append
 * posture (`app/api/routes/execution.py`): there is no update/delete call
 * here because no such route exists, by design (AC2).
 *
 * Source: `app/api/routes/execution.py`, `app/schemas/execution.py`'s
 * `TestLogSummary`/`TestLogListResponse`/`AddTestLogCommentRequest`.
 */
import { apiFetch } from "./client";

/** `TestLogEventType` (`app/models/execution.py`). */
export type TestLogEventTypeValue = "status_change" | "comment" | "attachment" | "agent_action";

/**
 * `TestLog.payload` is an opaque `JSONB` column — its shape varies by
 * `event_type` (`app/api/routes/execution.py`'s `build_status_change_log`/
 * `add_test_execution_comment`). Rendered generically (key/value pairs)
 * rather than typed per variant, since the frontend has no authoritative
 * schema for it beyond what the backend happens to write today.
 */
export type TestLogPayload = Record<string, unknown>;

/** `TestLogSummary` (`app/schemas/execution.py`). */
export interface TestLogSummary {
  id: string;
  test_execution_id: string;
  logged_at: string;
  event_type: TestLogEventTypeValue;
  payload: TestLogPayload;
}

interface TestLogListResponse {
  items: TestLogSummary[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * A `TestExecution`'s full history, oldest first (`GET
 * /executions/{id}/logs`, FR-EXEC-2 AC3) — the bespoke ordered-timeline read,
 * not the generic factory's unordered `GET /test-logs?test_execution_id=`.
 *
 * Unpaginated on the client on purpose: the backend still paginates
 * (`page_size` defaults to 25, same as every other list route), but a single
 * `TestExecution`'s own log is expected to be small enough at scaffold scale
 * that a second page is not a realistic case yet — same "modest scale"
 * posture `testExecutions.ts`'s own history fetch already takes for a
 * cycle's execution list.
 */
export async function listTestExecutionLogs(testExecutionId: string): Promise<TestLogSummary[]> {
  const response = await apiFetch<TestLogListResponse>(
    `/api/v1/executions/${testExecutionId}/logs`,
  );
  return response.items;
}

/** Body for `POST /executions/{id}/comments`. */
export interface AddTestExecutionCommentPayload {
  text: string;
  /**
   * Plain URL/path reference, no file upload (`AddTestLogCommentRequest`'s
   * own docstring — same "plain text/URL, no live integration needed for
   * v1" posture EXEC-3's `Defect.external_ref` already established).
   * Supplying either flips the appended row's `event_type` from `comment` to
   * `attachment` server-side.
   */
  attachment_url?: string | null;
  file_name?: string | null;
}

/**
 * Append a comment (or an attachment reference) to `testExecutionId`'s log.
 * Resolves with the newly appended `TestLogSummary` (`201`).
 *
 * Rejects with an `ApiError` on failure:
 * - `403 permission_denied` — caller lacks `test_execution.update` (the same
 *   permission a `result` correction already requires).
 * - `404` — the execution is missing, or the caller has no `OrgMembership`
 *   in its resolved org (NFR-1, indistinguishable by design).
 */
export async function addTestExecutionComment(
  testExecutionId: string,
  payload: AddTestExecutionCommentPayload,
): Promise<TestLogSummary> {
  return apiFetch<TestLogSummary>(`/api/v1/executions/${testExecutionId}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
