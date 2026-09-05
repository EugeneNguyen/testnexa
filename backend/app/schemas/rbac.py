"""Pydantic v2 schemas for the RBAC cluster: RBAC-3's `RoleAssignment` routes
plus ADMIN-2's generic-CRUD factory additions for `Role`/`Permission`.

Source: API Document §2/§3 (`POST`/`GET /orgs/{org_id}/role-assignments`
contracts, generic CRUD routes), ADR-0021 (role assignment creation flow),
ADR-0022 (generic CRUD router factory), Database Document §3.3
(`Role`/`Permission`/`RoleAssignment`). Named `app/schemas/rbac.py`, matching
`app/models/rbac.py`'s own cluster naming — distinct from `app/core/rbac.py`
(the permission-check module) and `app/api/routes/rbac_routes.py`/
`role_assignments.py`/`roles.py` (this cluster's route modules).

**Merge note (ADMIN-2 x RBAC-3, both landed independently and collided on
this file and on `RoleAssignment`/`Role` route ownership):** RBAC-3's bespoke
`POST`/`GET /orgs/{org_id}/role-assignments` is the only way to create or
list a `RoleAssignment` — it already enforces membership/role-scope/
project-org validation the generic factory doesn't replicate. ADMIN-2's
factory-served `RoleAssignment` therefore registers only `get`/`update`/
`delete` (`app/api/routes/rbac_routes.py`), never `create`/`list` — dropped
here are `CreateRoleAssignmentRequest`'s factory variant (`org_id` in body)
and `RoleAssignmentListResponse`; RBAC-3's own `CreateRoleAssignmentRequest`
(`org_id` from the path, not the body) is the one true version. `RoleSummary`
gains an optional `org_id` (`None` for RBAC-3's own `GET /orgs/{org_id}/roles`
construction, populated for the factory's `Role` item/list routes) — additive,
doesn't change RBAC-3's existing 3-arg construction in `roles.py`.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

# --- RoleAssignment (RBAC-3 bespoke create/list; ADMIN-2 factory get/update/delete) ------------


class CreateRoleAssignmentRequest(BaseModel):
    """Body of `POST /orgs/{org_id}/role-assignments`.

    `project_id` omitted (or explicit `null`) -> org-wide grant; supplied ->
    project-scoped grant against that Project. `org_id` itself is not part of
    this body — it's the route's own path parameter, matching every other
    `/orgs/{org_id}/...` create route in this codebase (`agents.py`,
    `projects.py`).
    """

    actor_id: UUID
    role_id: UUID
    project_id: UUID | None = None


class UpdateRoleAssignmentRequest(BaseModel):
    """Body of `PATCH /role-assignments/{id}` (ADMIN-2 factory).

    `actor_id`/`org_id` are not reassignable through this route.
    """

    role_id: UUID | None = None
    project_id: UUID | None = None


class RoleAssignmentSummary(BaseModel):
    """Response shape for `POST`/`GET /orgs/{org_id}/role-assignments` and
    the ADMIN-2 factory's `GET`/`PATCH /role-assignments/{id}`.
    """

    id: UUID
    actor_id: UUID
    org_id: UUID
    project_id: UUID | None = None
    role_id: UUID
    created_at: datetime


# --- Role (RBAC-3 bespoke list; ADMIN-2 factory full CRUD) --------------------------------------


class CreateRoleRequest(BaseModel):
    """Body of `POST /roles` (ADMIN-2 factory).

    `org_id` is always required (ADR-0022 Q3) — a client can never mint a new
    system-role template (`org_id IS NULL`) via this route; omitting it is a
    plain `422` (`org_id` is `Role`'s `scope_field`, so the factory's own
    scope-required check already enforces this with no special-cased code).
    """

    org_id: UUID
    name: str


class UpdateRoleRequest(BaseModel):
    """`org_id`/`is_system_role` are not reassignable through this route."""

    name: str | None = None


class RoleSummary(BaseModel):
    """Response item shape for `GET /orgs/{org_id}/roles` (RBAC-3 UI slice,
    `org_id` unset) and the ADMIN-2 factory's `Role` list/item routes
    (`org_id` populated).
    """

    id: UUID
    org_id: UUID | None = None
    name: str
    is_system_role: bool


class RoleListResponse(BaseModel):
    items: list[RoleSummary]
    total: int
    page: int
    page_size: int


# --- Permission (read-only, ADMIN-2 factory) ----------------------------------------------------


class PermissionSummary(BaseModel):
    id: UUID
    code: str
    resource: str
    action: str


class PermissionListResponse(BaseModel):
    items: list[PermissionSummary]
    total: int
    page: int
    page_size: int


__all__ = [
    "CreateRoleAssignmentRequest",
    "CreateRoleRequest",
    "PermissionListResponse",
    "PermissionSummary",
    "RoleAssignmentSummary",
    "RoleListResponse",
    "RoleSummary",
    "UpdateRoleAssignmentRequest",
    "UpdateRoleRequest",
]
