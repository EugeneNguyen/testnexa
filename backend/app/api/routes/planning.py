"""API-1: generic-CRUD factory routes for the planning cluster (ADR-0022).

`TestPlan`/`EntryExitCriteria`/`Environment` get all 5 methods. `TestCycle`
gets `list`/`GET`/`PATCH`/`DELETE` only — its `create` is **bespoke**, not
generic: `POST /test-plans/{id}/test-cycles` in `test_cycle_creation.py`
(PLAN-3/ADR-0033). The factory has no hook for a create that must fetch and
validate two *other* rows (`Release`, `Environment`) beyond the entity's own
scope field, so `create_schema` stays `None` here permanently — this is now a
deliberate, closed decision, no longer "FR-PLAN-3's scope, not built yet."

Resolver depths: `TestPlan`/`Environment` are direct (`project_id` ->
`Project.org_id`); `EntryExitCriteria`/`TestCycle` are one hop
(`test_plan_id` -> `TestPlan.project_id` -> `Project.org_id`).

PLAN-1/ADR-0031 adds one thing here and nothing else: a `status`-transition
legality guard on `TestPlan`'s existing factory-produced `PATCH` route (see
`_test_plan_status_guard` below). `TestPlan`'s membership/coverage routes
live in their own module, `test_plan_membership.py`, following the same split
ADR-0028/ADR-0030 established for their own bespoke modules.
"""

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.api.crud_factory import CrudEntityConfig, chain_resolver, make_crud_router
from app.core.plan_status import (
    INVALID_STATUS_TRANSITION_CODE,
    INVALID_STATUS_TRANSITION_MESSAGE,
    is_legal_status_transition,
)
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


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors every other route module's own `_error()` verbatim — this
    codebase's established per-module convention is a local copy, not a
    shared import.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


def _test_plan_status_guard(row: TestPlan, updates: dict[str, Any]) -> JSONResponse | None:
    """Reject an illegal `TestPlan.status` transition on `PATCH` (ADR-0031).

    Scoped to the `status` field alone. `updates` comes from
    `model_dump(exclude_unset=True)`, so a body that never mentions `status`
    leaves `"status" not in updates` and this returns `None` immediately —
    `identifier`/`scope`/`approach`/`staffing_and_training`/`schedule` remain a
    plain partial update, unaffected by the plan's current status. Test Design
    §27 pins that independence with a test against a `superseded` (terminal)
    plan specifically, precisely to prove the guard did not accidentally scope
    itself to the whole route.

    `row.status` is a `TestPlanStatus` enum member (the ORM's own type) while
    the requested value arrives from the request body as a plain string (the
    `TestPlanStatus` *`Literal`* in `app.schemas.planning`, a different type of
    the same name). Both are normalized to their string value before the
    comparison, so the check can never silently fail by comparing an enum
    member against an equal-looking `str` — the exact hazard of having two
    types share a name across the model and schema layers.

    An explicit `status: null` is treated as "not a transition request": the
    column is non-nullable, and the factory's own `create` path already reads
    an explicit `null` `status` as equivalent to omitting it
    (`CreateTestPlanRequest`'s docstring). Letting it through here would hand
    `setattr` a `None` for a non-nullable column, which the existing
    `IntegrityError` -> `422` branch below already handles as malformed input —
    the correct outcome, and not this guard's business to relabel as a `409`.
    """
    if "status" not in updates:
        return None

    requested = updates["status"]
    if requested is None:
        return None

    current_value = row.status.value if hasattr(row.status, "value") else str(row.status)
    requested_value = requested.value if hasattr(requested, "value") else str(requested)

    if is_legal_status_transition(current_value, requested_value):
        return None

    return _error(409, INVALID_STATUS_TRANSITION_CODE, INVALID_STATUS_TRANSITION_MESSAGE)


_TEST_PLAN_CONFIG = CrudEntityConfig(
    model=TestPlan,
    resource="test_plan",
    create_schema=CreateTestPlanRequest,
    update_schema=UpdateTestPlanRequest,
    summary_schema=TestPlanSummary,
    scope_field="project_id",
    resolve_org_id=chain_resolver([]),
    # PLAN-1/ADR-0031 — the only entity in this codebase with an update guard.
    update_guard=_test_plan_status_guard,
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

# No `create` — bespoke instead (`test_cycle_creation.py`), see module docstring.
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
