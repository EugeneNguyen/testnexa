"""Pydantic v2 schemas for the API-1/ADR-0025 generic-CRUD factory's
`Defect`/`TestExecution`/`TestLog` routes.

Source: API Document §3 (generic CRUD routes, ADR-0022), §3/§5 additions
(ADR-0025), Database Document §3.8. Not explicitly named in the ADR-0022
plan's schema-file list (only `assets.py`/`planning.py`/`taxonomy.py`/
`governance.py`/`rbac.py` are listed there) — added here mirroring
`app/models/execution.py`'s own cluster naming, matching the plan's own
stated "one file per model-file cluster" convention, since this cluster's
route module (`app/api/routes/execution.py`) is explicitly named in the plan
and needs schemas to import.

No `Create*Request`/`Update*Request` for `Defect` or `TestLog` — `Defect`'s
`create` stays reserved for a future bespoke `POST /executions/{id}/defects`
atomic-create route (ADR-0022, API Document §4), never registered via the
factory; `TestLog` is immutable by schema (no `updated_at` column) and never
registers `create`/`update`/`delete` at all (ADR-0025).
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

DefectSeverity = Literal["low", "medium", "high", "critical"]
TestExecutionResult = Literal["pass", "fail", "blocked", "skipped"]
TestLogEventType = Literal["status_change", "comment", "attachment", "agent_action"]


class UpdateDefectRequest(BaseModel):
    """Body of `PATCH /defects/{id}` — partial update, `exclude_unset` semantics.

    `test_execution_id` is not reassignable through this route (no ADR/story
    asks for moving a `Defect` to a different `TestExecution`).
    """

    external_ref: str | None = None
    severity: DefectSeverity | None = None
    status: str | None = None


class DefectSummary(BaseModel):
    id: UUID
    test_execution_id: UUID
    reported_by_actor_id: UUID
    external_ref: str | None = None
    severity: DefectSeverity
    status: str


class DefectListResponse(BaseModel):
    items: list[DefectSummary]
    total: int
    page: int
    page_size: int


# --- TestExecution (ADR-0025 full CRUD; `create` bespoke-only as of ADR-0033) -------------------


class CreateExecutionForCycleRequest(BaseModel):
    """Body of the bespoke `POST /test-cycles/{id}/executions` (ADR-0033).

    Replaces the removed generic `POST /test-executions` body
    (`CreateTestExecutionRequest`, deleted in the same change that dropped
    `"create"` from `_TEST_EXECUTION_CONFIG.methods`) — the generic route
    enforced no PLAN-3 scope check, so leaving it reachable would have let any
    caller bypass FR-PLAN-3 AC3 entirely by using the unrestricted path
    (`backend/CLAUDE.md`'s standing "restrict the generic create in the same
    commit" rule).

    Two fields the generic schema had are deliberately absent here:

    - `test_cycle_id` — comes from the path segment, not the body. It is what
      the route's own 404/403 gate and the scope check's `test_plan_id` are
      both computed from; accepting it twice would create a contradictable
      second source of truth.
    - `executed_by_actor_id` — stamped server-side from the authenticated
      actor, never client-supplied. Same posture the generic schema's own
      docstring already established for this field: rather than silently
      dropping a caller-supplied value, the field simply does not exist on the
      request schema at all, so a body attempting to set it is ignored by
      Pydantic rather than honored.
    """

    test_case_id: UUID
    result: TestExecutionResult
    actual_result: str | None = None
    executed_at: datetime


class UpdateTestExecutionRequest(BaseModel):
    """Body of `PATCH /test-executions/{id}` — partial update, `exclude_unset` semantics.

    `test_cycle_id`/`test_case_id`/`executed_by_actor_id` are not reassignable
    through this route (no ADR/story asks for moving a `TestExecution` to a
    different cycle/case, or reattributing who ran it).
    """

    result: TestExecutionResult | None = None
    actual_result: str | None = None
    executed_at: datetime | None = None


class TestExecutionSummary(BaseModel):
    id: UUID
    test_cycle_id: UUID
    test_case_id: UUID
    executed_by_actor_id: UUID
    result: TestExecutionResult
    actual_result: str | None = None
    executed_at: datetime


class TestExecutionListResponse(BaseModel):
    items: list[TestExecutionSummary]
    total: int
    page: int
    page_size: int


# --- TestLog (ADR-0025, list/get only — immutable) ----------------------------------------------


class TestLogSummary(BaseModel):
    id: UUID
    test_execution_id: UUID
    logged_at: datetime
    event_type: TestLogEventType
    payload: dict


class TestLogListResponse(BaseModel):
    items: list[TestLogSummary]
    total: int
    page: int
    page_size: int


class AddTestLogCommentRequest(BaseModel):
    """Body of the bespoke `POST /executions/{id}/comments` (EXEC-2).

    Not a `Comment` entity of its own — there is none (Database Document
    §3.8 unchanged) — this route's only effect is appending one `TestLog`
    row. `attachment_url`/`file_name` are optional plain-reference fields
    (no file upload, no `Attachment` row): same "plain text/URL, no live
    integration needed for v1" posture EXEC-3's `Defect.external_ref`
    already established. Supplying either flips the appended row's
    `event_type` from `comment` to `attachment` (still `agent_action` instead
    of either, unchanged, if the caller is an `AIAgent` — see
    `execution.py`'s `_build_comment_log` docstring).
    """

    text: str
    attachment_url: str | None = None
    file_name: str | None = None


__all__ = [
    "AddTestLogCommentRequest",
    "CreateExecutionForCycleRequest",
    "DefectListResponse",
    "DefectSeverity",
    "DefectSummary",
    "TestExecutionListResponse",
    "TestExecutionSummary",
    "TestLogEventType",
    "TestLogListResponse",
    "TestLogSummary",
    "UpdateDefectRequest",
    "UpdateTestExecutionRequest",
]
