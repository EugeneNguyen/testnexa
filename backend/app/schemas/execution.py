"""Pydantic v2 schemas for the API-1 generic-CRUD factory's `Defect` route.

Source: API Document §3 (generic CRUD routes, ADR-0021), Database Document
§3.8 (`Defect`). Not explicitly named in the ADR-0021 plan's schema-file list
(only `assets.py`/`planning.py`/`taxonomy.py`/`governance.py`/`rbac.py` are
listed there) — added here mirroring `app/models/execution.py`'s own cluster
naming, matching the plan's own stated "one file per model-file cluster"
convention, since `Defect`'s route module (`app/api/routes/execution.py`) is
explicitly named in the plan and needs schemas to import.

No `Create*Request` — `Defect.create` stays reserved for a future bespoke
`POST /executions/{id}/defects` atomic-create route (ADR-0021, API Document
§4), never registered via the factory.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

DefectSeverity = Literal["low", "medium", "high", "critical"]


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


__all__ = [
    "DefectListResponse",
    "DefectSeverity",
    "DefectSummary",
    "UpdateDefectRequest",
]
