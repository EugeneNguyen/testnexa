"""RBAC-3: `POST`/`GET /orgs/{org_id}/role-assignments` (ADR-0021).

Source: API Document §2 (route table)/§3 (`POST`/`GET
/orgs/{org_id}/role-assignments` contracts), ADR-0021 (role assignment
creation flow — membership gate, body-validation posture, project-scoped
enforcement fix), Database Document §3.3 (`RoleAssignment`).

Both routes share the same gate order as `projects.py`'s `create_project`/
`agents.py`'s `create_agent` (not interchangeable — 404 must fire ahead of a
would-be 403, ADR-0015):
1. 404-vs-403: any-status `OrgMembership` existence check on the path
   `org_id` — no membership at all (including a nonexistent `org_id`) ->
   `404`, so a non-member never learns whether the permission they lack
   would otherwise have been granted (NFR-1). `require_permission` is
   deliberately NOT used as a route-level `Depends(...)` parameter for this
   reason — FastAPI resolves `Depends` parameters before the route body
   runs, which would let a `403` fire ahead of this `404` check.
2. `require_permission("role_assignment.create" | "role_assignment.read")`,
   invoked directly from inside the route body, after step 1 has already
   passed.

`POST` then runs body-field validation, all `422` (never `404` — the caller
has already proved membership in `org_id` before any of these run, so a
foreign-org id in the body is ordinary request validation, not an
existence-hiding boundary; ADR-0021's Decision section):
- `role_id` must resolve to a `Role` usable in this org: `Role.org_id IS
  NULL` (a system template, usable everywhere) OR `Role.org_id == org_id`.
- `actor_id` must resolve to an existing `Actor` row (`User` or `AIAgent`).
- If the resolved actor is a `User`, that `User` must already hold an
  `OrgMembership` (any status — invited/active/suspended) in `org_id` — a
  `RoleAssignment` for a non-member `User` is an orphaned row, not a real
  grant (ADR-0021). Skipped entirely for `AIAgent` actors, which never have
  an `OrgMembership` row (same precedent `agents.py`/`organizations.py`
  already establish).
- If `project_id` is given, it must resolve to a `Project` with
  `Project.org_id == org_id`.

Insert; a duplicate `(actor_id, org_id, project_id, role_id)` grant ->
caught `IntegrityError` -> `422`, same shape/posture as `organizations.py`'s
slug-collision handling (never a raised exception).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db, require_permission
from app.models.actor import AIAgent, User
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import OrgMembership
from app.schemas.rbac import CreateRoleAssignmentRequest, RoleAssignmentSummary

router = APIRouter()


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `organizations.py`'s/`agents.py`'s/`projects.py`'s `_error()`
    verbatim — same convention, separate copy per this codebase's existing
    precedent (each route module keeps its own rather than sharing an
    import).
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _org_membership_exists(db: AsyncSession, org_id: UUID, user_id: UUID) -> bool:
    """Any-status `OrgMembership` existence check for the 404-vs-403 boundary.

    Mirrors `agents.py`'s/`projects.py`'s `_org_membership_exists` verbatim
    (see those modules' docstrings for why any-status, not active-only, is
    correct here).
    """
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


def _summary(row: RoleAssignment) -> RoleAssignmentSummary:
    return RoleAssignmentSummary(
        id=row.id,
        actor_id=row.actor_id,
        org_id=row.org_id,
        project_id=row.project_id,
        role_id=row.role_id,
        created_at=row.created_at,
    )


@router.post("/orgs/{org_id}/role-assignments", response_model=RoleAssignmentSummary, status_code=201)
async def create_role_assignment(
    org_id: UUID,
    payload: CreateRoleAssignmentRequest,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> RoleAssignmentSummary | JSONResponse:
    """Grant a Role to an actor, org-wide or project-scoped (ADR-0021).

    See module docstring for the full order of operations and error posture.
    """
    # 1. 404-vs-403 boundary.
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    # 2. Permission check — invoked directly, same posture as agents.py/projects.py.
    await require_permission("role_assignment.create")(request, actor)

    # 3. role_id must resolve to a Role usable in this org: a system
    # template (org_id IS NULL) or one scoped to this exact org_id.
    role = await db.scalar(
        select(Role).where(Role.id == payload.role_id, or_(Role.org_id.is_(None), Role.org_id == org_id))
    )
    if role is None:
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"role_id": ["This role is not available in this organization."]},
        )

    # 4. actor_id must resolve to an existing Actor (User or AIAgent).
    target_user = await db.scalar(select(User).where(User.actor_id == payload.actor_id))
    if target_user is None:
        target_agent = await db.scalar(select(AIAgent).where(AIAgent.actor_id == payload.actor_id))
        if target_agent is None:
            return _error(
                422,
                "validation_error",
                "Request failed validation.",
                field_errors={"actor_id": ["This actor does not exist."]},
            )

    # 5. A User target must already hold an OrgMembership (any status) in
    # org_id — an AIAgent target skips this gate entirely (never has one).
    if target_user is not None and not await _org_membership_exists(db, org_id, target_user.actor_id):
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"actor_id": ["This actor is not a member of this organization."]},
        )

    # 6. project_id, if given, must resolve to a Project in this exact org_id.
    if payload.project_id is not None:
        project = await db.scalar(
            select(Project).where(Project.id == payload.project_id, Project.org_id == org_id)
        )
        if project is None:
            return _error(
                422,
                "validation_error",
                "Request failed validation.",
                field_errors={"project_id": ["This project does not exist in this organization."]},
            )

    # 7. Insert; a duplicate (actor_id, org_id, project_id, role_id) grant
    # -> 422 via the unique constraint, same posture as organizations.py's
    # slug collision.
    row = RoleAssignment(
        actor_id=payload.actor_id,
        org_id=org_id,
        project_id=payload.project_id,
        role_id=payload.role_id,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"actor_id": ["This actor already holds this role in this scope."]},
        )

    await db.commit()
    await db.refresh(row)

    return _summary(row)


@router.get("/orgs/{org_id}/role-assignments", response_model=list[RoleAssignmentSummary])
async def list_role_assignments(
    org_id: UUID,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> list[RoleAssignmentSummary] | JSONResponse:
    """List every `RoleAssignment` (org-wide and project-scoped) in `org_id` (ADR-0021).

    Same 404-vs-403 boundary as `create_role_assignment`, gated on
    `role_assignment.read`. No `project_id` filter query param in this
    story — every row for `org_id` is returned, org-wide and project-scoped
    both.
    """
    # 1. 404-vs-403 boundary.
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    # 2. Permission check — invoked directly, same posture as create above.
    await require_permission("role_assignment.read")(request, actor)

    result = await db.execute(select(RoleAssignment).where(RoleAssignment.org_id == org_id))
    rows = result.scalars().all()

    return [_summary(row) for row in rows]
