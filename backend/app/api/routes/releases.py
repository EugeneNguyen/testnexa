"""PROJ-2: `Release` create/read/list + audit-query routes (ADR-0018).

Source: API Document §2/§3 (`POST`/`GET /projects/{project_id}/releases`,
`GET /releases/{id}`, `GET /releases/{id}/test-cycles` contracts), ADR-0018
(release creation flow — project-path-scoped bespoke create/list, row-resolved
single-fetch/audit-query, `test_manager` RBAC bundle extension, triple-
permission audit query gate).

Four routes, two path shapes — the same deliberate split ADR-0017 established
for `Project`, extended one level down the resource tree (ADR-0018):

- `POST`/`GET /projects/{project_id}/releases` carry `project_id` explicitly
  in the path (no `org_id` segment exists at this depth). The `Project` row
  is fetched first and its own `org_id` used for the 404-vs-403 boundary,
  then `has_permission` is called directly (not `require_permission`, which
  reads `org_id`/`project_id` off *path* params — there's no `org_id` path
  segment here for it to find), same posture `projects.py` uses for its own
  row-resolved `GET`/`PATCH /projects/{id}` routes.
- `GET /releases/{id}` and `GET /releases/{id}/test-cycles` have no
  `project_id` path segment at all — the `Release` row is fetched first,
  then its `Project` row, to resolve `org_id` for the 404-vs-403 boundary —
  one hop deeper than `projects.py`'s own row-resolved routes, same pattern
  extended one level (ADR-0018).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.execution import TestExecution
from app.models.planning import TestCycle
from app.models.project import Project, Release
from app.models.tenancy import OrgMembership
from app.schemas.releases import (
    CreateReleaseRequest,
    ReleaseListResponse,
    ReleaseSummary,
    TestCycleSummary,
    TestExecutionSummary,
)

router = APIRouter()

# API Document §1: offset-based pagination, default/max page_size = 25 (NFR-6).
_DEFAULT_PAGE_SIZE = 25
_MAX_PAGE_SIZE = 25

# Sortable columns for `GET /projects/{project_id}/releases` — only
# `target_date` is named by ADR-0018/AC3; any other/unrecognized `sort`
# value falls back to this same default rather than erroring, so a typo'd
# query param degrades gracefully instead of 4xx-ing a read-only list route.
_SORT_COLUMNS = {"target_date": Release.target_date}


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `projects.py`'s `_error()` verbatim — same convention, separate
    copy per this codebase's existing precedent (each route module keeps its
    own rather than sharing an import).
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _org_membership_exists(db: AsyncSession, org_id: UUID, user_id: UUID) -> bool:
    """Any-status `OrgMembership` existence check for the 404-vs-403 boundary.

    Mirrors `projects.py`'s `_org_membership_exists` verbatim.
    """
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


def _release_summary(release: Release) -> ReleaseSummary:
    return ReleaseSummary(
        id=release.id,
        project_id=release.project_id,
        version_label=release.version_label,
        target_date=release.target_date,
    )


@router.post("/projects/{project_id}/releases", response_model=ReleaseSummary, status_code=201)
async def create_release(
    project_id: UUID,
    payload: CreateReleaseRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> ReleaseSummary | JSONResponse:
    """Create a Release under `project_id` (ADR-0018).

    Order of operations (same reasoning as `projects.py`'s row-resolved
    routes, one level deeper since there's no `org_id` path segment at
    either this depth):
    1. Fetch the `Project` row for `project_id`. Missing project OR caller
       has no `OrgMembership` (any status) in the project's own `org_id` ->
       `404` (NFR-1 existence-hiding posture — indistinguishable from a
       nonexistent project).
    2. `has_permission(actor_id, org_id, "release.create")`, called directly
       (there's no path `org_id` for `require_permission`'s dependency to
       read) -> `403` if false.
    3. Create the `Release`; flush alone (same flush-then-catch-IntegrityError
       posture as `projects.py`'s `create_project`) even though no
       `UniqueConstraint` exists on `(project_id, version_label)` today
       (ADR-0018/plan: duplicate `version_label`s within a Project are
       intentionally allowed) — this only guards against an unexpected FK
       violation, not a business-rule collision.
    """
    project = await db.get(Project, project_id)
    if project is None or not await _org_membership_exists(db, project.org_id, actor.actor_id):
        return _error(404, "not_found", "Project not found.")

    if not await has_permission(str(actor.actor_id), str(project.org_id), "release.create"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    release = Release(
        project_id=project.id,
        version_label=payload.version_label,
        target_date=payload.target_date,
    )
    db.add(release)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    await db.commit()
    await db.refresh(release)

    return _release_summary(release)


@router.get("/projects/{project_id}/releases", response_model=ReleaseListResponse)
async def list_releases(
    project_id: UUID,
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    sort: str = "target_date",
    order: str = "asc",
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> ReleaseListResponse | JSONResponse:
    """List Releases under `project_id`, paginated and sorted (ADR-0018).

    Same 404-vs-403 boundary as `create_release`, gated `release.read`.
    Sorted by `target_date` (the only sortable column ADR-0018/AC3 names) —
    `NULLS LAST` is pinned explicitly via `.nulls_last()` for BOTH `asc` and
    `desc`, not left to Postgres's implicit per-direction default (`NULLS
    LAST` for `ASC`, `NULLS FIRST` for `DESC`), so a release with no
    `target_date` always sorts to the end regardless of direction (NFR-24).
    """
    project = await db.get(Project, project_id)
    if project is None or not await _org_membership_exists(db, project.org_id, actor.actor_id):
        return _error(404, "not_found", "Project not found.")

    if not await has_permission(str(actor.actor_id), str(project.org_id), "release.read"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    page = max(page, 1)
    page_size = min(max(page_size, 1), _MAX_PAGE_SIZE)

    sort_column = _SORT_COLUMNS.get(sort, Release.target_date)
    order_column = sort_column.desc().nulls_last() if order == "desc" else sort_column.asc().nulls_last()

    total = await db.scalar(
        select(func.count()).select_from(Release).where(Release.project_id == project_id)
    )

    result = await db.execute(
        select(Release)
        .where(Release.project_id == project_id)
        .order_by(order_column)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    releases = result.scalars().all()

    return ReleaseListResponse(
        items=[_release_summary(release) for release in releases],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/releases/{id}", response_model=ReleaseSummary)
async def get_release(
    id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> ReleaseSummary | JSONResponse:
    """Fetch a single Release by id (ADR-0018).

    No `project_id`/`org_id` path segment — the row is fetched first, then
    its `Project`, to resolve `org_id` for the 404-vs-403 boundary: missing
    `Release` OR missing `Project` OR caller has no `OrgMembership` (any
    status) in the resolved `org_id` -> `404` (indistinguishable, same NFR-1
    posture as every other cross-tenant boundary in this codebase).
    Membership present but caller lacks `release.read` -> `403`, via
    `has_permission` called directly.
    """
    release = await db.get(Release, id)
    if release is None:
        return _error(404, "not_found", "Release not found.")

    project = await db.get(Project, release.project_id)
    if project is None or not await _org_membership_exists(db, project.org_id, actor.actor_id):
        return _error(404, "not_found", "Release not found.")

    if not await has_permission(str(actor.actor_id), str(project.org_id), "release.read"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    return _release_summary(release)


@router.get("/releases/{id}/test-cycles", response_model=list[TestCycleSummary])
async def get_release_test_cycles(
    id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> list[TestCycleSummary] | JSONResponse:
    """AC2's audit query: every TestCycle targeting this Release, with each
    cycle's TestExecutions nested (ADR-0018).

    Row-resolved same as `get_release`. Gated on all THREE permissions —
    `release.read` AND `test_cycle.read` AND `test_execution.read` — checked
    as three separate `has_permission` calls, `403` if any is missing (never
    a partial/degraded `200`). `release.read` is checked first since it's
    tied to the 404-vs-403 boundary already resolved above; the other two
    follow in any order (ADR-0018's stated departure from the rest of the
    codebase's one-permission-per-bespoke-route posture — the sole place
    `TestExecution` data is exposed without a `test_cycle_id` in the request
    path).

    A Release with zero linked TestCycles returns `200` with an empty list,
    not `404` — the Release exists; absence of cycles isn't absence of the
    Release.
    """
    release = await db.get(Release, id)
    if release is None:
        return _error(404, "not_found", "Release not found.")

    project = await db.get(Project, release.project_id)
    if project is None or not await _org_membership_exists(db, project.org_id, actor.actor_id):
        return _error(404, "not_found", "Release not found.")

    org_id = str(project.org_id)
    actor_id = str(actor.actor_id)

    if not await has_permission(actor_id, org_id, "release.read"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")
    if not await has_permission(actor_id, org_id, "test_cycle.read"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")
    if not await has_permission(actor_id, org_id, "test_execution.read"):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    cycles_result = await db.execute(select(TestCycle).where(TestCycle.release_id == id))
    cycles = cycles_result.scalars().all()

    summaries: list[TestCycleSummary] = []
    for cycle in cycles:
        executions_result = await db.execute(
            select(TestExecution).where(TestExecution.test_cycle_id == cycle.id)
        )
        executions = executions_result.scalars().all()
        summaries.append(
            TestCycleSummary(
                id=cycle.id,
                release_id=cycle.release_id,
                test_plan_id=cycle.test_plan_id,
                environment_id=cycle.environment_id,
                name=cycle.name,
                start_date=cycle.start_date,
                end_date=cycle.end_date,
                executions=[
                    TestExecutionSummary(
                        id=execution.id,
                        test_case_id=execution.test_case_id,
                        result=execution.result.value
                        if hasattr(execution.result, "value")
                        else execution.result,
                        executed_at=execution.executed_at,
                    )
                    for execution in executions
                ],
            )
        )

    return summaries
