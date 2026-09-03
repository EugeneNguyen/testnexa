"""RBAC permission-check dependencies and actor resolution.

AUTH-2 (Task 1) implemented `get_current_actor` for the human-JWT path only.
AUTH-4 (ADR-0014) extends it with a second bearer scheme — an `AIAgent`
API-key branch — and implements `has_permission`/`require_permission`: the
generic `RoleAssignment` -> `Role` -> `RolePermission` -> `Permission`
resolution plumbing any org-scoped route needs, seeded via test fixtures
directly (RBAC-1..5's own business flows — org bootstrap, invites, seeded
system roles — are still unbuilt and out of scope here; see ADR-0014).

`require_human_actor` stays untouched/stubbed — RBAC-5's job, unrelated to
this story. AUTH-4's own human-only gate on the agent-issuance/revocation
routes (`app/api/routes/agents.py`) is a separate, hardcoded inline check,
matching the same "not just relying on RoleAssignment contents" posture
`require_human_actor`'s docstring describes for Approval.
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token, verify_api_key
from app.db.session import AsyncSessionLocal, get_db
from app.models.actor import AIAgent, User
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission

# `auto_error=False` so a missing/malformed `Authorization` header reaches
# `get_current_actor` as `credentials=None` rather than FastAPI's own
# generic 403 — every rejection path here funnels through the same 401 body
# (API Document §1 error shape), matching `auth.py`'s `_error()` convention.
_bearer_scheme = HTTPBearer(auto_error=False)

# Single generic error code for every `get_current_actor` rejection reason
# (missing header, malformed/expired JWT, well-formed JWT whose `sub`
# resolves to no `User`, unrecognized/revoked/wrong AIAgent key) —
# deliberately not distinguished, same no-enumeration-leak posture
# ADR-0011/AUTH-1's login route takes for invalid_credentials, extended to
# the agent-key path by ADR-0014 ("no distinct error code, same
# no-enumeration posture"). `GET /auth/me` reuses this shape as-is since it
# depends on `get_current_actor` directly.
_INVALID_TOKEN_ERROR = {
    "code": "invalid_token",
    "message": "Invalid or expired access token.",
    "field_errors": None,
}

# Fixed literal prefix every AIAgent API key starts with (ADR-0014). Lets
# `get_current_actor` cheaply branch on bearer-token *shape* via a plain
# `startswith` check before attempting anything JWT-specific, instead of
# the more expensive/ambiguous "try to decode as JWT, fall back to key
# lookup on failure" alternative the ADR explicitly rejects.
_AGENT_KEY_LITERAL_PREFIX = "tnx_agent_"

# Exact character length of the `key_prefix` segment embedded in every raw
# agent key (`generate_api_key`, `app/core/security.py`) — 8 URL-safe chars
# from `secrets.token_urlsafe(6)`. Used to slice the presented raw key.
_AGENT_KEY_PREFIX_LENGTH = 8

_PERMISSION_DENIED_ERROR = {
    "code": "permission_denied",
    "message": "You do not have permission to perform this action.",
    "field_errors": None,
}


def _unauthorized() -> HTTPException:
    """Build the 401 raised for every `get_current_actor` rejection reason.

    A `fastapi.HTTPException`, not a `JSONResponse` like `auth.py`'s
    `_error()` — `get_current_actor` is a dependency, not a route handler,
    so it has no response object of its own to return, only something to
    raise. Raising `HTTPException(detail={...})` alone is NOT sufficient to
    get the flat API Document §1 `{"code", "message", "field_errors"}` shape
    on the wire: FastAPI's default handler wraps `detail` one level deeper
    (`{"detail": {...}}`), which is exactly the pitfall `auth.py`'s module
    docstring documents avoiding via `JSONResponse`. The flattening for this
    dependency's 401 (and any other `HTTPException` raised anywhere in the
    app) is instead done by the global `http_exception_handler` registered
    in `app/main.py` — that handler, not this function alone, is what makes
    the shape hold on the wire.
    """
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID_TOKEN_ERROR)


def _forbidden() -> HTTPException:
    """Build the 403 raised by `require_permission` when the check fails.

    Same "raise an `HTTPException`, let `app/main.py`'s global handler
    flatten it" pattern as `_unauthorized()` above — `require_permission`'s
    returned dependency is also not a route handler.
    """
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_PERMISSION_DENIED_ERROR)


async def _resolve_agent_actor(raw_key: str, db: AsyncSession) -> AIAgent:
    """Resolve a `tnx_agent_...` bearer credential to its `AIAgent` row.

    Narrows via `key_prefix` first (extracted from the presented raw key,
    not trusted from anywhere else), then argon2-verifies the full raw key
    against each narrowed candidate's `key_hash` in turn — `key_prefix` is
    NOT assumed unique (ADR-0014 edge case: two independently generated
    8-char prefixes colliding is astronomically unlikely but not
    impossible), so this iterates rather than `.first()`-and-trusts.
    `revoked_at IS NULL` is enforced in the `WHERE` clause itself, not
    checked-after-fetch, so a revoked agent's key is indistinguishable from
    a never-existed one — same posture as the human 401 path's "can't tell
    'no such user' from 'wrong password'".

    On a match, stamps `last_used_at = now()` and commits (ADR-0014: updated
    on every successful agent-bearer authentication, not just at issuance).
    Raises the shared `_unauthorized()` 401 if no candidate's key matches.
    """
    key_prefix = raw_key[len(_AGENT_KEY_LITERAL_PREFIX) :][:_AGENT_KEY_PREFIX_LENGTH]

    result = await db.execute(
        select(AIAgent).where(AIAgent.key_prefix == key_prefix, AIAgent.revoked_at.is_(None))
    )
    candidates = result.scalars().all()

    for candidate in candidates:
        if verify_api_key(raw_key, candidate.key_hash):
            candidate.last_used_at = datetime.now(UTC)
            await db.commit()
            return candidate

    raise _unauthorized()


async def get_current_actor(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | AIAgent:
    """Resolve the bearer credential to the calling `User` or `AIAgent`.

    Branches on credential *shape* before attempting to interpret it
    (ADR-0014): a `tnx_agent_`-prefixed credential is resolved as an AIAgent
    API key (`_resolve_agent_actor`); anything else is attempted as a human
    JWT access token, the AUTH-2 behavior, unchanged.

    401s (all via the shared `_unauthorized()` shape, no distinct codes
    between the two credential kinds — no-enumeration posture) on:
    - missing/malformed `Authorization` header (no credentials presented),
    - a `tnx_agent_...` credential whose prefix matches zero *unrevoked*
      `AIAgent` rows, or matches one/more but none argon2-verifies,
    - `decode_token` raising `jwt.PyJWTError` (expired, tampered signature,
      malformed, wrong algorithm — caught broadly, not just
      `ExpiredSignatureError`),
    - a syntactically valid `sub` claim that isn't a UUID at all, or
    - a well-formed, validly-signed token whose `sub` doesn't match any
      `User` row (deleted/never-existed actor).
    """
    if credentials is None:
        raise _unauthorized()

    token = credentials.credentials

    if token.startswith(_AGENT_KEY_LITERAL_PREFIX):
        return await _resolve_agent_actor(token, db)

    try:
        claims = decode_token(token)
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


async def has_permission(actor_id: str, org_id: str, code: str, project_id: str | None = None) -> bool:
    """Check whether `actor_id` holds permission `code` in `org_id` (optionally project-scoped).

    Resolves via `RoleAssignment` -> `Role` -> `RolePermission` -> `Permission`.

    Opens its own short-lived session via `AsyncSessionLocal` rather than
    taking a `db: AsyncSession` parameter — this function's signature is
    fixed by the stub it replaces (no `db` param), and it's called from
    contexts (like `require_permission`'s dependency) where reusing the
    request's own session would work too, but a standalone session keeps
    this function usable outside a request lifecycle as well (e.g. a future
    batch/background job checking permissions).

    `project_id=None` (the default, and the only path AUTH-4's own routes
    exercise) resolves org-wide grants only: `RoleAssignment.project_id IS
    NULL`. Passing a `project_id` additionally matches project-scoped
    grants (`RoleAssignment.project_id == project_id`) — implemented per
    ADR-0014/RBAC-3's documented design even though no route in this story
    exercises it yet; RBAC-3 owns that coverage when it lands.
    """
    actor_uuid = uuid.UUID(str(actor_id))
    org_uuid = uuid.UUID(str(org_id))

    conditions = [
        RoleAssignment.actor_id == actor_uuid,
        RoleAssignment.org_id == org_uuid,
        Permission.code == code,
    ]
    if project_id is None:
        conditions.append(RoleAssignment.project_id.is_(None))
    else:
        conditions.append(RoleAssignment.project_id == uuid.UUID(str(project_id)))

    query = (
        select(Permission.id)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(RoleAssignment, RoleAssignment.role_id == Role.id)
        .where(*conditions)
        .limit(1)
    )

    async with AsyncSessionLocal() as db:
        result = await db.execute(query)
        return result.first() is not None


def require_permission(code: str) -> Callable[..., Any]:
    """Build a FastAPI dependency that 403s unless the current actor holds `code`.

    `code` follows the `<resource>.<action>` scheme (Database Document
    §rbac.py `Permission.code`). Every protected route — including every
    route produced by the generic CRUD router factory — depends on this.

    Resolves the current actor via `get_current_actor` (401 first, before
    any permission check — an unauthenticated caller never learns whether
    the permission *would* have been granted). `org_id` is read from the
    request's own resolved path parameters (`request.path_params["org_id"]`)
    rather than a dependency-declared function parameter — `require_permission`
    is a bare dependency factory used across different route shapes, all of
    which are `/orgs/{org_id}/...`-rooted (ADR-0014's 404-vs-403 boundary
    applies to exactly this shape of route); reading it off `request` avoids
    every call site having to redeclare `org_id: uuid.UUID` as its own path
    parameter just to satisfy this dependency. `project_id` is read the same
    way, defaulting to `None` (org-wide check) when the route has no
    `{project_id}` path segment — AUTH-4's own routes never do.

    NOTE: the 404-vs-403 boundary itself (no `OrgMembership` at all -> 404,
    membership-but-no-permission -> 403) is NOT enforced here — that check
    happens in the route handler before this dependency runs (see
    `app/api/routes/agents.py`), since only the route knows how to resolve
    "does this org even exist / is the caller a member of it" versus "does
    the caller hold this specific permission". This dependency only ever
    403s; it never 404s.
    """

    async def _check_permission(
        request: Request,
        actor: User | AIAgent = Depends(get_current_actor),
    ) -> User | AIAgent:
        org_id = request.path_params.get("org_id")
        project_id = request.path_params.get("project_id")

        allowed = await has_permission(
            actor_id=str(actor.actor_id),
            org_id=str(org_id),
            code=code,
            project_id=str(project_id) if project_id is not None else None,
        )
        if not allowed:
            raise _forbidden()

        return actor

    return _check_permission


def require_human_actor() -> Callable[..., Any]:
    """Build a FastAPI dependency that 403s unless the current actor is a `User`.

    Used to structurally enforce ADR-0004's human-only Approval rule: a
    hardcoded rejection of any `AIAgent` actor at the Approval-creation
    endpoint, independent of `RoleAssignment`/`RolePermission` contents.
    """
    raise NotImplementedError("feature work")
