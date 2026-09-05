"""Pydantic v2 schemas for the RBAC-3 `RoleAssignment` routes.

Source: API Document §2/§3 (`POST`/`GET /orgs/{org_id}/role-assignments`
contracts), ADR-0021 (role assignment creation flow).
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


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


class RoleAssignmentSummary(BaseModel):
    """Response shape for `POST`/`GET /orgs/{org_id}/role-assignments`."""

    id: UUID
    actor_id: UUID
    org_id: UUID
    project_id: UUID | None = None
    role_id: UUID
    created_at: datetime


class RoleSummary(BaseModel):
    """Response item shape for `GET /orgs/{org_id}/roles` (RBAC-3 UI slice).

    Backs the role-assignment UI's role dropdown — the 5 RBAC-4 system
    templates (`org_id=None` on the row, `is_system_role=True`) plus any
    custom `Role`s scoped to this org (RBAC-4 AC3), matching exactly the set
    `POST /orgs/{org_id}/role-assignments`'s own `role_id` validation
    accepts (`Role.org_id IS NULL OR Role.org_id == org_id`).
    """

    id: UUID
    name: str
    is_system_role: bool


__all__ = ["CreateRoleAssignmentRequest", "RoleAssignmentSummary", "RoleSummary"]
