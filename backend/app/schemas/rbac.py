"""Pydantic v2 schemas for the API-1 generic-CRUD factory's RBAC cluster.

Source: API Document §3 (generic CRUD routes, ADR-0021), Database Document
§3.3 (`Role`/`Permission`/`RoleAssignment`). Named `app/schemas/rbac.py`,
matching `app/models/rbac.py`'s own cluster naming — distinct from
`app/core/rbac.py` (the permission-check module) and
`app/api/routes/rbac_routes.py` (this cluster's route module, named to avoid
colliding with `app/core/rbac.py`, per the plan).

`Permission` reuses a plain read-only summary here (no create/update schema
— it's read-only via the factory, seeded catalog, `list`/`get` only).
"""

from uuid import UUID

from pydantic import BaseModel

# --- Role --------------------------------------------------------------------------------------


class CreateRoleRequest(BaseModel):
    """Body of `POST /roles`.

    `org_id` is always required (ADR-0021 Q3) — a client can never mint a new
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
    id: UUID
    org_id: UUID | None = None
    name: str
    is_system_role: bool


class RoleListResponse(BaseModel):
    items: list[RoleSummary]
    total: int
    page: int
    page_size: int


# --- Permission (read-only) -------------------------------------------------------------------


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


# --- RoleAssignment ----------------------------------------------------------------------------


class CreateRoleAssignmentRequest(BaseModel):
    """Body of `POST /role-assignments` — `org_id` is the required scope field."""

    org_id: UUID
    actor_id: UUID
    role_id: UUID
    project_id: UUID | None = None


class UpdateRoleAssignmentRequest(BaseModel):
    """`actor_id`/`org_id` are not reassignable through this route."""

    role_id: UUID | None = None
    project_id: UUID | None = None


class RoleAssignmentSummary(BaseModel):
    id: UUID
    actor_id: UUID
    org_id: UUID
    project_id: UUID | None = None
    role_id: UUID


class RoleAssignmentListResponse(BaseModel):
    items: list[RoleAssignmentSummary]
    total: int
    page: int
    page_size: int


__all__ = [
    "CreateRoleAssignmentRequest",
    "CreateRoleRequest",
    "PermissionListResponse",
    "PermissionSummary",
    "RoleAssignmentListResponse",
    "RoleAssignmentSummary",
    "RoleListResponse",
    "RoleSummary",
    "UpdateRoleAssignmentRequest",
    "UpdateRoleRequest",
]
