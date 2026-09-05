"""RBAC-1: `POST /orgs` — an existing authenticated actor mints a further Organization.

Source: API Document §2 (`POST /orgs` contract), ADR-0016 (organization
bootstrap & creation flow — the "case (b)" route, sibling to `POST
/auth/signup`'s "case (a)" in `app/api/routes/auth.py`).

Unlike `app/api/routes/agents.py`'s `/orgs/{org_id}/...` routes, this route
has no target `org_id` in its path — the org doesn't exist until the call
succeeds — so neither `require_permission` (path-`org_id`-scoped) nor the
404-vs-403 boundary (ADR-0015/NFR-19, "hide whether a target org exists")
applies here: there is no target org's existence to hide. The gate is the
bespoke `has_permission_in_any_org` (`app/core/rbac.py`): does the caller
hold `organization.create` org-wide (`project_id IS NULL`) in *any* org they
already belong to. `403 permission_denied` if not — no 404 path at all.

API-1/ADR-0022 adds the generic-CRUD factory's `GET`/`PATCH`/
`DELETE /organizations/{id}` at the bottom of this module — `create` stays
this module's own bespoke `POST /orgs` above (and `POST /auth/signup`'s
bootstrap case), never a bare `POST /organizations` (API Document §3
footnote *).
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import CrudEntityConfig, make_crud_router, resolve_organization_org_id
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission_in_any_org
from app.models.actor import AIAgent, User
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.schemas.organizations import CreateOrgRequest, OrganizationDetail, OrgSummary, UpdateOrganizationRequest

router = APIRouter()


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `auth.py`'s `_error()` verbatim — same convention, separate copy
    per this codebase's existing precedent (`agents.py` does the same rather
    than sharing an import).
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


@router.post("/orgs", response_model=OrgSummary, status_code=201)
async def create_org(
    payload: CreateOrgRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> OrgSummary | JSONResponse:
    """Create a further Organization for an already-authenticated actor (ADR-0016).

    Authenticated via `get_current_actor` — `User` or `AIAgent`, no
    human-only gate (the AC doesn't restrict this to humans, and RBAC-4's
    `ai_agent_scoped` bundle doesn't include `organization.create` anyway,
    so in practice only an actor holding `org_admin`'s full bundle, human or
    agent, ever passes the gate below).

    Order of operations:
    1. Gate: `has_permission_in_any_org(actor.actor_id, "organization.create")`
       -> `403 permission_denied` if the actor holds it in zero orgs (or
       only via a project-scoped-only grant — TC-RBAC-023).
    2. Create the `Organization`; flush alone so a `slug` collision is
       caught independently (`422`, same shape/posture as `POST
       /auth/signup`'s — never `409`, which is reserved for that route's
       bootstrap-closed case).
    3. Give the creator their own `OrgMembership(active)` + an org-wide
       (`project_id=None`) `RoleAssignment` pointing at RBAC-4's seeded
       `org_admin` system `Role` in the org just created (ADR-0016 Q3 — the
       creator always auto-joins, since RBAC-2's invite flow doesn't exist
       yet to add anyone else afterward).

       `OrgMembership.user_id` FKs to `user.actor_id` specifically (Database
       Document §3.1), not the generic `actor.id` — an `AIAgent` caller has
       no row in the `user` table at all, so an `OrgMembership` is only ever
       created when `actor` is a `User`. The `RoleAssignment` (FK'd to the
       generic `actor.id`) is created either way — an `AIAgent` caller that
       clears the gate above still gets org-wide `org_admin` permissions in
       the new org, just not an `OrgMembership` row, mirroring
       `agents.py`'s existing precedent that an `AIAgent`'s org
       relationship is never represented by its own `OrgMembership` (there
       it's resolved transitively via `acting_on_behalf_of_user_id`
       instead).
    """
    # 1. Any-org permission gate.
    if not await has_permission_in_any_org(str(actor.actor_id), "organization.create"):
        return _error(
            403,
            "permission_denied",
            "You do not have permission to perform this action.",
        )

    # 2. Create the Organization; flush alone to isolate a slug collision.
    org = Organization(name=payload.name, slug=payload.slug)
    db.add(org)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"slug": ["This organization slug is already taken."]},
        )

    # 3. Creator's own membership (User-only, see docstring) + org-wide
    # org_admin RoleAssignment (User or AIAgent).
    org_admin_role = await db.scalar(
        select(Role).where(Role.name == "org_admin", Role.org_id.is_(None))
    )
    if isinstance(actor, User):
        db.add(
            OrgMembership(
                org_id=org.id,
                user_id=actor.actor_id,
                status=OrgMembershipStatus.active,
            )
        )
    db.add(
        RoleAssignment(
            actor_id=actor.actor_id,
            org_id=org.id,
            project_id=None,
            role_id=org_admin_role.id,
        )
    )
    await db.commit()
    await db.refresh(org)

    return OrgSummary(id=org.id, name=org.name, slug=org.slug)


# --- API-1 generic-CRUD factory additions (ADR-0022) ------------------------------------------
#
# `Organization`'s own resolver: the row IS the tenant, `id` IS `org_id`
# (`resolve_organization_org_id`) — no `create` (bespoke above/`auth.py`),
# `list` isn't registered either (no FK-based "immediate parent" scope makes
# sense for the tenant root itself; "orgs I belong to" is an identity-based
# filter, not this factory's exact-match-scope shape).
_ORGANIZATION_CONFIG = CrudEntityConfig(
    model=Organization,
    resource="organization",
    create_schema=None,
    update_schema=UpdateOrganizationRequest,
    summary_schema=OrganizationDetail,
    scope_field=None,
    resolve_org_id=resolve_organization_org_id,
    methods=frozenset({"get", "update", "delete"}),
)

router.include_router(make_crud_router(_ORGANIZATION_CONFIG))
