"""API-1: generic-CRUD factory routes for the planning cluster (ADR-0021).

`TestPlan`/`EntryExitCriteria`/`Environment` get all 5 methods. `TestCycle`
gets `GET`/`PATCH`/`DELETE` only — its own `create` is FR-PLAN-3's scope, not
built by this pass.

Resolver depths: `TestPlan`/`Environment` are direct (`project_id` ->
`Project.org_id`); `EntryExitCriteria`/`TestCycle` are one hop
(`test_plan_id` -> `TestPlan.project_id` -> `Project.org_id`).
"""

from fastapi import APIRouter

from app.api.crud_factory import CrudEntityConfig, chain_resolver, make_crud_router
from app.models.planning import EntryExitCriteria, Environment, TestCycle, TestPlan
from app.schemas.planning import (
    CreateEntryExitCriteriaRequest,
    CreateEnvironmentRequest,
    CreateTestPlanRequest,
    EntryExitCriteriaSummary,
    EnvironmentSummary,
    TestCycleSummary,
    TestPlanSummary,
    UpdateEntryExitCriteriaRequest,
    UpdateEnvironmentRequest,
    UpdateTestCycleRequest,
    UpdateTestPlanRequest,
)

router = APIRouter()

_TEST_PLAN_CONFIG = CrudEntityConfig(
    model=TestPlan,
    resource="test_plan",
    create_schema=CreateTestPlanRequest,
    update_schema=UpdateTestPlanRequest,
    summary_schema=TestPlanSummary,
    scope_field="project_id",
    resolve_org_id=chain_resolver([]),
)

_ENTRY_EXIT_CRITERIA_CONFIG = CrudEntityConfig(
    model=EntryExitCriteria,
    resource="entry_exit_criteria",
    create_schema=CreateEntryExitCriteriaRequest,
    update_schema=UpdateEntryExitCriteriaRequest,
    summary_schema=EntryExitCriteriaSummary,
    scope_field="test_plan_id",
    resolve_org_id=chain_resolver([(TestPlan, "test_plan_id")]),
)

_ENVIRONMENT_CONFIG = CrudEntityConfig(
    model=Environment,
    resource="environment",
    create_schema=CreateEnvironmentRequest,
    update_schema=UpdateEnvironmentRequest,
    summary_schema=EnvironmentSummary,
    scope_field="project_id",
    resolve_org_id=chain_resolver([]),
)

# No `create` — see module docstring.
_TEST_CYCLE_CONFIG = CrudEntityConfig(
    model=TestCycle,
    resource="test_cycle",
    create_schema=None,
    update_schema=UpdateTestCycleRequest,
    summary_schema=TestCycleSummary,
    scope_field="test_plan_id",
    resolve_org_id=chain_resolver([(TestPlan, "test_plan_id")]),
    methods=frozenset({"list", "get", "update", "delete"}),
)

router.include_router(make_crud_router(_TEST_PLAN_CONFIG))
router.include_router(make_crud_router(_ENTRY_EXIT_CRITERIA_CONFIG))
router.include_router(make_crud_router(_ENVIRONMENT_CONFIG))
router.include_router(make_crud_router(_TEST_CYCLE_CONFIG))

__all__ = ["router"]
