"""AUTH-4: AI-agent credential issuance/revocation routes (ADR-0015).

Source: API Document §2 (`POST /orgs/{org_id}/agents`,
`POST /orgs/{org_id}/agents/{agent_id}/revoke` contracts), ADR-0015 (AI agent
credential mechanics & minimal-RBAC-now decision), ADR-0007 (real
multi-tenancy — the 404-vs-403 boundary these routes establish as precedent).

Both routes share the same gate order, deliberately checked in this
sequence (not interchangeable — see ADR-0015 §"404-vs-403 boundary"):
1. Human-only gate (hardcoded, independent of `RoleAssignment` contents —
   an `AIAgent` bearer credential can never issue/revoke agent credentials,
   mirrors RBAC-5's Approval double-enforcement pattern). 403 `actor_forbidden`.
2. Any `OrgMembership` (any status) for the caller in the path's `org_id` —
   none (including a nonexistent `org_id`) -> 404 `not_found`. This is
   checked BEFORE the permission check so a non-member can never learn
   whether the permission they lack would otherwise have been granted
   (NFR-1: cross-tenant existence is never confirmable). Deliberately does
   NOT use `require_permission` as a route-level `Depends(...)` parameter —
   FastAPI resolves `Depends` parameters before the route body runs, which
   would let a 403 fire ahead of this 404 check. Instead `require_permission`
   is invoked directly, as a plain callable, from inside the route body
   after the 404 check has already passed.
3. `require_permission("ai_agent.create" | "ai_agent.update")` — 403
   `permission_denied` (raised as an `HTTPException`; `app/main.py`'s global
   handler flattens it to the flat API Document §1 error shape on the wire,
   same as any other `HTTPException` raised from a dependency).

Never logs the raw API key: `generate_api_key`'s return value is only ever
passed to `hash_api_key` (for persistence) and into the response body
(shown once) — never printed/logged (same discipline as AUTH-1's plaintext
password rule).
"""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import clamp_pagination
from app.api.deps import get_current_actor, get_db, require_permission
from app.api.routes.auth import _active_orgs_for_user
from app.core.security import generate_api_key, hash_api_key
from app.models.actor import AIAgent, User
from app.models.tenancy import OrgMembership, OrgMembershipStatus
from app.schemas.agents import (
    AgentSummary,
    CreateAgentRequest,
    CreateAgentResponse,
    ListAgentsResponse,
    RevokeAgentResponse,
)
from app.schemas.auth import MeOrgsResponse, OrgSummary

router = APIRouter()

# ADR-0063: same default/max as `role_assignments.py`'s own bespoke list
# route (DS-2/ADR-0041) — a plain literal at the call site, no shared
# constant, per that route's own precedent.
_DEFAULT_PAGE_SIZE = 25


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `auth.py`'s `_error()` verbatim — same convention, separate copy
    rather than a shared import to keep each route module's error-shaping
    self-contained (matches this codebase's existing precedent: `auth.py`
    doesn't import a shared `_error` either).
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": None},
    )


async def _org_membership_exists(db: AsyncSession, org_id: UUID, user_id: UUID) -> bool:
    """Any-status `OrgMembership` existence check for the 404-vs-403 boundary.

    Deliberately NOT filtered to `status == active` — ADR-0015 is explicit
    that *any* membership (invited/active/suspended) counts for the
    existence check ("the requester has *any* `OrgMembership` in the path's
    `org_id`"). This is a different, narrower question than "is this
    membership functionally usable" (which login's active-only org
    resolution answers) — here it only decides whether the org boundary
    itself is confirmable to this caller at all (NFR-1).
    """
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


@router.post("/orgs/{org_id}/agents", response_model=CreateAgentResponse, status_code=201)
async def create_agent(
    org_id: UUID,
    payload: CreateAgentRequest,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> CreateAgentResponse | JSONResponse:
    """Issue a new AIAgent bearer API key (ADR-0015).

    Order of operations (see module docstring for why this exact order):
    1. Human-only gate.
    2. 404-vs-403: any-status `OrgMembership` existence check.
    3. `require_permission("ai_agent.create")`.
    4. Validate `acting_on_behalf_of_user_id` resolves to an *active*
       `OrgMembership` of `org_id` — 422 if not. Unlike step 2's any-status
       existence check, this one IS active-only: it's asking "can this real
       human person be meaningfully held accountable for this agent's
       actions in this org right now", not "does the org boundary exist".
    5. Create the `AIAgent` row (joined-table inheritance auto-creates the
       backing `Actor` row on `db.add`/flush — no separate `Actor(...)`
       construction needed, same pattern `User(...)` already uses
       elsewhere in this codebase). Generate the key, persist only its
       hash, return the raw key once.
    """
    # 1. Human-only gate.
    if not isinstance(actor, User):
        return _error(403, "actor_forbidden", "This action is restricted to human users.")

    # 2. 404-vs-403 boundary.
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    # 3. Permission check — invoked directly (not via route-level Depends),
    # see module docstring for why. Raises HTTPException(403) on failure;
    # left to propagate to `app/main.py`'s global handler rather than
    # caught-and-reconstructed here, same as `get_current_actor`'s 401
    # already does elsewhere in this app.
    await require_permission("ai_agent.create")(request, actor)

    # 4. Validate the accountability link: must be an active OrgMembership
    # of this same org_id, not just any user that exists anywhere.
    target_membership = await db.scalar(
        select(OrgMembership.id).where(
            OrgMembership.org_id == org_id,
            OrgMembership.user_id == payload.acting_on_behalf_of_user_id,
            OrgMembership.status == OrgMembershipStatus.active,
        )
    )
    if target_membership is None:
        return _error(
            422,
            "invalid_acting_on_behalf_of_user",
            "acting_on_behalf_of_user_id must reference an active member of this organization.",
        )

    # 5. Issue the credential. Raw key never persisted, never logged.
    raw_key, key_prefix = generate_api_key()
    now = datetime.now(UTC)
    agent = AIAgent(
        agent_name=payload.agent_name,
        model_or_provider=payload.model_or_provider,
        acting_on_behalf_of_user_id=payload.acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=now,
        revoked_at=None,
        last_used_at=None,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    return CreateAgentResponse(
        agent_id=agent.actor_id,
        agent_name=agent.agent_name,
        api_key=raw_key,
        key_prefix=agent.key_prefix,
    )


@router.post("/orgs/{org_id}/agents/{agent_id}/revoke", response_model=RevokeAgentResponse)
async def revoke_agent(
    org_id: UUID,
    agent_id: UUID,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> RevokeAgentResponse | JSONResponse:
    """Revoke an AIAgent's bearer API key (ADR-0015).

    Idempotent: revoking an already-revoked agent returns 200 with the
    existing `revoked_at`, not an error — mirrors `RefreshToken`'s
    revoke-is-idempotent posture. A revoked agent's key immediately 401s on
    its next `get_current_actor` resolution (`revoked_at IS NULL` is part of
    the lookup `WHERE` clause, not a separate cache/blocklist).

    404 if `agent_id` doesn't exist at all, OR exists but doesn't belong to
    `org_id`. `AIAgent` carries no direct `org_id` column (Database Document
    §3.4) — its org relationship is transitive, via
    `acting_on_behalf_of_user_id`'s own `OrgMembership` rows. "Belongs to
    org_id" is therefore resolved as: does the agent's
    `acting_on_behalf_of_user_id` have an `OrgMembership` (any status, same
    boundary posture as step 2 below) in this `org_id`. This is the only
    schema-consistent reading available — there is no other org-scoping
    field on `AIAgent` to check instead.
    """
    # 1. Human-only gate.
    if not isinstance(actor, User):
        return _error(403, "actor_forbidden", "This action is restricted to human users.")

    # 2. 404-vs-403 boundary for the *caller's own* membership in org_id.
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    # 3. Permission check — same invoke-directly pattern as create_agent.
    await require_permission("ai_agent.update")(request, actor)

    # 4. Resolve the target agent; 404 if missing or not in this org (see
    # docstring for why org-membership of acting_on_behalf_of_user_id is the
    # only available "belongs to org_id" signal).
    agent_result = await db.execute(select(AIAgent).where(AIAgent.actor_id == agent_id))
    agent = agent_result.scalars().first()
    if agent is None or not await _org_membership_exists(db, org_id, agent.acting_on_behalf_of_user_id):
        return _error(404, "not_found", "Agent not found.")

    # 5. Revoke, idempotently.
    if agent.revoked_at is not None:
        return RevokeAgentResponse(agent_id=agent.actor_id, revoked_at=agent.revoked_at)

    agent.revoked_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(agent)

    return RevokeAgentResponse(agent_id=agent.actor_id, revoked_at=agent.revoked_at)


def _summary(agent: AIAgent) -> AgentSummary:
    return AgentSummary(
        agent_id=agent.actor_id,
        agent_name=agent.agent_name,
        model_or_provider=agent.model_or_provider,
        key_prefix=agent.key_prefix,
        acting_on_behalf_of_user_id=agent.acting_on_behalf_of_user_id,
        issued_at=agent.issued_at,
        revoked_at=agent.revoked_at,
        last_used_at=agent.last_used_at,
    )


@router.get("/orgs/{org_id}/agents", response_model=ListAgentsResponse)
async def list_agents(
    org_id: UUID,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
) -> ListAgentsResponse | JSONResponse:
    """List every `AIAgent` credential issued "on behalf of" a member of `org_id` (ADR-0063).

    Same gate order as `create_agent`/`revoke_agent` (human-only, then the
    404-vs-403 boundary, then a permission check) — an `AIAgent` caller can
    view other agents' credential metadata no more than it can mint or
    revoke one.

    **Permission code reuse, not a new one**: ADR-0015 seeded only
    `ai_agent.create`/`ai_agent.update`, no `.read` code, and this route
    deliberately reuses `ai_agent.create` rather than adding a third
    permission code + its own RBAC seed-bundle migration (`backend/CLAUDE.md`
    "RBAC bundle extensions always need a new data migration") for a single
    read route — the same minimal-RBAC-now posture ADR-0015 itself already
    took. Revisit if a future story needs to grant list-only access without
    create rights.

    **"Belongs to `org_id`" resolution**: `AIAgent` carries no direct
    `org_id` column (same schema shape `revoke_agent`'s own docstring
    explains) — an agent belongs to `org_id` transitively, via its
    `acting_on_behalf_of_user_id`'s `OrgMembership` row(s) in that org (any
    status, same boundary posture as the 404 check below). Includes revoked
    agents (`revoked_at` populated, not filtered out) — management needs the
    full history, not just currently-active keys.

    Ordered by `issued_at` ascending, then `agent_id` — same explicit,
    stable-order requirement offset pagination always needs
    (`role_assignments.py`'s own list route already established this).
    """
    # 1. Human-only gate.
    if not isinstance(actor, User):
        return _error(403, "actor_forbidden", "This action is restricted to human users.")

    # 2. 404-vs-403 boundary.
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    # 3. Permission check — invoked directly, same posture as the other two routes.
    await require_permission("ai_agent.create")(request, actor)

    page, page_size = clamp_pagination(page, page_size, 100)

    # An agent "belongs to" org_id via its acting_on_behalf_of_user_id's own
    # OrgMembership — resolved as a subquery of user_ids with any-status
    # membership in this org, not a join (an agent can be
    # acting-on-behalf-of a user with multiple OrgMembership rows across
    # orgs; a join would need an explicit DISTINCT to avoid duplicate rows).
    member_user_ids = select(OrgMembership.user_id).where(OrgMembership.org_id == org_id)

    total = await db.scalar(
        select(func.count())
        .select_from(AIAgent)
        .where(AIAgent.acting_on_behalf_of_user_id.in_(member_user_ids))
    )
    result = await db.execute(
        select(AIAgent)
        .where(AIAgent.acting_on_behalf_of_user_id.in_(member_user_ids))
        .order_by(AIAgent.issued_at.asc(), AIAgent.actor_id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = result.scalars().all()

    return ListAgentsResponse(
        items=[_summary(row) for row in rows],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/agents/me/orgs", response_model=MeOrgsResponse)
async def agent_me_orgs(
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> MeOrgsResponse | JSONResponse:
    """The calling AIAgent's own **active**-membership Organizations (ADR-0090).

    The AIAgent-only mirror of `GET /auth/me/orgs` (`auth.py`, SHELL-6/
    ADR-0036) — that route explicitly 403s any `AIAgent` caller, since
    `OrgMembership.user_id` FKs `user.actor_id` and an `AIAgent` has no row
    there at all to resolve. This route answers the same question for the
    actor type that route structurally cannot: an `AIAgent`'s own orgs are
    resolved transitively, via its `acting_on_behalf_of_user_id`'s
    **active** `OrgMembership` rows — reusing `_active_orgs_for_user`
    (`auth.py`) rather than a second copy of that query, same "one
    definition of the caller's orgs" reasoning that function's own docstring
    already gives for `login()`/`refresh()`/`me_orgs()`.

    Exists because the MCP surface (ADR-0033/ADR-0065/ADR-0068) gives an
    `AIAgent` no way to discover which org(s) it may act within before
    calling any org-scoped list route (`GET /projects?org_id=...` and
    friends all require `org_id` up front, and nothing on this server lists
    orgs without one) — `/auth/*` is otherwise deliberately excluded from
    the MCP-reachable surface (ADR-0065 Decision §2, "human-identity/token
    flows, not agent-actionable data"), so this is a new, narrow route
    outside that prefix rather than a widening of it.

    Human-only gate is the exact inverse of `me_orgs()`'s: a `User` calling
    this route gets `403 actor_forbidden` (it's `/auth/me/orgs`'s job to
    answer that question for a human), not an empty list — an empty list
    would be indistinguishable from "this agent's user has no active org."

    Identity-scoped, not org-scoped: no `org_id` path param, no tenant
    boundary to enforce, no `require_permission` call — same posture
    `me_orgs()` itself takes, and `GET /orgs/{org_id}/permissions/mine`
    before it. Zero active memberships is `200` with `orgs: []`, not an
    error — this reports state, it doesn't gate a session.
    """
    if not isinstance(actor, AIAgent):
        return _error(403, "actor_forbidden", "This action is restricted to AI agents.")

    orgs = await _active_orgs_for_user(db, actor.acting_on_behalf_of_user_id)
    return MeOrgsResponse(orgs=[OrgSummary(id=org.id, name=org.name, slug=org.slug) for org in orgs])
