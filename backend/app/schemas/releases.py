"""Pydantic v2 schemas for the PROJ-2 `Release` routes.

Source: API Document §2/§3 (`POST`/`GET /projects/{project_id}/releases`,
`GET /releases/{id}`, `GET /releases/{id}/test-cycles` contracts), ADR-0019
(release creation flow — bespoke project-path-scoped create, row-resolved
read, nested-executions audit query).
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class CreateReleaseRequest(BaseModel):
    """Body of `POST /projects/{project_id}/releases`.

    `target_date` is a plain optional field (unlike `Project.standards_profile`
    in `app/schemas/projects.py`) — there's no org-default-inheritance
    behavior to distinguish omitted vs. explicit `null` for here (ADR-0019
    doesn't define one), so a simple `date | None = None` default is
    sufficient; the route never needs to consult `model_fields_set` for this
    schema.
    """

    version_label: str
    target_date: date | None = None


class ReleaseSummary(BaseModel):
    """Response shape for `POST`/`GET /projects/{project_id}/releases` (item),
    `GET /releases/{id}`.
    """

    id: UUID
    project_id: UUID
    version_label: str
    target_date: date | None = None


class ReleaseListResponse(BaseModel):
    """Response shape for `GET /projects/{project_id}/releases` — API
    Document §1's generic paginated-list envelope.
    """

    items: list[ReleaseSummary]
    total: int
    page: int
    page_size: int


class TestExecutionSummary(BaseModel):
    """Minimal `TestExecution` shape nested under `TestCycleSummary.executions`.

    No `TestExecutionSummary` schema exists anywhere under `app/schemas/`
    yet (checked before adding this one, per the PROJ-2 plan/ADR-0019) —
    `TestExecution` has no create/read route of its own in this codebase,
    only this nested audit-query use. `result` is typed `str`, not the
    `TestExecutionResult` enum (`app/models/execution.py`), since Pydantic
    serializes the enum's `.value` either way and this schema has no need to
    import the ORM enum type directly.
    """

    id: UUID
    test_case_id: UUID
    result: str
    executed_at: datetime


class TestCycleSummary(BaseModel):
    """Response item shape for `GET /releases/{id}/test-cycles` (ADR-0019 AC2).

    Nests each `TestCycle`'s `TestExecution`s directly (`executions`) rather
    than returning cycles only — ADR-0019's decision that this route answers
    "what was tested for release X" as a single queryable unit, since no
    `GET /test-cycles/{id}/executions` route exists to chase separately.
    """

    id: UUID
    release_id: UUID
    test_plan_id: UUID
    environment_id: UUID
    name: str
    start_date: date | None = None
    end_date: date | None = None
    executions: list[TestExecutionSummary]


__all__ = [
    "CreateReleaseRequest",
    "ReleaseListResponse",
    "ReleaseSummary",
    "TestCycleSummary",
    "TestExecutionSummary",
]
