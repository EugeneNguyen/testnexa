"""API-1: generic-CRUD factory routes for the RBAC cluster (ADR-0021).

Named `rbac_routes.py`, not `rbac.py`, to avoid colliding with
`app/core/rbac.py` (the permission-check module), per the plan.

`Role`/`RoleAssignment` get all 5 methods; `Permission` is read-only
(`list`/`get` only — the seeded catalog, no create/update/delete permission
codes exist for it at all, `app/db/rbac_seed_catalog.py`'s
`READ_ONLY_RESOURCES`).

`Role.org_id` is nullable (system-role templates, ADR-0021 Q3):
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

from fastapi import APIRouter

from app.api.crud_factory import CrudEntityConfig, NoSchema, chain_resolver, make_crud_router
from app.models.rbac import Permission, Role, RoleAssignment
from app.schemas.rbac import (
    CreateRoleAssignmentRequest,
    CreateRoleRequest,
    PermissionSummary,
    RoleAssignmentSummary,
    RoleSummary,
    UpdateRoleAssignmentRequest,
    UpdateRoleRequest,
)

router = APIRouter()

_ROLE_CONFIG = CrudEntityConfig(
    model=Role,
    resource="role",
    create_schema=CreateRoleRequest,
    update_schema=UpdateRoleRequest,
    summary_schema=RoleSummary,
    scope_field="org_id",
    resolve_org_id=chain_resolver([]),
    global_read_fallback=True,
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
)

_ROLE_ASSIGNMENT_CONFIG = CrudEntityConfig(
    model=RoleAssignment,
    resource="role_assignment",
    create_schema=CreateRoleAssignmentRequest,
    update_schema=UpdateRoleAssignmentRequest,
    summary_schema=RoleAssignmentSummary,
    scope_field="org_id",
    resolve_org_id=chain_resolver([]),
)

router.include_router(make_crud_router(_ROLE_CONFIG))
router.include_router(make_crud_router(_PERMISSION_CONFIG))
router.include_router(make_crud_router(_ROLE_ASSIGNMENT_CONFIG))

__all__ = ["router"]
