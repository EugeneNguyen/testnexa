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

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import (
    _actor_membership_exists,
    _DEFAULT_PAGE_SIZE,
    _MAX_PAGE_SIZE,
    CrudEntityConfig,
    NoSchema,
    ResolveOrgId,
    chain_resolver,
    make_crud_router,
    resolve_test_case_org_id,
)
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.assets import TestCase
from app.models.execution import Defect, TestExecution, TestExecutionResult, TestLog, TestLogEventType
from app.models.planning import TestCycle, TestPlan
from app.models.trace import TestCaseDefectLink
from app.schemas.execution import (
    AddTestLogCommentRequest,
    CreateDefectForExecutionRequest,
    DefectListResponse,
    DefectSummary,
    TestExecutionSummary,
    TestLogListResponse,
    TestLogSummary,
    UpdateDefectRequest,
    UpdateTestExecutionRequest,
)

router = APIRouter()

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."
_EXECUTION_NOT_FOUND_MESSAGE = "Test execution not found."


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Mirrors every other route module's own `_error()` verbatim (established
    per-module convention, see `execution_authoring.py`'s copy)."""
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "field_errors": None})

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


# --- EXEC-2: TestLog append helpers -------------------------------------------------------------
#
# `TestLogEventType.agent_action` is used whenever the *acting* actor is an
# `AIAgent` — it overrides what would otherwise be `status_change`/`comment`/
# `attachment`, rather than being a 4th, independently-triggered category (no
# MCP tool touches `TestExecution` yet, so "agent does something the other 3
# categories don't cover" has nothing to fire it — the story's own AC3 "when
# an agent takes an action... a TestLog row is appended" is satisfied this
# way instead: any of the other 3 actions, performed by an agent, appends an
# `agent_action` row whose `payload.kind` still records which one it was).


def _event_type_for_actor(actor: "User | AIAgent", human_event_type: TestLogEventType) -> TestLogEventType:
    return TestLogEventType.agent_action if isinstance(actor, AIAgent) else human_event_type


def build_status_change_log(
    test_execution_id: uuid.UUID,
    old_result: str | None,
    new_result: str,
    actor: "User | AIAgent",
) -> TestLog:
    """Build (not persist) a `status_change`/`agent_action` `TestLog` row.

    Shared by `execution_authoring.py`'s create route (initial recording,
    `old_result=None`) and this module's own `PATCH` hook below (a later
    correction) — one payload shape for both, so a timeline reader never has
    to special-case "was this the first result or a correction."
    """
    return TestLog(
        test_execution_id=test_execution_id,
        event_type=_event_type_for_actor(actor, TestLogEventType.status_change),
        payload={
            "kind": "status_change",
            "from": old_result,
            "to": new_result,
            "actor_id": str(actor.actor_id),
            "actor_type": "ai_agent" if isinstance(actor, AIAgent) else "user",
        },
    )


async def _test_execution_post_update_hook(
    row: TestExecution,
    old_values: dict[str, Any],
    updates: dict[str, Any],
    actor: "User | AIAgent",
    db: AsyncSession,
) -> None:
    """`_TEST_EXECUTION_CONFIG.post_update_hook` (EXEC-2 AC1): append a
    `TestLog` row only when `result` is actually part of this `PATCH` *and*
    its value actually changed — an `actual_result`/`executed_at`-only edit
    logs nothing (Q6 default: AC1's own example is a `result` correction,
    not every field edit).
    """
    if "result" not in updates:
        return
    old_result = old_values["result"]
    old_result_value = old_result.value if isinstance(old_result, TestExecutionResult) else old_result
    new_result_value = updates["result"]
    if isinstance(new_result_value, TestExecutionResult):
        new_result_value = new_result_value.value
    if old_result_value == new_result_value:
        return
    db.add(build_status_change_log(row.id, old_result_value, new_result_value, actor))


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
    # EXEC-2 AC1: append a `TestLog` row whenever `PATCH` actually changes
    # `result` (e.g. corrected pass -> fail) — see `_test_execution_post_update_hook`.
    post_update_hook=_test_execution_post_update_hook,
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


async def _fetch_execution_gated(
    db: AsyncSession, actor: "User | AIAgent", id: uuid.UUID, permission: str
) -> tuple[TestExecution | None, JSONResponse | None]:
    """Flat 404-vs-403 gate for the two bespoke `/executions/{id}/...` routes
    below — same shape `execution_authoring.py`'s create route already uses,
    reused rather than re-derived (`_resolve_test_execution_org_id` is this
    module's own resolver, not `crud_factory`'s private `_fetch_and_gate`,
    which isn't exported). Uses `_actor_membership_exists`, not the plain
    `_org_membership_exists`, since both routes below take a
    `User | AIAgent` actor (`backend/CLAUDE.md`'s standing rule)."""
    execution = await db.get(TestExecution, id)
    if execution is None:
        return None, _error(404, "not_found", _EXECUTION_NOT_FOUND_MESSAGE)

    org_id = await _resolve_test_execution_org_id(db, execution)
    if org_id is None or not await _actor_membership_exists(db, org_id, actor):
        return None, _error(404, "not_found", _EXECUTION_NOT_FOUND_MESSAGE)

    if not await has_permission(str(actor.actor_id), str(org_id), permission):
        return None, _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    return execution, None


@router.post(
    "/executions/{id}/comments",
    response_model=TestLogSummary,
    status_code=201,
)
async def add_test_execution_comment(
    id: uuid.UUID,
    payload: AddTestLogCommentRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestLogSummary | JSONResponse:
    """FR-EXEC-2 AC1's "comment"/"attachment" triggers: appends one `TestLog`
    row, no separate `Comment`/execution-scoped `Attachment` entity (see
    `AddTestLogCommentRequest`'s own docstring). Gated `test_execution.update`
    — same permission a `result` correction already requires, already seeded
    for `tester`/`ai_agent_scoped` (no RBAC migration needed).
    """
    execution, error = await _fetch_execution_gated(db, actor, id, "test_execution.update")
    if error is not None:
        return error
    assert execution is not None

    is_attachment = payload.attachment_url is not None or payload.file_name is not None
    human_event_type = TestLogEventType.attachment if is_attachment else TestLogEventType.comment
    log = TestLog(
        test_execution_id=execution.id,
        event_type=_event_type_for_actor(actor, human_event_type),
        payload={
            "kind": "attachment" if is_attachment else "comment",
            "text": payload.text,
            "attachment_url": payload.attachment_url,
            "file_name": payload.file_name,
            "actor_id": str(actor.actor_id),
            "actor_type": "ai_agent" if isinstance(actor, AIAgent) else "user",
        },
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    return TestLogSummary(
        id=log.id,
        test_execution_id=log.test_execution_id,
        logged_at=log.logged_at,
        event_type=log.event_type.value if hasattr(log.event_type, "value") else log.event_type,
        payload=log.payload,
    )


@router.get(
    "/executions/{id}/logs",
    response_model=TestLogListResponse,
)
async def list_test_execution_logs(
    id: uuid.UUID,
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestLogListResponse | JSONResponse:
    """FR-EXEC-2 AC3: a `TestExecution`'s full history as an ordered `TestLog`
    timeline, oldest first — the bespoke, purpose-built equivalent of the
    generic factory's `GET /test-logs?test_execution_id=<uuid>` (same
    `test_log.read`-gated rows, no ordering guarantee promised there).
    """
    execution, error = await _fetch_execution_gated(db, actor, id, "test_execution.read")
    if error is not None:
        return error
    assert execution is not None

    page_size = min(max(page_size, 1), _MAX_PAGE_SIZE)
    page = max(page, 1)

    base_query = select(TestLog).where(TestLog.test_execution_id == id)
    total = await db.scalar(select(func.count()).select_from(base_query.subquery()))
    rows = (
        await db.scalars(
            base_query.order_by(TestLog.logged_at.asc(), TestLog.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()

    return TestLogListResponse(
        items=[
            TestLogSummary(
                id=row.id,
                test_execution_id=row.test_execution_id,
                logged_at=row.logged_at,
                event_type=row.event_type.value if hasattr(row.event_type, "value") else row.event_type,
                payload=row.payload,
            )
            for row in rows
        ],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/executions/{id}/defects",
    response_model=DefectSummary,
    status_code=201,
)
async def raise_defect_for_execution(
    id: uuid.UUID,
    payload: CreateDefectForExecutionRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> DefectSummary | JSONResponse:
    """FR-EXEC-3 AC1 (EXEC-3, ADR-0044): raise a `Defect` from a failed
    `TestExecution`, atomically linking it to the originating `TestCase` via
    `TestCaseDefectLink`.

    Reuses `_fetch_execution_gated`/`_resolve_test_execution_org_id` verbatim
    — no new resolver. Past the 404-vs-403 boundary, a target execution whose
    `result != fail` is a business-rule rejection (`422`, never `404` — the
    caller has already proven org membership and the execution genuinely
    exists), AC1's own literal precondition.
    """
    execution, error = await _fetch_execution_gated(db, actor, id, "defect.create")
    if error is not None:
        return error
    assert execution is not None

    if execution.result != TestExecutionResult.fail:
        return _error(
            422,
            "validation_error",
            "Defects can only be raised against a failed test execution.",
        )

    defect = Defect(
        test_execution_id=execution.id,
        reported_by_actor_id=actor.actor_id,
        external_ref=payload.external_ref,
        severity=payload.severity,
        **({"status": payload.status} if payload.status is not None else {}),
    )
    db.add(defect)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    db.add(TestCaseDefectLink(test_case_id=execution.test_case_id, defect_id=defect.id))
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    await db.commit()
    await db.refresh(defect)

    return DefectSummary(
        id=defect.id,
        test_execution_id=defect.test_execution_id,
        reported_by_actor_id=defect.reported_by_actor_id,
        external_ref=defect.external_ref,
        severity=defect.severity.value if hasattr(defect.severity, "value") else defect.severity,
        status=defect.status,
    )


async def _fetch_test_case_gated(
    db: AsyncSession, actor: "User | AIAgent", id: uuid.UUID, permission: str
) -> tuple[TestCase | None, JSONResponse | None]:
    """Flat 404-vs-403 gate for `GET /test-cases/{id}/defects`, reusing
    `TestCase`'s existing 3-branch resolver (ADR-0029) rather than a new one.
    """
    test_case = await db.get(TestCase, id)
    if test_case is None:
        return None, _error(404, "not_found", "Test case not found.")

    org_id = await resolve_test_case_org_id(db, test_case)
    if org_id is None or not await _actor_membership_exists(db, org_id, actor):
        return None, _error(404, "not_found", "Test case not found.")

    if not await has_permission(str(actor.actor_id), str(org_id), permission):
        return None, _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    return test_case, None


@router.get(
    "/test-cases/{id}/defects",
    response_model=DefectListResponse,
)
async def list_defects_for_test_case(
    id: uuid.UUID,
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> DefectListResponse | JSONResponse:
    """FR-EXEC-3 AC3 (EXEC-3, ADR-0044): every Defect ever raised against any
    of this TestCase's executions, most recent first.

    Not the generic factory's `GET /test-case-defect-links?test_case_id=`
    equivalent (bare link rows, no `Defect` fields, no ordering guarantee) —
    this is the ordering-guaranteed, `Defect`-field-bearing purpose-built
    read, same relationship `GET /executions/{id}/logs` (EXEC-2) already has
    to its own generic-list equivalent.
    """
    test_case, error = await _fetch_test_case_gated(db, actor, id, "defect.read")
    if error is not None:
        return error
    assert test_case is not None

    page_size = min(max(page_size, 1), _MAX_PAGE_SIZE)
    page = max(page, 1)

    base_query = (
        select(Defect)
        .join(TestCaseDefectLink, TestCaseDefectLink.defect_id == Defect.id)
        .where(TestCaseDefectLink.test_case_id == id)
    )
    total = await db.scalar(select(func.count()).select_from(base_query.subquery()))
    rows = (
        await db.scalars(
            base_query.order_by(Defect.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()

    return DefectListResponse(
        items=[
            DefectSummary(
                id=row.id,
                test_execution_id=row.test_execution_id,
                reported_by_actor_id=row.reported_by_actor_id,
                external_ref=row.external_ref,
                severity=row.severity.value if hasattr(row.severity, "value") else row.severity,
                status=row.status,
            )
            for row in rows
        ],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


__all__ = ["router", "build_status_change_log"]
