"""Pydantic v2 schemas for the API-1 generic-CRUD factory's assets cluster.

Source: API Document §3 (generic CRUD routes, ADR-0022), Database Document
§3.6 (`Requirement`/`TestCondition`/`TestCase`/`TestStep`/`TestSuite`).

Field names mirror each ORM model's own column names exactly — the factory's
`_to_summary`/`create`/`update` machinery (`app/api/crud_factory.py`) maps
request/response bodies to model attributes purely by name, no per-entity
mapping function. `TestCase` and `TestCondition` have no factory-registered
`Create*Request` — both entities' `create` is served only by bespoke
atomic-create routes instead: REQ-2's direct-link `CreateTestCaseRequest`
(`app/api/routes/assets.py`, ADR-0029) and REQ-3's path-scoped
`CreateTestConditionForRequirementRequest`/`CreateTestCaseForTestConditionRequest`
(`app/api/routes/test_condition_authoring.py`, ADR-0028, API Document §4),
which deliberately omit the parent FK the factory would have required in the
body.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

TestConditionPriority = Literal["low", "medium", "high"]
TestCaseStatus = Literal["draft", "reviewed", "approved", "deprecated"]


# --- Requirement -------------------------------------------------------------------------------


class CreateRequirementRequest(BaseModel):
    """Body of `POST /requirements` — `project_id` is the required scope field.

    `title` is required ([ADR-0025](../../../docs/adr/0025-requirement-title-field.md)
    — gap-fill against FR-REQ-1/TC-REQ-001, which have always specified it).
    """

    project_id: UUID
    title: str
    description: str
    external_ref: str | None = None
    source: str | None = None


class UpdateRequirementRequest(BaseModel):
    """Body of `PATCH /requirements/{id}` — partial update, `exclude_unset` semantics.

    `project_id` is not reassignable through this route (no ADR/story asks
    for moving a `Requirement` across projects). `title` is optional here
    (ADR-0025) — same partial-update posture every other optional `PATCH`
    field in this codebase already uses.
    """

    title: str | None = None
    description: str | None = None
    external_ref: str | None = None
    source: str | None = None


class RequirementSummary(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str
    external_ref: str | None = None
    source: str | None = None


class RequirementListResponse(BaseModel):
    items: list[RequirementSummary]
    total: int
    page: int
    page_size: int


# --- TestCondition -------------------------------------------------------------------------------


class CreateTestConditionForRequirementRequest(BaseModel):
    """Body of `POST /requirements/{id}/test-conditions` (REQ-3, ADR-0028).

    Path-scoped: the parent `Requirement` is identified by the `{id}` path
    segment, so `requirement_id` is deliberately absent from the body — the
    route stamps it from the path, and a client that sends it anyway simply
    has the extra key ignored (Pydantic v2's default `extra="ignore"`, same
    posture as every other schema in this file).

    Replaces the generic factory's `CreateTestConditionRequest`, which only
    ever wrote the `TestCondition` row and never the
    `RequirementTestConditionLink` row FR-REQ-3 requires (ADR-0028).
    """

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
# No factory-registered `Create*Request`/`list` — `create` is reserved for
# two bespoke atomic-create routes (ADR-0022, API Document §4): `POST
# /requirements/{id}/test-cases` for REQ-2's direct link (`CreateTestCaseRequest`
# below, `app/api/routes/assets.py`, ADR-0029), and `POST
# /test-conditions/{id}/test-cases` for REQ-3's rigor path
# (`CreateTestCaseForTestConditionRequest` below,
# `app/api/routes/test_condition_authoring.py`, ADR-0028). `list` is
# deliberately not registered via the factory either: unlike every other
# scoped entity, `TestCase` has no single non-nullable FK the factory's
# `scope_field` mechanism could require as a list-scope query param
# (`test_condition_id` is nullable per ADR-0006, and the suite-link fallback
# is a many-to-many join, not a column) — requiring one would either wrongly
# 404 legitimately suite-only-linked test cases or leave `list` unscoped and
# leak across tenants (CLAUDE.md's multi-tenancy rule). `GET
# /requirements/{id}/test-cases` (REQ-2) is its own bespoke, requirement-
# scoped list instead. See this story's final report for this deviation from
# the plan's literal "everything else gets all 5 methods" framing.


class CreateTestCaseRequest(BaseModel):
    """Body of the bespoke `POST /requirements/{id}/test-cases` (REQ-2)
    direct-link atomic-create route.

    Neither the requirement id nor `test_condition_id` is a field here — the
    parent Requirement is the path segment, and this direct-link route never
    sets `test_condition_id` (ADR-0006: stays `null`). `test_level_id`/
    `test_type_id` are required non-nullable FKs on `TestCase` itself
    (Database Document §3.6) — REQ-2's "no forced TestCondition" lightweness
    doesn't extend to these, they're unrelated to the ISTQB-rigor question
    ADR-0006 resolved. `created_by_actor_id` is never accepted from the body
    — the route stamps it from the authenticated caller, same
    `_ACTOR_STAMPED_FIELDS` posture the generic factory already uses for
    `TestPlan.created_by_actor_id`. See `CreateTestCaseForTestConditionRequest`
    below for REQ-3's sibling schema, used by the rigor-path route instead —
    the two coexist per-TestCase within a project (ADR-0006).
    """

    title: str
    test_level_id: UUID
    test_type_id: UUID
    preconditions: str | None = None
    expected_result: str | None = None
    status: TestCaseStatus = "draft"


class CreateTestCaseForTestConditionRequest(BaseModel):
    """Body of `POST /test-conditions/{id}/test-cases` (REQ-3, ADR-0028).

    Path-scoped: `test_condition_id` comes from the `{id}` path segment, not
    the body. `status` is not accepted either — the route always creates the
    row as `draft` (ADR-0028's decision block); `created_by_actor_id` is
    stamped from the calling actor, never from the request (same posture
    ADR-0025 established for `CreateTestExecutionRequest`'s
    `executed_by_actor_id`: the field simply doesn't exist on the schema).

    Field shape mirrors REQ-2's `CreateTestCaseRequest` (same fields minus
    `status`, always `draft` here) — same body shape, different link table
    written server-side, per entity's own bespoke route (design spec
    §Components).
    """

    title: str
    preconditions: str | None = None
    expected_result: str | None = None
    test_level_id: UUID
    test_type_id: UUID


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


class TestCaseListResponse(BaseModel):
    """Shared response shape for the two bespoke `TestCase` list routes:
    `GET /requirements/{id}/test-cases` (REQ-2's requirement-scoped list — see
    `CreateTestCaseRequest`'s docstring for why `TestCase` has no
    factory-registered `list`) and `GET /test-suites/{id}/test-cases` (REQ-4's
    live suite-membership list, ADR-0030). Both page identically, so they share
    one schema rather than each declaring a structurally identical copy."""

    items: list[TestCaseSummary]
    total: int
    page: int
    page_size: int


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
    "CreateTestCaseForTestConditionRequest",
    "CreateTestCaseRequest",
    "CreateTestConditionForRequirementRequest",
    "CreateTestStepRequest",
    "CreateTestSuiteRequest",
    "RequirementListResponse",
    "RequirementSummary",
    "TestCaseListResponse",
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
