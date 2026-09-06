"""REQ-3: the rigor path — bespoke atomic `TestCondition`/`TestCase` creates (ADR-0028).

Source: API Document §4 (`POST /requirements/{id}/test-conditions`,
`POST /test-conditions/{id}/test-cases` contracts), ADR-0028 (bespoke
atomic-create routes + generic-factory `TestCondition.create` restriction +
`test_manager` RBAC bundle extension), ADR-0005 (dedicated link tables),
ADR-0006 (`TestCondition` optional).

Two routes, one shape. Both write **two** rows in a single transaction — the
entity row plus its dedicated traceability link row (ADR-0005) — which is
exactly why neither can be served by the generic CRUD factory
(`app/api/crud_factory.py`): `create_item` only ever inserts the entity's own
row and has no concept of a second, per-entity link-table insert (ADR-0028's
Alternatives section rejects bolting one on). Kept in their own module rather
than in `assets.py`, whose docstring scopes it to generic-factory routes only
— same split PROJ-2 made when it gave `Release` its own `releases.py`.

Gating is identical to every other bespoke route in this codebase
(`releases.py`'s `POST /projects/{project_id}/releases` is the canonical
precedent):

1. Fetch the parent row named by the path segment.
2. Resolve its `org_id` by reusing the factory's own `chain_resolver` — the
   *same* resolver expression `_TEST_CONDITION_CONFIG`/`_REQUIREMENT_CONFIG`
   already use in `assets.py`, so the tenant walk can never drift between the
   generic and bespoke surfaces for these entities.
3. Missing parent row OR unresolvable org OR caller has no `OrgMembership`
   (any status) in the resolved org -> `404`, indistinguishable from each
   other (NFR-1/ADR-0007 existence-hiding: cross-tenant access is never
   confirmable, so it is never `403`).
4. Membership present but the permission is missing -> `403`, via
   `has_permission` called directly (`require_permission` reads `org_id`/
   `project_id` off *path* params and there is no `org_id` segment at this
   depth — same reason `releases.py`/the factory both call `has_permission`
   directly).

`IntegrityError` on flush -> rollback -> `422`, mirroring the factory's own
`create_item`: a bad `test_level_id`/`test_type_id` FK is caught at the DB
rather than pre-checked with an extra existence query (design spec
§"Data flow / error handling").

One deliberate departure from the older route modules
(`releases.py`/`projects.py`/`role_assignments.py`/...), each of which keeps
its own verbatim copy of `_org_membership_exists`: this module imports the
factory's copy instead, per ADR-0028's "reuse 100% of ADR-0022's existing
resolver/permission-check primitives — no new backend architecture". The
copy-per-module convention predates the factory; duplicating a seventh
identical implementation would add a place for the NFR-1 boundary to drift.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import _org_membership_exists, chain_resolver
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.assets import Requirement, TestCase, TestCaseStatus, TestCondition
from app.models.trace import RequirementTestConditionLink, TestConditionTestCaseLink
from app.schemas.assets import (
    CreateTestCaseForTestConditionRequest,
    CreateTestConditionForRequirementRequest,
    TestCaseSummary,
    TestConditionSummary,
)

router = APIRouter()

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."

# The exact resolver expressions `assets.py`'s `_REQUIREMENT_CONFIG`/
# `_TEST_CONDITION_CONFIG` already use, reused verbatim rather than
# re-derived: `Requirement` carries `project_id` directly (empty hop list ->
# `resolve_terminal_org_id`), `TestCondition` is one hop up to `Requirement`.
_resolve_requirement_org_id = chain_resolver([])
_resolve_test_condition_org_id = chain_resolver([(Requirement, "requirement_id")])


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `releases.py`/`projects.py`/`crud_factory.py`'s own `_error()`
    verbatim — this codebase's established per-module convention is a local
    copy, not a shared import.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


@router.post(
    "/requirements/{id}/test-conditions",
    response_model=TestConditionSummary,
    status_code=201,
)
async def create_test_condition_for_requirement(
    id: UUID,
    payload: CreateTestConditionForRequirementRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestConditionSummary | JSONResponse:
    """Create a `TestCondition` under Requirement `id`, plus its link row (FR-REQ-3 AC1).

    One transaction: `INSERT test_condition` -> `flush()` (to obtain the new
    id) -> `INSERT requirement_test_condition_link` -> `commit()`. A link row
    therefore can never exist without its `TestCondition`, nor the reverse —
    the whole point of this route existing instead of the generic
    `POST /test-conditions` it replaces (ADR-0028).
    """
    requirement = await db.get(Requirement, id)
    if requirement is None:
        return _error(404, "not_found", "Requirement not found.")

    org_id = await _resolve_requirement_org_id(db, requirement)
    if org_id is None or not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Requirement not found.")

    if not await has_permission(str(actor.actor_id), str(org_id), "test_condition.create"):
        return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    test_condition = TestCondition(
        requirement_id=requirement.id,
        description=payload.description,
        priority=payload.priority,
    )
    db.add(test_condition)
    try:
        await db.flush()
        db.add(
            RequirementTestConditionLink(
                requirement_id=requirement.id,
                test_condition_id=test_condition.id,
            )
        )
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    await db.commit()
    await db.refresh(test_condition)

    return TestConditionSummary(
        id=test_condition.id,
        requirement_id=test_condition.requirement_id,
        description=test_condition.description,
        # `.value` extracted explicitly rather than relying on `str, Enum`'s
        # implicit str behavior — same posture `releases.py` uses for
        # `TestExecutionResult` and `crud_factory._to_summary` for every
        # `Enum` column, `hasattr`-guarded for the same reason.
        priority=test_condition.priority.value
        if hasattr(test_condition.priority, "value")
        else test_condition.priority,
    )


@router.post(
    "/test-conditions/{id}/test-cases",
    response_model=TestCaseSummary,
    status_code=201,
)
async def create_test_case_for_test_condition(
    id: UUID,
    payload: CreateTestCaseForTestConditionRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestCaseSummary | JSONResponse:
    """Create a `TestCase` under TestCondition `id`, plus its link row (FR-REQ-3 AC2).

    `status` is always `draft` and `created_by_actor_id` is always the calling
    actor — neither is accepted from the body (see
    `CreateTestCaseForTestConditionRequest`). Same single-transaction
    entity-then-link write as the sibling route above; a nonexistent
    `test_level_id`/`test_type_id` surfaces as an FK `IntegrityError` on the
    first flush -> rollback -> `422`, with no separate existence pre-check
    (matching `crud_factory.create_item`'s posture).
    """
    test_condition = await db.get(TestCondition, id)
    if test_condition is None:
        return _error(404, "not_found", "Test condition not found.")

    org_id = await _resolve_test_condition_org_id(db, test_condition)
    if org_id is None or not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Test condition not found.")

    if not await has_permission(str(actor.actor_id), str(org_id), "test_case.create"):
        return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    test_case = TestCase(
        test_condition_id=test_condition.id,
        test_level_id=payload.test_level_id,
        test_type_id=payload.test_type_id,
        created_by_actor_id=actor.actor_id,
        title=payload.title,
        preconditions=payload.preconditions,
        expected_result=payload.expected_result,
        status=TestCaseStatus.draft,
    )
    db.add(test_case)
    try:
        await db.flush()
        db.add(
            TestConditionTestCaseLink(
                test_condition_id=test_condition.id,
                test_case_id=test_case.id,
            )
        )
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    await db.commit()
    await db.refresh(test_case)

    return TestCaseSummary(
        id=test_case.id,
        test_condition_id=test_case.test_condition_id,
        test_level_id=test_case.test_level_id,
        test_type_id=test_case.test_type_id,
        created_by_actor_id=test_case.created_by_actor_id,
        title=test_case.title,
        preconditions=test_case.preconditions,
        expected_result=test_case.expected_result,
        status=test_case.status.value if hasattr(test_case.status, "value") else test_case.status,
    )


__all__ = ["router"]
