"""RBAC permission-check dependencies and actor resolution.

STUB MODULE for `require_permission`/`has_permission`/`require_human_actor` —
signatures + docstrings only, per ADR-0004 (dependency-injected permission
checks over a shared Actor); implementation of those three is deferred to a
later task, not touched here.

`get_current_actor` (AUTH-2, Task 1) IS implemented: it resolves the bearer
JWT access token to the calling `User` row. AIAgent API-key bearer auth
(ADR-0003's other actor flow) is AUTH-4, out of scope — this only ever
resolves a `User`, never an `AIAgent`, until that story adds the key-based
branch.
"""

import uuid
from collections.abc import Callable
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models.actor import User

# `auto_error=False` so a missing/malformed `Authorization` header reaches
# `get_current_actor` as `credentials=None` rather than FastAPI's own
# generic 403 — every rejection path here funnels through the same 401 body
# (API Document §1 error shape), matching `auth.py`'s `_error()` convention.
_bearer_scheme = HTTPBearer(auto_error=False)

# Single generic error code for every `get_current_actor` rejection reason
# (missing header, malformed/expired/tampered JWT, well-formed JWT whose
# `sub` resolves to no `User`) — deliberately not distinguished, same
# no-enumeration-leak posture ADR-0011/AUTH-1's login route takes for
# invalid_credentials. `GET /auth/me` (Task 2, not this task) reuses this
# shape as-is since it depends on `get_current_actor` directly.
_INVALID_TOKEN_ERROR = {
    "code": "invalid_token",
    "message": "Invalid or expired access token.",
    "field_errors": None,
}


def _unauthorized() -> HTTPException:
    """Build the 401 raised for every `get_current_actor` rejection reason.

    A `fastapi.HTTPException`, not a `JSONResponse` like `auth.py`'s
    `_error()` — `get_current_actor` is a dependency, not a route handler,
    and this scaffold has no global exception handler to unwrap a
    `JSONResponse` returned from a dependency. FastAPI's default
    `HTTPException` handler serializes `detail` verbatim as the response
    body (no extra `{"detail": ...}` wrapping for a dict `detail`), so this
    still matches the API Document §1 `{"code", "message", "field_errors"}`
    shape on the wire.
    """
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID_TOKEN_ERROR)


async def get_current_actor(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the bearer JWT access token to the calling `User`.

    401s (all via the shared `_unauthorized()` shape) on:
    - missing/malformed `Authorization` header (no credentials presented),
    - `decode_token` raising `jwt.PyJWTError` (expired, tampered signature,
      malformed, wrong algorithm — caught broadly, not just
      `ExpiredSignatureError`),
    - a syntactically valid `sub` claim that isn't a UUID at all, or
    - a well-formed, validly-signed token whose `sub` doesn't match any
      `User` row (deleted/never-existed actor).
    """
    if credentials is None:
        raise _unauthorized()

    try:
        claims = decode_token(credentials.credentials)
    except jwt.PyJWTError:
        raise _unauthorized() from None

    try:
        actor_id = uuid.UUID(str(claims.get("sub")))
    except (ValueError, TypeError, AttributeError):
        raise _unauthorized() from None

    result = await db.execute(select(User).where(User.actor_id == actor_id))
    user = result.scalars().first()
    if user is None:
        raise _unauthorized()

    return user


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
