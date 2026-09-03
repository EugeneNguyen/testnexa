"""RBAC permission-check dependencies and actor resolution.

STUB MODULE — function signatures + docstrings only, per ADR-0004
(dependency-injected permission checks over a shared Actor). No RBAC logic
is implemented in this scaffold; implementation is deferred to a later task.
"""

from collections.abc import Callable
from typing import Any


async def get_current_actor(token: str | None = None) -> Any:
    """Resolve the bearer token (JWT or AIAgent API key) to the calling Actor.

    Returns the resolved `User` or `AIAgent` row per the shared Actor
    resolution helper referenced in ADR-0002's consequence note.
    """
    raise NotImplementedError("feature work")


def require_permission(code: str) -> Callable[..., Any]:
    """Build a FastAPI dependency that 403s unless the current actor holds `code`.

    `code` follows the `<resource>.<action>` scheme (Database Document
    §rbac.py `Permission.code`). Every protected route — including every
    route produced by the generic CRUD router factory — depends on this.
    """
    raise NotImplementedError("feature work")


async def has_permission(actor_id: str, org_id: str, code: str, project_id: str | None = None) -> bool:
    """Check whether `actor_id` holds permission `code` in `org_id` (optionally project-scoped).

    Resolves via `RoleAssignment` -> `Role` -> `RolePermission` -> `Permission`,
    honoring org-wide grants (`RoleAssignment.project_id IS NULL`) as well as
    project-scoped grants.
    """
    raise NotImplementedError("feature work")


def require_human_actor() -> Callable[..., Any]:
    """Build a FastAPI dependency that 403s unless the current actor is a `User`.

    Used to structurally enforce ADR-0004's human-only Approval rule: a
    hardcoded rejection of any `AIAgent` actor at the Approval-creation
    endpoint, independent of `RoleAssignment`/`RolePermission` contents.
    """
    raise NotImplementedError("feature work")
