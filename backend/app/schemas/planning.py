"""Pydantic v2 schemas for the API-1 generic-CRUD factory's planning cluster.

Source: API Document §3 (generic CRUD routes, ADR-0022), Database Document
§3.7 (`TestPlan`/`EntryExitCriteria`/`Environment`/`TestCycle`).

`TestCycle`'s `Create*Request` is **not** a factory create schema (ADR-0033):
`_TEST_CYCLE_CONFIG` still passes `create_schema=None` and never registers a
generic `POST /test-cycles`. `CreateTestCycleRequest` below is the body of the
*bespoke* `POST /test-plans/{id}/test-cycles` route
(`app/api/routes/test_cycle_creation.py`) — same posture
`CreateTestCaseForTestConditionRequest` already has in `app/schemas/assets.py`.
`created_by_actor_id` is never a client-supplied field on `TestPlan` — the
factory auto-stamps it from the authenticated actor
(`app/api/crud_factory.py`'s `_ACTOR_STAMPED_FIELDS`).
"""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

TestPlanStatus = Literal["draft", "approved", "superseded"]
EntryExitCriteriaType = Literal["entry", "exit", "suspension", "resumption"]


# --- TestPlan --------------------------------------------------------------------------------


class CreateTestPlanRequest(BaseModel):
    """Body of `POST /test-plans` — `project_id` is the required scope field.

    `status` omitted uses the column's own default (`draft`) — the factory's
    `create` route applies `model_dump(exclude_none=True)`, so an omitted or
    explicit-`null` `status` are equivalent (never sent to the DB as an
    explicit `NULL` against a non-nullable column).
    """

    project_id: UUID
    identifier: str
    scope: str | None = None
    approach: str | None = None
    staffing_and_training: str | None = None
    schedule: str | None = None
    status: TestPlanStatus | None = None


class UpdateTestPlanRequest(BaseModel):
    identifier: str | None = None
    scope: str | None = None
    approach: str | None = None
    staffing_and_training: str | None = None
    schedule: str | None = None
    status: TestPlanStatus | None = None


class TestPlanSummary(BaseModel):
    id: UUID
    project_id: UUID
    created_by_actor_id: UUID
    identifier: str
    scope: str | None = None
    approach: str | None = None
    staffing_and_training: str | None = None
    schedule: str | None = None
    status: TestPlanStatus


class TestPlanListResponse(BaseModel):
    items: list[TestPlanSummary]
    total: int
    page: int
    page_size: int


# --- EntryExitCriteria -----------------------------------------------------------------------


class CreateEntryExitCriteriaRequest(BaseModel):
    """Body of `POST /entry-exit-criteria` — `test_plan_id` is the required scope field."""

    test_plan_id: UUID
    type: EntryExitCriteriaType
    condition_text: str


class UpdateEntryExitCriteriaRequest(BaseModel):
    type: EntryExitCriteriaType | None = None
    condition_text: str | None = None


class EntryExitCriteriaSummary(BaseModel):
    id: UUID
    test_plan_id: UUID
    type: EntryExitCriteriaType
    condition_text: str


class EntryExitCriteriaListResponse(BaseModel):
    items: list[EntryExitCriteriaSummary]
    total: int
    page: int
    page_size: int


# --- Environment -----------------------------------------------------------------------------


class CreateEnvironmentRequest(BaseModel):
    """Body of `POST /environments` — `project_id` is the required scope field."""

    project_id: UUID
    name: str
    config_notes: str | None = None


class UpdateEnvironmentRequest(BaseModel):
    name: str | None = None
    config_notes: str | None = None


class EnvironmentSummary(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    config_notes: str | None = None


class EnvironmentListResponse(BaseModel):
    items: list[EnvironmentSummary]
    total: int
    page: int
    page_size: int


# --- TestCycle -------------------------------------------------------------------------------


class CreateTestCycleRequest(BaseModel):
    """Body of the bespoke `POST /test-plans/{id}/test-cycles` (ADR-0033, FR-PLAN-3 AC1).

    `test_plan_id` is deliberately **absent**: it comes from the path segment,
    not the body — same shape every other bespoke create route in this codebase
    uses for its parent id (`POST /requirements/{id}/test-conditions`,
    `POST /test-conditions/{id}/test-cases`). Accepting it in the body too
    would create a second, contradictable source of truth for the one thing the
    route's own 404/403 gate is computed from.

    `release_id`/`environment_id` are both required and both independently
    validated by the route against the target `TestPlan`'s own `project_id`
    (ADR-0033 §Decision step 3): a different org -> `404`, the same org but a
    different project -> `422`.

    `start_date`/`end_date` are optional, matching the columns' own
    nullability. No cross-field `end_date >= start_date` validator — no
    acceptance criterion asks for one, and this codebase does not invent
    validation beyond what a story states (PLAN-3 UI Design Document §2/§4).
    """

    release_id: UUID
    environment_id: UUID
    name: str
    start_date: date | None = None
    end_date: date | None = None


class UpdateTestCycleRequest(BaseModel):
    """Body of `PATCH /test-cycles/{id}` — partial update, `exclude_unset` semantics.

    `test_plan_id`/`release_id` are not reassignable through this route (no
    ADR/story asks for moving a `TestCycle` to a different plan/release).
    """

    name: str | None = None
    environment_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None


class TestCycleSummary(BaseModel):
    id: UUID
    test_plan_id: UUID
    release_id: UUID
    environment_id: UUID
    name: str
    start_date: date | None = None
    end_date: date | None = None


class TestCycleListResponse(BaseModel):
    items: list[TestCycleSummary]
    total: int
    page: int
    page_size: int


__all__ = [
    "CreateEntryExitCriteriaRequest",
    "CreateEnvironmentRequest",
    "CreateTestCycleRequest",
    "CreateTestPlanRequest",
    "EntryExitCriteriaListResponse",
    "EntryExitCriteriaSummary",
    "EntryExitCriteriaType",
    "EnvironmentListResponse",
    "EnvironmentSummary",
    "TestCycleListResponse",
    "TestCycleSummary",
    "TestPlanListResponse",
    "TestPlanStatus",
    "TestPlanSummary",
    "UpdateEntryExitCriteriaRequest",
    "UpdateEnvironmentRequest",
    "UpdateTestCycleRequest",
    "UpdateTestPlanRequest",
]
