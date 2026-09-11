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

from app.api.crud_factory import (
    CrudEntityConfig,
    FieldMeta,
    ScopeSelectorOption,
    chain_resolver,
    make_crud_router,
)
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
    # ADR-0053. `status` is `TestPlanStatus | None` on the create schema (an
    # omitted value takes the column's own `draft` default), so it derives as
    # not-required — but the admin create form has always presented it as a
    # required choice (`entityConfigs/test-plan.ts`), and a `<select>` with a
    # legal default is required from the *form's* point of view regardless of
    # what the wire contract tolerates. Declared explicitly rather than
    # letting the derived shape quietly drop the constraint.
    label="Test plans",
    field_meta={
        "project_id": FieldMeta(ref_entity="project", label_field="name", label="Project"),
        "scope": FieldMeta(show_in_table=False),
        "approach": FieldMeta(show_in_table=False),
        "staffing_and_training": FieldMeta(label="Staffing & training", show_in_table=False),
        "schedule": FieldMeta(show_in_table=False),
        "status": FieldMeta(required=True),
        # Factory-auto-stamped (`_ACTOR_STAMPED_FIELDS`), never client-supplied:
        # summary-only, so it already derives `readOnly`. Hidden from the table
        # too — there is no `User`/`AIAgent` ref entity on this surface to
        # render it as anything but a raw UUID (ADR-0025), which is why the
        # hand-written config omitted it outright.
        "created_by_actor_id": FieldMeta(label="Created by", show_in_table=False),
    },
)

_ENTRY_EXIT_CRITERIA_CONFIG = CrudEntityConfig(
    model=EntryExitCriteria,
    resource="entry_exit_criteria",
    create_schema=CreateEntryExitCriteriaRequest,
    update_schema=UpdateEntryExitCriteriaRequest,
    summary_schema=EntryExitCriteriaSummary,
    scope_field="test_plan_id",
    resolve_org_id=chain_resolver([(TestPlan, "test_plan_id")]),
    # ADR-0053. `scope_field` is `test_plan_id`, not `project_id` — there is
    # no route listing `EntryExitCriteria` by project — so the list can't
    # fetch until the admin picks a `TestPlan` (the same scope-selector shape
    # `entityConfigs/entry-exit-criteria.ts` already flagged as a deliberate
    # deviation from the Sitemap's "plain project-scoped table" classification).
    label="Entry/exit criteria",
    scope_selector=ScopeSelectorOption(ref_entity="test-plan", param_name="test_plan_id"),
    field_meta={
        "test_plan_id": FieldMeta(ref_entity="test-plan", label_field="identifier", label="Test plan"),
        "condition_text": FieldMeta(label="Condition"),
    },
)

_ENVIRONMENT_CONFIG = CrudEntityConfig(
    model=Environment,
    resource="environment",
    create_schema=CreateEnvironmentRequest,
    update_schema=UpdateEnvironmentRequest,
    summary_schema=EnvironmentSummary,
    scope_field="project_id",
    resolve_org_id=chain_resolver([]),
    # ADR-0053. Direct project scope, so no scope-selector: the list fires
    # immediately with the route's own `:projectId`.
    label="Environments",
    field_meta={"project_id": FieldMeta(ref_entity="project", label_field="name", label="Project")},
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
    # ADR-0053. Same `test_plan_id`-not-`project_id` scope-selector shape as
    # `_ENTRY_EXIT_CRITERIA_CONFIG` above. `test_plan_id`/`release_id` derive
    # as readOnly (absent from `UpdateTestCycleRequest` — not reassignable
    # through this route) and nothing derives as required, because the real
    # create is the bespoke `POST /test-plans/{id}/test-cycles`
    # (`test_cycle_creation.py`) and this config's `create_schema` is `None`:
    # a "required on create" claim would describe a form that doesn't exist.
    label="Test cycles",
    scope_selector=ScopeSelectorOption(ref_entity="test-plan", param_name="test_plan_id"),
    # Both FK/scope fields are summary-only, so they derive last without this;
    # every hand-written config led with them.
    field_order=("test_plan_id", "release_id", "environment_id", "name", "start_date", "end_date"),
    field_meta={
        "test_plan_id": FieldMeta(ref_entity="test-plan", label_field="identifier", label="Test plan"),
        "release_id": FieldMeta(ref_entity="release", label_field="version_label", label="Release"),
        "environment_id": FieldMeta(ref_entity="environment", label_field="name", label="Environment"),
    },
)

router.include_router(make_crud_router(_TEST_PLAN_CONFIG))
router.include_router(make_crud_router(_ENTRY_EXIT_CRITERIA_CONFIG))
router.include_router(make_crud_router(_ENVIRONMENT_CONFIG))
router.include_router(make_crud_router(_TEST_CYCLE_CONFIG))

__all__ = ["router"]
