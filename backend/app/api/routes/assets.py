"""API-1: generic-CRUD factory routes for the assets cluster (ADR-0022).

`Requirement`, `TestCondition`, `TestStep`, `TestSuite` get all 5 methods.
`TestCase` gets `GET`/`PATCH`/`DELETE` only — `create` stays reserved for a
future bespoke atomic-create route (ADR-0022, API Document §4), and `list` is
deliberately not registered at all (see `app/schemas/assets.py`'s module
docstring for why: no single non-nullable FK exists to use as a safe,
tenant-isolating `scope_field`).

Resolver depths (API Document §3's table): `Requirement`/`TestSuite` are
direct (`project_id` -> `Project.org_id`); `TestCondition` is one hop
(`requirement_id` -> `Requirement.project_id` -> `Project.org_id`);
`TestCase` is the bespoke branching+fallback resolver; `TestStep` delegates
to `TestCase`'s resolver one hop up.
"""

from fastapi import APIRouter

from app.api.crud_factory import (
    CrudEntityConfig,
    chain_resolver,
    make_crud_router,
    resolve_test_case_org_id,
    resolve_via_test_case,
)
from app.models.assets import Requirement, TestCase, TestCondition, TestStep, TestSuite
from app.schemas.assets import (
    CreateRequirementRequest,
    CreateTestConditionRequest,
    CreateTestStepRequest,
    CreateTestSuiteRequest,
    RequirementSummary,
    TestCaseSummary,
    TestConditionSummary,
    TestStepSummary,
    TestSuiteSummary,
    UpdateRequirementRequest,
    UpdateTestCaseRequest,
    UpdateTestConditionRequest,
    UpdateTestStepRequest,
    UpdateTestSuiteRequest,
)

router = APIRouter()

_REQUIREMENT_CONFIG = CrudEntityConfig(
    model=Requirement,
    resource="requirement",
    create_schema=CreateRequirementRequest,
    update_schema=UpdateRequirementRequest,
    summary_schema=RequirementSummary,
    scope_field="project_id",
    resolve_org_id=chain_resolver([]),
    filter_fields=("external_ref",),
    search_fields=("title", "description", "external_ref", "source"),
)

_TEST_CONDITION_CONFIG = CrudEntityConfig(
    model=TestCondition,
    resource="test_condition",
    create_schema=CreateTestConditionRequest,
    update_schema=UpdateTestConditionRequest,
    summary_schema=TestConditionSummary,
    scope_field="requirement_id",
    resolve_org_id=chain_resolver([(Requirement, "requirement_id")]),
)

# No `list`/`create` — see module docstring.
_TEST_CASE_CONFIG = CrudEntityConfig(
    model=TestCase,
    resource="test_case",
    create_schema=None,
    update_schema=UpdateTestCaseRequest,
    summary_schema=TestCaseSummary,
    scope_field=None,
    resolve_org_id=resolve_test_case_org_id,
    filter_fields=("status", "test_level_id", "test_type_id"),
    search_fields=("title", "preconditions", "expected_result"),
    methods=frozenset({"get", "update", "delete"}),
)

_TEST_STEP_CONFIG = CrudEntityConfig(
    model=TestStep,
    resource="test_step",
    create_schema=CreateTestStepRequest,
    update_schema=UpdateTestStepRequest,
    summary_schema=TestStepSummary,
    scope_field="test_case_id",
    resolve_org_id=resolve_via_test_case,
)

_TEST_SUITE_CONFIG = CrudEntityConfig(
    model=TestSuite,
    resource="test_suite",
    create_schema=CreateTestSuiteRequest,
    update_schema=UpdateTestSuiteRequest,
    summary_schema=TestSuiteSummary,
    scope_field="project_id",
    resolve_org_id=chain_resolver([]),
)

router.include_router(make_crud_router(_REQUIREMENT_CONFIG))
router.include_router(make_crud_router(_TEST_CONDITION_CONFIG))
router.include_router(make_crud_router(_TEST_CASE_CONFIG))
router.include_router(make_crud_router(_TEST_STEP_CONFIG))
router.include_router(make_crud_router(_TEST_SUITE_CONFIG))

__all__ = ["router"]
