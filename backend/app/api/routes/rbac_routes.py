"""ADMIN-2: generic-CRUD factory routes for the RBAC cluster (ADR-0022).

Named `rbac_routes.py`, not `rbac.py`, to avoid colliding with
`app/core/rbac.py` (the permission-check module), per the plan.

`Role` gets all 5 methods; `Permission` is read-only (`list`/`get` only —
the seeded catalog, no create/update/delete permission codes exist for it
at all, `app/db/rbac_seed_catalog.py`'s `READ_ONLY_RESOURCES`).

**`RoleAssignment` registers only `get`/`update`/`delete`, deliberately no
`create`/`list` — merge-time decision, RBAC-3 x ADMIN-2 (both stories landed
independently and would otherwise offer two ways to create the same row
type).** RBAC-3's bespoke `POST`/`GET /orgs/{org_id}/role-assignments`
(`app/api/routes/role_assignments.py`, [ADR-0021](../../../docs/adr/0021-role-assignment-creation-flow.md))
already enforces membership/role-scope/project-org validation this factory's
generic `create` doesn't replicate (see that module's own docstring) — a
second, less-validated `POST /role-assignments` would be a real correctness
gap, not just redundant. Same posture this codebase already takes for
`Project`/`Organization`: the factory fills in only the methods a bespoke
route doesn't already cover.

`Role.org_id` is nullable (system-role templates, ADR-0022 Q3):
`resolve_org_id` returns the row's own `org_id` directly
(`chain_resolver([])`); `global_read_fallback=True` makes `GET` on a
`org_id IS NULL` row fall back to `has_permission_in_any_org` (readable, the
seeded system-role catalog needs to stay visible for role-assignment UI),
while `PATCH`/`DELETE` still `404` (`is_global_catalog=False` keeps those two
verbs out of the any-org fallback entirely — see
`app/api/crud_factory.py`'s `_fetch_and_gate`). `POST /roles` always requires
a non-null `org_id` in the body — enforced by `Role`'s own `scope_field`
(`"org_id"`) already being a required-scope check, no special-cased code
(`app/schemas/rbac.py`'s `CreateRoleRequest` docstring).
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import (
    CrudEntityConfig,
    FieldMeta,
    NoSchema,
    _actor_membership_exists,
    chain_resolver,
    make_crud_router,
)
from app.api.deps import get_current_actor, get_db
from app.models.actor import AIAgent, User
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.tenancy import OrgMembership
from app.schemas.rbac import (
    CreateRoleRequest,
    MyPermissionCode,
    MyPermissionsResponse,
    PermissionSummary,
    RoleAssignmentSummary,
    RoleSummary,
    UpdateRoleAssignmentRequest,
    UpdateRoleRequest,
)

router = APIRouter()


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Mirrors every other route module's `_error()` verbatim (see `roles.py`)."""
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "field_errors": None})


@router.get("/orgs/{org_id}/permissions/mine", response_model=MyPermissionsResponse)
async def get_my_permissions(
    org_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> MyPermissionsResponse | JSONResponse:
    """ADR-0025: the calling actor's own resolved permission codes in `org_id`.

    Same any-status-`OrgMembership` 404-vs-403 boundary as every other
    org-scoped route (`roles.py`'s `list_roles`) — no membership in `org_id`
    at all -> `404`. Unlike every other org-scoped route, **no specific
    permission is required beyond membership itself**: this route only ever
    reports the caller's own grants, so an actor with zero grants still gets
    `200` with an empty `codes` list, never a `403` (there is nothing further
    to gate — see ADR-0025's own Decision section).

    One query, `RoleAssignment` -> `Role` -> `RolePermission` ->
    `Permission.code`, reusing `has_permission`'s own join shape (`app/core/
    rbac.py`) as a bulk `SELECT` rather than N single-code checks. Both
    org-wide (`RoleAssignment.project_id IS NULL`) and project-scoped grants
    are included — `project_id` is carried through on each row so the caller
    can distinguish the two (`MyPermissionCode`'s own docstring).
    """
    if not await _actor_membership_exists(db, org_id, actor):
        return _error(404, "not_found", "Organization not found.")

    result = await db.execute(
        select(Permission.code, RoleAssignment.project_id)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(RoleAssignment, RoleAssignment.role_id == Role.id)
        .where(RoleAssignment.actor_id == actor.actor_id, RoleAssignment.org_id == org_id)
        .distinct()
    )
    rows = result.all()

    return MyPermissionsResponse(
        codes=[MyPermissionCode(code=code, project_id=project_id) for code, project_id in rows]
    )

_ROLE_CONFIG = CrudEntityConfig(
    model=Role,
    resource="role",
    create_schema=CreateRoleRequest,
    update_schema=UpdateRoleRequest,
    summary_schema=RoleSummary,
    scope_field="org_id",
    resolve_org_id=chain_resolver([]),
    global_read_fallback=True,
    # ADR-0070. `name` is the only free-text column (`is_system_role` is bool).
    search_fields=("name",),
    # ADR-0053. `org_id` is a real FK the admin surface autocompletes against
    # (`Organization.name`) even though this entity's scope value normally
    # comes straight from the `:orgId` route param; `is_system_role` is
    # summary-only (absent from both write schemas) so it derives `readOnly`
    # on its own — only its hand-picked label needs declaring.
    label="Roles",
    field_meta={
        "org_id": FieldMeta(ref_entity="organization", label_field="name", label="Organization", select=True),
        "is_system_role": FieldMeta(label="System role"),
    },
)

_PERMISSION_CONFIG = CrudEntityConfig(
    model=Permission,
    resource="permission",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=PermissionSummary,
    scope_field=None,
    resolve_org_id=chain_resolver([]),  # never called — is_global_catalog handles get/list gating
    is_global_catalog=True,
    methods=frozenset({"list", "get"}),
    # ADR-0070. All three columns are free-text (`code` is the dotted
    # `resource.action` string, not an enum) and all three are what an admin
    # scanning the permission catalog actually searches by.
    search_fields=("code", "resource", "action"),
    # ADR-0053
    label="Permissions",
)

_ROLE_ASSIGNMENT_CONFIG = CrudEntityConfig(
    model=RoleAssignment,
    resource="role_assignment",
    create_schema=None,
    update_schema=UpdateRoleAssignmentRequest,
    summary_schema=RoleAssignmentSummary,
    scope_field="org_id",
    resolve_org_id=chain_resolver([]),
    methods=frozenset({"list", "get", "update", "delete"}),
    # ADR-0053, revised: `list` now generic. The original reasoning here
    # (bespoke `GET /orgs/{org_id}/role-assignments` returns a bare array,
    # can't back the generic admin surface) is stale — DS-2/ADR-0041 changed
    # that bespoke route to the standard `{items,total,page,page_size}`
    # envelope. Even so, this does NOT reuse the bespoke route via
    # `full_methods` (the `_PROJECT_FACTORY_CONFIG` pattern) — that route is
    # path-nested (`/orgs/{org_id}/...`), not the flat `?org_id=`-scoped
    # shape the generic factory itself expects, so the two aren't
    # URL-interchangeable the way Project's bespoke routes are. Instead
    # `list` is added to `methods` directly: the factory registers its own,
    # separate flat `GET /role-assignments?org_id=...` route (gated on the
    # same `role_assignment.read` permission the bespoke route already
    # uses — no RBAC bundle change needed). `RoleAssignmentsPanel.tsx` is
    # untouched, still calls the bespoke nested route; this only adds a
    # second, generic-admin-compatible path alongside it.
    #
    # `actor_id`/`org_id` stay plain read-only strings (the raw id), NOT
    # `fk` — `User`/`AIAgent` are structurally excluded from this surface
    # (ADR-0025), so there's no ref entity to autocomplete against.
    label="Role assignments",
    field_order=("actor_id", "org_id", "project_id", "role_id", "created_at"),
    field_meta={
        "actor_id": FieldMeta(label="Actor"),
        "org_id": FieldMeta(label="Organization"),
        "project_id": FieldMeta(ref_entity="project", label_field="name", label="Project", select=True),
        "role_id": FieldMeta(ref_entity="role", label_field="name", label="Role", select=True),
    },
)

router.include_router(make_crud_router(_ROLE_CONFIG))
router.include_router(make_crud_router(_PERMISSION_CONFIG))
router.include_router(make_crud_router(_ROLE_ASSIGNMENT_CONFIG))

__all__ = ["router"]
