"""RBAC-3 UI slice: `GET /orgs/{org_id}/roles` — populates the role-assignment
dropdown (RBAC-3 scope plan addendum, per user direction to add this rather
than a raw `role_id` text input).

Same 404-vs-403 boundary + `require_permission` pattern as every other
org-scoped route (`agents.py`, `projects.py`, `role_assignments.py`). Gated
on `role.read` (already in RBAC-4's seeded catalog — `role` is one of the 23
standard-CRUD resources, Database Document §3.3). Returns exactly the set of
`Role` rows `POST /orgs/{org_id}/role-assignments`'s own `role_id`
validation accepts: system templates (`org_id IS NULL`) plus this org's
custom roles (`org_id == org_id`) — so nothing shown here can ever fail that
route's own validation.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db, require_permission
from app.models.actor import AIAgent, User
from app.models.rbac import Role
from app.models.tenancy import OrgMembership
from app.schemas.rbac import RoleSummary

router = APIRouter()


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Mirrors every other route module's `_error()` verbatim (see
    `role_assignments.py` for why this is duplicated per-module rather than
    shared)."""
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "field_errors": None})


async def _org_membership_exists(db: AsyncSession, org_id: UUID, user_id: UUID) -> bool:
    """Mirrors `role_assignments.py`'s/`projects.py`'s any-status check verbatim."""
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


@router.get("/orgs/{org_id}/roles", response_model=list[RoleSummary])
async def list_roles(
    org_id: UUID,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> list[RoleSummary] | JSONResponse:
    """List every `Role` usable in `org_id` — system templates + this org's custom roles."""
    # 1. 404-vs-403 boundary.
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    # 2. Permission check — invoked directly, same posture as role_assignments.py.
    await require_permission("role.read")(request, actor)

    result = await db.execute(
        select(Role).where(or_(Role.org_id.is_(None), Role.org_id == org_id)).order_by(Role.is_system_role.desc(), Role.name)
    )
    rows = result.scalars().all()

    return [RoleSummary(id=row.id, name=row.name, is_system_role=row.is_system_role) for row in rows]
