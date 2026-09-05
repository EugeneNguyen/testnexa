"""Pydantic v2 schemas for the API-1 generic-CRUD factory's assets cluster.

Source: API Document §3 (generic CRUD routes, ADR-0021), Database Document
§3.6 (`Requirement`/`TestCondition`/`TestCase`/`TestStep`/`TestSuite`).

Field names mirror each ORM model's own column names exactly — the factory's
`_to_summary`/`create`/`update` machinery (`app/api/crud_factory.py`) maps
request/response bodies to model attributes purely by name, no per-entity
mapping function. `TestCase` has no `Create*Request` — its `create` stays
reserved for a future bespoke atomic-create route (ADR-0021, API Document
§4), never registered via the factory.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

TestConditionPriority = Literal["low", "medium", "high"]
TestCaseStatus = Literal["draft", "reviewed", "approved", "deprecated"]


# --- Requirement -------------------------------------------------------------------------------


class CreateRequirementRequest(BaseModel):
    """Body of `POST /requirements` — `project_id` is the required scope field."""

    project_id: UUID
    description: str
    external_ref: str | None = None
    source: str | None = None


class UpdateRequirementRequest(BaseModel):
    """Body of `PATCH /requirements/{id}` — partial update, `exclude_unset` semantics.

    `project_id` is not reassignable through this route (no ADR/story asks
    for moving a `Requirement` across projects).
    """

    description: str | None = None
    external_ref: str | None = None
    source: str | None = None


class RequirementSummary(BaseModel):
    id: UUID
    project_id: UUID
    description: str
    external_ref: str | None = None
    source: str | None = None


class RequirementListResponse(BaseModel):
    items: list[RequirementSummary]
    total: int
    page: int
    page_size: int


# --- TestCondition -------------------------------------------------------------------------------


class CreateTestConditionRequest(BaseModel):
    """Body of `POST /test-conditions` — `requirement_id` is the required scope field."""

    requirement_id: UUID
    description: str
    priority: TestConditionPriority


class UpdateTestConditionRequest(BaseModel):
    description: str | None = None
    priority: TestConditionPriority | None = None


class TestConditionSummary(BaseModel):
    id: UUID
    requirement_id: UUID
    description: str
    priority: TestConditionPriority


class TestConditionListResponse(BaseModel):
    items: list[TestConditionSummary]
    total: int
    page: int
    page_size: int


# --- TestCase ------------------------------------------------------------------------------------
#
# No `Create*Request`/`*ListResponse` — `create` is reserved for a future
# bespoke atomic-create route (ADR-0021), and `list` is deliberately not
# registered via the factory either: unlike every other scoped entity,
# `TestCase` has no single non-nullable FK the factory's `scope_field`
# mechanism could require as a list-scope query param (`test_condition_id` is
# nullable per ADR-0006, and the suite-link fallback is a many-to-many join,
# not a column) — requiring one would either wrongly 404 legitimately
# suite-only-linked test cases or leave `list` unscoped and leak across
# tenants (CLAUDE.md's multi-tenancy rule). See this story's final report for
# this deviation from the plan's literal "everything else gets all 5
# methods" framing.


class UpdateTestCaseRequest(BaseModel):
    """Body of `PATCH /test-cases/{id}` — partial update, `exclude_unset` semantics."""

    title: str | None = None
    preconditions: str | None = None
    expected_result: str | None = None
    status: TestCaseStatus | None = None
    test_level_id: UUID | None = None
    test_type_id: UUID | None = None
    test_condition_id: UUID | None = None


class TestCaseSummary(BaseModel):
    id: UUID
    test_condition_id: UUID | None = None
    test_level_id: UUID
    test_type_id: UUID
    created_by_actor_id: UUID
    title: str
    preconditions: str | None = None
    expected_result: str | None = None
    status: TestCaseStatus


# --- TestStep --------------------------------------------------------------------------------


class CreateTestStepRequest(BaseModel):
    """Body of `POST /test-steps` — `test_case_id` is the required scope field."""

    test_case_id: UUID
    sequence: int
    action: str
    expected_result: str | None = None


class UpdateTestStepRequest(BaseModel):
    sequence: int | None = None
    action: str | None = None
    expected_result: str | None = None


class TestStepSummary(BaseModel):
    id: UUID
    test_case_id: UUID
    sequence: int
    action: str
    expected_result: str | None = None


class TestStepListResponse(BaseModel):
    items: list[TestStepSummary]
    total: int
    page: int
    page_size: int


# --- TestSuite -------------------------------------------------------------------------------


class CreateTestSuiteRequest(BaseModel):
    """Body of `POST /test-suites` — `project_id` is the required scope field."""

    project_id: UUID
    name: str
    purpose: str | None = None


class UpdateTestSuiteRequest(BaseModel):
    name: str | None = None
    purpose: str | None = None


class TestSuiteSummary(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    purpose: str | None = None


class TestSuiteListResponse(BaseModel):
    items: list[TestSuiteSummary]
    total: int
    page: int
    page_size: int


__all__ = [
    "CreateRequirementRequest",
    "CreateTestConditionRequest",
    "CreateTestStepRequest",
    "CreateTestSuiteRequest",
    "RequirementListResponse",
    "RequirementSummary",
    "TestCaseSummary",
    "TestCaseStatus",
    "TestConditionListResponse",
    "TestConditionPriority",
    "TestConditionSummary",
    "TestStepListResponse",
    "TestStepSummary",
    "TestSuiteListResponse",
    "TestSuiteSummary",
    "UpdateRequirementRequest",
    "UpdateTestCaseRequest",
    "UpdateTestConditionRequest",
    "UpdateTestStepRequest",
    "UpdateTestSuiteRequest",
]
