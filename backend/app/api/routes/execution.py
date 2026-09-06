"""API-1/ADR-0025: generic-CRUD factory routes for `Defect`, `TestExecution`, `TestLog`.

`TestExecution`'s only prior exposure was `releases.py`'s bespoke nested
audit query (`GET /releases/{id}/test-cycles`) — ADR-0025 added full
generic-CRUD routes for it here. **PLAN-3/ADR-0033 narrows that to
`GET`/`PATCH`/`DELETE`**: `create` is dropped from `_TEST_EXECUTION_CONFIG`
below (`create_schema=None`) in favor of the bespoke
`POST /test-cycles/{id}/executions` in `execution_authoring.py`, which enforces
FR-PLAN-3 AC3's scope check. This restriction is not optional and had to land
in the same change as that route (`backend/CLAUDE.md`'s standing rule): the
generic `POST /test-executions` enforced no scope check at all, so leaving it
reachable alongside the bespoke route would let any caller bypass the gate
entirely by using the unrestricted path. Same posture
`TestCase`/`TestCondition`/`Defect` already have.

`TestLog` is append-only/immutable by schema (no `updated_at` column, Database
Document §3.8) — `list`/`get` only, no `create`/`update`/`delete` route is ever
registered for it, generic or bespoke.

`Defect` registers `GET`/`PATCH`/`DELETE` only — `create` stays reserved for
a future bespoke `POST /executions/{id}/defects` atomic-create route
(ADR-0022, API Document §4).

**`list`'s `scope_field`, a deviation from the plan flagged here:** the
ADR-0022 plan's resolver-map table marks `Defect`'s scope as "n/a, no create
via factory" — true for `create`, but `list` still needs *some* scope to
avoid enumerating every `Defect` across every tenant in one query
(CLAUDE.md's multi-tenancy rule: never skip the `org_id` filter, generic or
bespoke). `Defect.test_execution_id` is its own non-nullable direct FK — the
natural, safe `scope_field` choice, fitting the factory's generic shape with
no bespoke SQL needed (unlike `TestCase`, which has no equivalent
non-nullable column and so doesn't register `list` at all,
`app/schemas/assets.py`'s module docstring).

**`TestExecution`'s resolver, a deviation from ADR-0025's own prose flagged
here:** the ADR (and the API Document's §3 resolver table) both describe
`resolve_org_id` as `chain_resolver([(TestCycle, "test_cycle_id")])` ->
"`TestCycle.project_id` -> `Project.org_id`" — but `TestCycle`
(`app/models/planning.py`) has no `project_id` column at all, only
`test_plan_id` (`TestCycle.test_plan_id` -> `TestPlan.project_id` ->
`Project.org_id`). This is the exact 3-hop shape `Defect`'s own resolver
above already walks (`TestExecution` -> `TestCycle` -> `TestPlan`) and that
`tests/unit/test_crud_factory.py::TestChainResolver
.test_multi_hop_resolves_through_full_chain` already exercises verbatim — so
`TestExecution`'s resolver here is `chain_resolver([(TestCycle,
"test_cycle_id"), (TestPlan, "test_plan_id")])`, one hop deeper than the
ADR's literal text, trusting the actual model/test over the prose (the ADR's
text appears to have skipped `TestCycle`'s own indirection through
`TestPlan`).
"""

import uuid
from typing import Any

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import (
    CrudEntityConfig,
    NoSchema,
    ResolveOrgId,
    chain_resolver,
    make_crud_router,
)
from app.models.execution import Defect, TestExecution, TestLog
from app.models.planning import TestCycle, TestPlan
from app.schemas.execution import (
    DefectSummary,
    TestExecutionSummary,
    TestLogSummary,
    UpdateDefectRequest,
    UpdateTestExecutionRequest,
)

router = APIRouter()

# Shared by `Defect` and `TestExecution` — see this module's docstring for
# why this is 2 hops (`TestCycle` -> `TestPlan`), not 1.
_resolve_test_execution_org_id: ResolveOrgId = chain_resolver(
    [(TestCycle, "test_cycle_id"), (TestPlan, "test_plan_id")]
)


async def _resolve_test_log_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """`TestLog`'s resolver: fetch its `TestExecution` row, delegate one further hop.

    Mirrors `resolve_via_test_case`'s "fetch parent row, then hand it to the
    parent's own resolver" shape (`app/api/crud_factory.py`) — `TestLog` has
    no FK chain of its own beyond `test_execution_id`, so this is a thin
    fetch-then-delegate, not new resolver logic.
    """
    test_execution_id = getattr(row, "test_execution_id", None)
    if test_execution_id is None:
        return None
    execution = await db.get(TestExecution, test_execution_id)
    if execution is None:
        return None
    return await _resolve_test_execution_org_id(db, execution)


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

# No `create` — PLAN-3/ADR-0033 (see module docstring). `list`/`get`/`update`/
# `delete` are unchanged: the restriction is `create`-only, not an accidental
# blanket removal (TC-PLAN-017 asserts exactly that split).
_TEST_EXECUTION_CONFIG = CrudEntityConfig(
    model=TestExecution,
    resource="test_execution",
    create_schema=None,
    update_schema=UpdateTestExecutionRequest,
    summary_schema=TestExecutionSummary,
    scope_field="test_cycle_id",
    resolve_org_id=_resolve_test_execution_org_id,
    filter_fields=("test_case_id", "result"),
    methods=frozenset({"list", "get", "update", "delete"}),
)

_TEST_LOG_CONFIG = CrudEntityConfig(
    model=TestLog,
    resource="test_log",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=TestLogSummary,
    scope_field="test_execution_id",
    resolve_org_id=_resolve_test_log_org_id,
    filter_fields=("event_type",),
    methods=frozenset({"list", "get"}),
)

router.include_router(make_crud_router(_DEFECT_CONFIG))
router.include_router(make_crud_router(_TEST_EXECUTION_CONFIG))
router.include_router(make_crud_router(_TEST_LOG_CONFIG))

__all__ = ["router"]
