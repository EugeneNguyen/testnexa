"""API-1: generic-CRUD factory routes for `Defect` (ADR-0021).

New module, mirroring `app/models/execution.py`'s own cluster naming (per
the plan) — `TestExecution`/`TestLog` have no generic-CRUD routes at all
(`TestExecution`'s only exposure is `releases.py`'s bespoke nested audit
query; `TestLog` is append-only, read-only, no route in this pass).

`Defect` registers `GET`/`PATCH`/`DELETE` only — `create` stays reserved for
a future bespoke `POST /executions/{id}/defects` atomic-create route
(ADR-0021, API Document §4).

**`list`'s `scope_field`, a deviation from the plan flagged here:** the
ADR-0021 plan's resolver-map table marks `Defect`'s scope as "n/a, no create
via factory" — true for `create`, but `list` still needs *some* scope to
avoid enumerating every `Defect` across every tenant in one query
(CLAUDE.md's multi-tenancy rule: never skip the `org_id` filter, generic or
bespoke). `Defect.test_execution_id` is its own non-nullable direct FK — the
natural, safe `scope_field` choice, fitting the factory's generic shape with
no bespoke SQL needed (unlike `TestCase`, which has no equivalent
non-nullable column and so doesn't register `list` at all,
`app/schemas/assets.py`'s module docstring).
"""

from fastapi import APIRouter

from app.api.crud_factory import CrudEntityConfig, chain_resolver, make_crud_router
from app.models.execution import Defect, TestExecution
from app.models.planning import TestCycle, TestPlan
from app.schemas.execution import DefectSummary, UpdateDefectRequest

router = APIRouter()

_DEFECT_CONFIG = CrudEntityConfig(
    model=Defect,
    resource="defect",
    create_schema=None,
    update_schema=UpdateDefectRequest,
    summary_schema=DefectSummary,
    scope_field="test_execution_id",
    resolve_org_id=chain_resolver(
        [
            (TestExecution, "test_execution_id"),
            (TestCycle, "test_cycle_id"),
            (TestPlan, "test_plan_id"),
        ]
    ),
    filter_fields=("severity", "status"),
    search_fields=("external_ref",),
    methods=frozenset({"list", "get", "update", "delete"}),
)

router.include_router(make_crud_router(_DEFECT_CONFIG))

__all__ = ["router"]
