"""API-1: generic-CRUD factory routes for the assets cluster (ADR-0022),
plus REQ-2's bespoke atomic-create/list routes.

`Requirement`, `TestStep`, `TestSuite` get all 5 factory methods.

`TestCase` gets `GET`/`PATCH`/`DELETE` via the factory only — `create` is
bespoke instead, and there are two such bespoke create routes, coexisting
per-TestCase within a project (ADR-0006): `POST /requirements/{id}/test-cases`
(below, this module) for REQ-2's direct-link path, and
`POST /test-conditions/{id}/test-cases`
(`app/api/routes/test_condition_authoring.py`) for REQ-3's rigor path
(ADR-0028). `list` is deliberately not registered via the factory at all —
`TestCase` has no single non-nullable FK the factory's `scope_field`
mechanism could use as a safe, tenant-isolating list scope (see
`app/schemas/assets.py`'s module docstring); `GET /requirements/{id}/test-cases`
(below) is REQ-2's own bespoke, requirement-scoped list instead.

`TestCondition` gets `GET`/`PATCH`/`DELETE`/`list` — its `create` was
withdrawn from the factory by REQ-3/ADR-0028 for the same reason `TestCase`'s
never registered: the factory only ever inserts the entity's own row, so it
silently produced a `TestCondition` with no `RequirementTestConditionLink`
row, breaking FR-REQ-3 AC1's traceability claim. `POST
/requirements/{id}/test-conditions`
(`app/api/routes/test_condition_authoring.py`) is now the only creation path.

Resolver depths (API Document §3's table): `Requirement`/`TestSuite` are
direct (`project_id` -> `Project.org_id`); `TestCondition` is one hop
(`requirement_id` -> `Requirement.project_id` -> `Project.org_id`);
`TestCase` is the bespoke branching+fallback resolver (ADR-0029); `TestStep`
delegates to `TestCase`'s resolver one hop up.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import (
    CrudEntityConfig,
    FieldMeta,
    ScopeSelectorOption,
    chain_resolver,
    make_crud_router,
    resolve_test_case_org_id,
    resolve_via_test_case,
)
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.assets import Requirement, TestCase, TestCondition, TestStep, TestSuite
from app.models.project import Project
from app.models.tenancy import OrgMembership
from app.models.trace import RequirementTestCaseLink
from app.schemas.assets import (
    CreateRequirementRequest,
    CreateTestCaseRequest,
    CreateTestStepRequest,
    CreateTestSuiteRequest,
    RequirementSummary,
    TestCaseListResponse,
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

# API Document §1: offset-based pagination, default/max page_size = 25 (NFR-6)
# — same constants every other bespoke route module already uses verbatim.
_DEFAULT_PAGE_SIZE = 25
_MAX_PAGE_SIZE = 25


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Mirrors every existing route module's own `_error()` verbatim."""
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "field_errors": None})


async def _org_membership_exists(db: AsyncSession, org_id: UUID, user_id: UUID) -> bool:
    """Mirrors `releases.py`/`crud_factory.py`'s helper of the same name verbatim."""
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


async def _actor_membership_exists(
    db: AsyncSession, org_id: UUID, actor: User | AIAgent
) -> bool:
    """Any-status OrgMembership existence for the gate, AIAgent-correct.

    `OrgMembership.user_id` FKs `user.actor_id` specifically (Database
    Document §3.1) — an `AIAgent` caller has no `user` row of its own,
    so the existing `_org_membership_exists(org_id, actor.actor_id)`
    shape never finds a row for an agent caller and 404s the request as
    "no membership in this org" per NFR-1. The agent's org relationship
    is transitive, via `acting_on_behalf_of_user_id`'s own `OrgMembership`
    rows (the same pattern `agents.py` established for the agent-route
    404-vs-403 boundary, ADR-0015). For a `User` actor this is the same
    `_org_membership_exists(db, org_id, actor.actor_id)` check the
    existing route has always done.
    """
    target_user_id = actor.acting_on_behalf_of_user_id if isinstance(actor, AIAgent) else actor.actor_id
    return await _org_membership_exists(db, org_id, target_user_id)


def _test_case_summary(test_case: TestCase) -> TestCaseSummary:
    return TestCaseSummary(
        id=test_case.id,
        test_condition_id=test_case.test_condition_id,
        test_level_id=test_case.test_level_id,
        test_type_id=test_case.test_type_id,
        created_by_actor_id=test_case.created_by_actor_id,
        title=test_case.title,
        preconditions=test_case.preconditions,
        expected_result=test_case.expected_result,
        status=test_case.status,
    )

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
    # ADR-0053
    label="Requirements",
    field_meta={"project_id": FieldMeta(ref_entity="project", label_field="name", label="Project")},
)

# No `create` — see module docstring (REQ-3/ADR-0028); same posture as
# `_TEST_CASE_CONFIG` below, for the identical reason.
_TEST_CONDITION_CONFIG = CrudEntityConfig(
    model=TestCondition,
    resource="test_condition",
    create_schema=None,
    update_schema=UpdateTestConditionRequest,
    summary_schema=TestConditionSummary,
    scope_field="requirement_id",
    resolve_org_id=chain_resolver([(Requirement, "requirement_id")]),
    methods=frozenset({"list", "get", "update", "delete"}),
    # ADR-0053. `requirement_id` derives as readOnly (and not required)
    # because REQ-3/ADR-0028 removed this entity's generic create — the
    # bespoke `POST /requirements/{id}/test-conditions` owns it, so there is
    # no create form for it to be required on. `entityConfigs/test-condition.ts`
    # still claimed `required: true`, stale since that removal: exactly the
    # drift this ADR closes, so the derived shape is the correct one.
    label="Test conditions",
    scope_selector=ScopeSelectorOption(ref_entity="requirement", param_name="requirement_id"),
    field_order=("requirement_id", "description", "priority"),
    field_meta={
        "requirement_id": FieldMeta(ref_entity="requirement", label_field="description", label="Requirement"),
    },
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
    # ADR-0053. `methods` above is already this entity's whole REST surface for
    # the admin CRUD screens, so no `full_methods` override: the two bespoke
    # `TestCase` routes (`POST`/`GET /requirements/{id}/test-cases`, REQ-2/
    # ADR-0028) hang off `Requirement`'s own path, not `/test-cases`, so
    # `EntityListPage`/`EntityFormPage` genuinely cannot call them for this
    # entity — `entityConfigs/test-case.ts` said the same thing.
    #
    # `field_order` is needed because `create_schema=None` leaves
    # `UpdateTestCaseRequest`'s own declaration order as the only derived
    # order, and that lists the three FKs *last* — `entityConfigs/test-case.ts`
    # led with them. `required`/`readOnly` legitimately diverge from the old
    # `.ts` for the same reason `_TEST_CONDITION_CONFIG` above documents: no
    # generic create route exists, so "required on create" describes a form
    # that cannot exist.
    label="Test cases",
    field_order=(
        "test_condition_id",
        "test_level_id",
        "test_type_id",
        "title",
        "preconditions",
        "expected_result",
        "status",
    ),
    field_meta={
        "test_condition_id": FieldMeta(
            ref_entity="test-condition", label_field="description", label="Test condition"
        ),
        "test_level_id": FieldMeta(ref_entity="test-level", label_field="name", label="Test level"),
        "test_type_id": FieldMeta(ref_entity="test-type", label_field="name", label="Test type"),
        "preconditions": FieldMeta(show_in_table=False),
        "expected_result": FieldMeta(show_in_table=False),
        # Summary-only (so already `readOnly`), and never on any form/table the
        # old `.ts` declared — hidden rather than surfaced as a raw actor UUID.
        "created_by_actor_id": FieldMeta(show_in_table=False),
    },
)

_TEST_STEP_CONFIG = CrudEntityConfig(
    model=TestStep,
    resource="test_step",
    create_schema=CreateTestStepRequest,
    update_schema=UpdateTestStepRequest,
    summary_schema=TestStepSummary,
    scope_field="test_case_id",
    resolve_org_id=resolve_via_test_case,
    # ADR-0053. `scope_field` is `test_case_id`, not `project_id` — the list
    # can't fetch until an admin picks which `TestCase` to scope by, hence the
    # selector. `sequence` is an `int` column that derives as `type: "string"`
    # (the field-type enum has no numeric type) — the same approximation
    # `entityConfigs/test-step.ts` carried, so no override needed.
    label="Test steps",
    scope_selector=ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id"),
    field_meta={
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case"),
    },
)

_TEST_SUITE_CONFIG = CrudEntityConfig(
    model=TestSuite,
    resource="test_suite",
    create_schema=CreateTestSuiteRequest,
    update_schema=UpdateTestSuiteRequest,
    summary_schema=TestSuiteSummary,
    scope_field="project_id",
    resolve_org_id=chain_resolver([]),
    # ADR-0053. Direct project scope, so no `scope_selector` (`:projectId` is
    # already in the route) and no `field_order` (`project_id` is on
    # `CreateTestSuiteRequest`, so it already derives first).
    label="Test suites",
    field_meta={
        "project_id": FieldMeta(ref_entity="project", label_field="name", label="Project"),
    },
)

router.include_router(make_crud_router(_REQUIREMENT_CONFIG))
router.include_router(make_crud_router(_TEST_CONDITION_CONFIG))
router.include_router(make_crud_router(_TEST_CASE_CONFIG))
router.include_router(make_crud_router(_TEST_STEP_CONFIG))
router.include_router(make_crud_router(_TEST_SUITE_CONFIG))


# --- REQ-2: bespoke atomic create + direct link, and its matching list ---------------------------


@router.post("/requirements/{id}/test-cases", response_model=TestCaseSummary, status_code=201)
async def create_test_case_for_requirement(
    id: UUID,
    payload: CreateTestCaseRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestCaseSummary | JSONResponse:
    """Create a `TestCase` under Requirement `id` and link it directly via
    `RequirementTestCaseLink` — REQ-2's lightweight path, ADR-0006.

    `test_condition_id` is never set here (stays `null` on the row) — the
    row-resolved factory's bespoke resolver (`resolve_test_case_org_id`)
    already falls back to this same `RequirementTestCaseLink` for later
    `GET`/`PATCH`/`DELETE /test-cases/{id}`, so a direct-link `TestCase`
    isn't an "orphaned" row once created.

    Same row-resolved-parent posture as `releases.py`'s `create_release`:
    fetch `Requirement`, resolve its `Project.org_id`, any-status
    `OrgMembership` gate -> `404` if either the Requirement doesn't exist or
    the caller has no membership in its org (NFR-1); `test_case.create` gate
    -> `403`. `created_by_actor_id` is stamped from the caller, never
    accepted from the body. `TestCase` + `RequirementTestCaseLink` are
    created in one flush/commit — a partial write (TestCase with no link)
    never happens.
    """
    requirement = await db.get(Requirement, id)
    if requirement is None:
        return _error(404, "not_found", "Requirement not found.")

    project = await db.get(Project, requirement.project_id)
    if project is None or not await _actor_membership_exists(db, project.org_id, actor):
        return _error(404, "not_found", "Requirement not found.")

    if not await has_permission(str(actor.actor_id), str(project.org_id), "test_case.create"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    test_case = TestCase(
        title=payload.title,
        preconditions=payload.preconditions,
        expected_result=payload.expected_result,
        status=payload.status,
        test_level_id=payload.test_level_id,
        test_type_id=payload.test_type_id,
        created_by_actor_id=actor.actor_id,
    )
    db.add(test_case)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    db.add(RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=test_case.id))
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    await db.commit()
    await db.refresh(test_case)
    return _test_case_summary(test_case)


@router.get("/requirements/{id}/test-cases", response_model=TestCaseListResponse)
async def list_test_cases_for_requirement(
    id: UUID,
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestCaseListResponse | JSONResponse:
    """List TestCases directly linked to Requirement `id` via
    `RequirementTestCaseLink` (REQ-2). Paginated, same posture as every other
    list route in this cluster. Gated on `test_case.read`, same 404-vs-403
    boundary as `create_test_case_for_requirement`.

    Only the direct-link path is listed here — a Requirement's
    TestCondition-mediated TestCases (REQ-3) aren't included; that's
    `GET /requirements/{id}/traceability`'s job (FR-TRACE-1), not this route's.
    """
    requirement = await db.get(Requirement, id)
    if requirement is None:
        return _error(404, "not_found", "Requirement not found.")

    project = await db.get(Project, requirement.project_id)
    if project is None or not await _actor_membership_exists(db, project.org_id, actor):
        return _error(404, "not_found", "Requirement not found.")

    if not await has_permission(str(actor.actor_id), str(project.org_id), "test_case.read"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    page = max(page, 1)
    page_size = min(max(page_size, 1), _MAX_PAGE_SIZE)

    query = (
        select(TestCase)
        .join(RequirementTestCaseLink, RequirementTestCaseLink.test_case_id == TestCase.id)
        .where(RequirementTestCaseLink.requirement_id == id)
    )
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    test_cases = result.scalars().all()

    return TestCaseListResponse(
        items=[_test_case_summary(test_case) for test_case in test_cases],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


__all__ = ["router"]
