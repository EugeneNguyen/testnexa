"""PROJ-1: `Project` create/read/update routes (ADR-0017).

Source: API Document §3 (`POST /orgs/{org_id}/projects`, `GET`/`PATCH
/projects/{id}` contracts), ADR-0017 (project creation flow — bespoke
org-path-scoped create, row-resolved read/update, `standards_profile`
inheritance, unconditional creator `test_manager` project-scoped role).

Three routes, two path shapes (ADR-0017's deliberate split, documented there
so it doesn't read as an accidental inconsistency):

- `POST /orgs/{org_id}/projects` mirrors `agents.py`/`organizations.py`
  exactly: `org_id` explicit in the path, any-status-`OrgMembership`
  404-vs-403 boundary checked first, `require_permission` invoked directly
  from the route body (not a `Depends` parameter) so the 404 can fire ahead
  of a would-be 403 — same reasoning as `agents.py`'s module docstring.
- `GET`/`PATCH /projects/{id}` have no `org_id` path segment at all — the
  `Project` row is fetched first and its own `org_id` used for the
  404-vs-403 boundary, anticipating the eventual generic-CRUD-factory
  item-route shape (ADR-0017). Since there's no path `org_id` for
  `require_permission`'s `request.path_params` read to find, these two
  routes call `has_permission` directly instead of `require_permission`.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db, require_permission
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership
from app.schemas.projects import CreateProjectRequest, ProjectSummary, UpdateProjectRequest

router = APIRouter()


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `organizations.py`'s/`agents.py`'s `_error()` verbatim — same
    convention, separate copy per this codebase's existing precedent (each
    route module keeps its own rather than sharing an import).
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _org_membership_exists(db: AsyncSession, org_id: UUID, user_id: UUID) -> bool:
    """Any-status `OrgMembership` existence check for the 404-vs-403 boundary.

    Mirrors `agents.py`'s `_org_membership_exists` verbatim (see that
    module's docstring for why any-status, not active-only, is correct here).
    """
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


async def _actor_has_org_standing(db: AsyncSession, org_id: UUID, actor: User | AIAgent) -> bool:
    """Actor-type-aware 404-vs-403 boundary check for `get_project`/`update_project`.

    `User` actors: unchanged any-status `OrgMembership` check
    (`_org_membership_exists`). `AIAgent` actors never have an
    `OrgMembership` row at all (ADR-0021/`agents.py`/`role_assignments.py`
    precedent — an agent's org relationship is never represented that way),
    so `_org_membership_exists` would always return `False` for one and
    these two routes would 404 every AIAgent caller regardless of any
    `RoleAssignment` they hold (TC-RBAC-011 gap). Substituting "does this
    agent hold ANY RoleAssignment row in this org" (org-wide or
    project-scoped) is the AIAgent-shaped equivalent of "has standing in
    this org" that `OrgMembership` represents for a `User`.
    """
    if isinstance(actor, AIAgent):
        result = await db.scalar(
            select(RoleAssignment.id)
            .where(RoleAssignment.org_id == org_id, RoleAssignment.actor_id == actor.actor_id)
            .limit(1)
        )
        return result is not None
    return await _org_membership_exists(db, org_id, actor.actor_id)


@router.post("/orgs/{org_id}/projects", response_model=ProjectSummary, status_code=201)
async def create_project(
    org_id: UUID,
    payload: CreateProjectRequest,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> ProjectSummary | JSONResponse:
    """Create a Project in `org_id` (ADR-0017).

    Order of operations (same reasoning as `agents.py`'s `create_agent`):
    1. 404-vs-403: any-status `OrgMembership` existence check on `org_id` —
       a non-member (including a nonexistent `org_id`) never learns whether
       `project.create` would otherwise have been granted (NFR-1).
    2. `require_permission("project.create")`, invoked directly (not a
       route-level `Depends`) so it runs strictly after step 1.
    3. Resolve `standards_profile`: if the request payload omitted the field
       (`"standards_profile" not in payload.model_fields_set`), inherit
       `Organization.default_standards_profile` (itself possibly `None`) as
       a one-time copy; if the payload supplied a value — including an
       explicit `null` — use exactly that, never the inherited default.
    4. Create the `Project`; flush alone so an `(org_id, name)` collision is
       caught independently (`422`, same shape/posture as `organizations.py`'s
       slug-collision handling — never a raised exception).
    5. Unconditionally give the creator a project-scoped `RoleAssignment`
       against the seeded `test_manager` system `Role` (`org_id IS NULL`),
       not derived from the creator's own org-level role (ADR-0017 Q2 — the
       one reachable case today is `org_admin` creating; not speculative
       role-mapping logic for roles that can't reach `project.create` yet).
    """
    # 1. 404-vs-403 boundary.
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    # 2. Permission check — invoked directly, same posture as agents.py.
    await require_permission("project.create")(request, actor)

    # 3. Resolve standards_profile: omitted -> inherit org default; supplied
    # (including explicit null) -> use as given.
    if "standards_profile" in payload.model_fields_set:
        standards_profile = payload.standards_profile
    else:
        organization = await db.get(Organization, org_id)
        standards_profile = organization.default_standards_profile if organization is not None else None

    # 4. Create the Project; flush alone to isolate a name collision.
    project = Project(org_id=org_id, name=payload.name, standards_profile=standards_profile)
    db.add(project)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"name": ["A project with this name already exists in this organization."]},
        )

    # 5. Creator's project-scoped test_manager RoleAssignment, unconditional.
    test_manager_role = await db.scalar(
        select(Role).where(Role.name == "test_manager", Role.org_id.is_(None))
    )
    db.add(
        RoleAssignment(
            actor_id=actor.actor_id,
            org_id=org_id,
            project_id=project.id,
            role_id=test_manager_role.id,
        )
    )
    await db.commit()
    await db.refresh(project)

    return ProjectSummary(
        id=project.id,
        org_id=project.org_id,
        name=project.name,
        standards_profile=project.standards_profile,
    )


@router.get("/projects/{id}", response_model=ProjectSummary)
async def get_project(
    id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> ProjectSummary | JSONResponse:
    """Fetch a single Project by id (ADR-0017).

    No `org_id` path segment — the row is fetched first and its own
    `org_id` used for the 404-vs-403 boundary: missing row OR caller has no
    `OrgMembership` (any status) in the row's own `org_id` -> `404`
    (indistinguishable, same NFR-1 existence-hiding posture as every other
    cross-tenant boundary in this codebase). Membership present but caller
    lacks `project.read` -> `403`, via `has_permission` called directly
    (there's no path `org_id` for `require_permission`'s dependency to read).
    """
    project = await db.get(Project, id)
    if project is None or not await _actor_has_org_standing(db, project.org_id, actor):
        return _error(404, "not_found", "Project not found.")

    if not await has_permission(
        str(actor.actor_id), str(project.org_id), "project.read", project_id=str(project.id)
    ):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    return ProjectSummary(
        id=project.id,
        org_id=project.org_id,
        name=project.name,
        standards_profile=project.standards_profile,
    )


@router.patch("/projects/{id}", response_model=ProjectSummary)
async def update_project(
    id: UUID,
    payload: UpdateProjectRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> ProjectSummary | JSONResponse:
    """Partially update a Project (ADR-0017).

    Same fetch-then-404-vs-403 boundary as `get_project`, gated on
    `project.update`. Only fields present in the request body
    (`exclude_unset`) are applied: an explicit `null` for `standards_profile`
    clears it, an omitted field leaves the current value untouched. A rename
    colliding with another Project's `name` in the same org -> `422`, same
    shape/posture as `create_project`'s own collision handling.
    """
    project = await db.get(Project, id)
    if project is None or not await _actor_has_org_standing(db, project.org_id, actor):
        return _error(404, "not_found", "Project not found.")

    if not await has_permission(
        str(actor.actor_id), str(project.org_id), "project.update", project_id=str(project.id)
    ):
        return _error(403, "permission_denied", "You do not have permission to perform this action.")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(project, field, value)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"name": ["A project with this name already exists in this organization."]},
        )

    await db.commit()
    await db.refresh(project)

    return ProjectSummary(
        id=project.id,
        org_id=project.org_id,
        name=project.name,
        standards_profile=project.standards_profile,
    )
