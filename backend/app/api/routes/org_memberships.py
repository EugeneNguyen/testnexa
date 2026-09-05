"""RBAC-2: invite/list/accept/suspend/reactivate/revoke org members.

Source: API Document §2 (`/orgs/{org_id}/members*`, `/invites/{token}/accept`
contracts), ADR-0017 (invite & manage org members), Database Document §3.1
(`Invite` table spec).

Route-by-route gate order (mirrors `agents.py`'s established pattern where
applicable — see that module's own docstring):

- `GET /orgs/{org_id}/members`, `POST /orgs/{org_id}/members/invite`,
  `PATCH /orgs/{org_id}/members/{membership_id}`,
  `DELETE /orgs/{org_id}/members/{membership_id}`: (1) any-status
  `OrgMembership` existence check for the CALLER -> `404 not_found`
  (NFR-1/NFR-19 boundary, `_org_membership_exists`, same shape as
  `agents.py`'s helper of the same name — duplicated locally per this
  codebase's established per-module duplication convention, not imported);
  (2) `require_permission(...)` invoked directly, not as a route-level
  `Depends`, so the 404 above can never be preceded by a 403 (FastAPI
  resolves `Depends` before the route body runs); (3) business logic/422s.
  `require_permission` itself now also enforces RBAC-2's suspended-member
  gate (`app/core/rbac.py`, ADR-0017) — a `User` caller whose own
  `OrgMembership` in `org_id` is `suspended` (not `active`) gets
  `403 membership_inactive` here, before the `org_membership.*` check runs.

- `POST /invites/{token}/accept`: public, no `Authorization` header, no
  `OrgMembership`/permission gate at all — gated purely by token validity.

- `POST /orgs/{org_id}/members/{membership_id}/accept`: authenticated,
  identity-gated (caller must be the `User` the membership targets), no
  `Permission` code — the invitee is acting on their own pending membership,
  not exercising an org_admin privilege (ADR-0017).

API-1/ADR-0021 adds the generic-CRUD factory's `GET /org-memberships` (list)
and `GET`/`PATCH`/`DELETE /org-memberships/{id}` at the bottom of this
module — a distinct, additive path prefix from the bespoke
`/orgs/{org_id}/members*` routes above (verified no collision before wiring,
per the plan's flagged edge case). No factory `create` — `POST
/org-memberships` would duplicate/bypass `invite_member`'s own
User/`Invite`-creation mechanics, which a raw factory insert can't
replicate; the plan's own task list only asks for list/get/patch/delete
here, not create.
"""

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import CrudEntityConfig, chain_resolver, make_crud_router
from app.api.deps import get_current_actor, get_db, require_permission
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    generate_invite_token,
    hash_invite_token,
    hash_password,
    hash_refresh_token,
)
from app.models.actor import AIAgent, User
from app.models.auth import AuthIdentity, AuthProvider, RefreshToken
from app.models.tenancy import Invite, Organization, OrgMembership, OrgMembershipStatus
from app.schemas.auth import LoginResponse, OrgSummary
from app.schemas.org_memberships import (
    AcceptInviteRequest,
    InviteMemberRequest,
    InviteMemberResponse,
    MemberListResponse,
    MemberSummary,
    OrgMembershipSummary,
    PatchMembershipRequest,
    UpdateOrgMembershipRequest,
)

router = APIRouter()

# ADR-0017: 7 days from issuance.
_INVITE_EXPIRY_DAYS = 7
# NFR-6: page size 25, offset pagination — same default the (not-yet-built)
# generic CRUD factory's list routes are specified to use.
_DEFAULT_PAGE_SIZE = 25

# ADR-0017 Decision: the only legal transition through the PATCH route.
_PATCH_LEGAL_STATUSES = frozenset({OrgMembershipStatus.active, OrgMembershipStatus.suspended})


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `auth.py`/`agents.py`/`organizations.py`'s `_error()` verbatim —
    same convention, separate copy per this codebase's existing precedent.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _org_membership_exists(db: AsyncSession, org_id: UUID, user_id: UUID) -> bool:
    """Any-status `OrgMembership` existence check for the 404-vs-403 boundary.

    Verbatim copy of `agents.py`'s helper of the same name — see that
    module's docstring for the full rationale (NFR-1: any-status counts,
    not just active). Duplicated rather than imported, matching this
    codebase's established per-module `_error()`-style duplication.
    """
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


def _is_legal_patch_transition(current: OrgMembershipStatus, requested: OrgMembershipStatus) -> bool:
    """Whether `PATCH /orgs/{org_id}/members/{membership_id} {status: requested}` is legal.

    ADR-0017 Decision: the only legal transition is `active <-> suspended`.
    `invited -> active` is reachable only through the two accept routes,
    never this one; nothing ever moves a membership backward into `invited`.
    Pure function, no DB access — unit-tested directly
    (`tests/unit/test_org_membership_transitions.py`).
    """
    return current in _PATCH_LEGAL_STATUSES and requested in _PATCH_LEGAL_STATUSES


def _is_revocable(status: OrgMembershipStatus) -> bool:
    """Whether `DELETE /orgs/{org_id}/members/{membership_id}` may act on `status`.

    ADR-0017 Decision: scoped to `status = invited` only — revokes a
    not-yet-accepted invite; `422` against an `active`/`suspended`
    membership (this route is not a general remove-member action).
    """
    return status == OrgMembershipStatus.invited


async def _member_summary(db: AsyncSession, membership: OrgMembership) -> MemberSummary:
    """Build a `MemberSummary` for `membership`, resolving its `User.email`."""
    email = await db.scalar(select(User.email).where(User.actor_id == membership.user_id))
    return MemberSummary(
        membership_id=membership.id,
        user_id=membership.user_id,
        email=email or "",
        status=membership.status.value,
        joined_at=membership.joined_at,
    )


# --- GET /orgs/{org_id}/members ------------------------------------------------------------


@router.get("/orgs/{org_id}/members", response_model=MemberListResponse)
async def list_members(
    org_id: UUID,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
) -> MemberListResponse | JSONResponse:
    """List an org's members (FR-RBAC-2), `org_membership.read`.

    Same 404-vs-403 boundary as every other org-scoped route (module
    docstring). Offset-paginated per NFR-6 — see
    `app.schemas.org_memberships.MemberListResponse`'s own docstring for why
    this envelope shape, not a bare array.
    """
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    await require_permission("org_membership.read")(request, actor)

    total = await db.scalar(
        select(func.count()).select_from(OrgMembership).where(OrgMembership.org_id == org_id)
    )
    result = await db.execute(
        select(OrgMembership, User.email)
        .join(User, User.actor_id == OrgMembership.user_id)
        .where(OrgMembership.org_id == org_id)
        .order_by(OrgMembership.created_at.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [
        MemberSummary(
            membership_id=membership.id,
            user_id=membership.user_id,
            email=email,
            status=membership.status.value,
            joined_at=membership.joined_at,
        )
        for membership, email in result.all()
    ]

    return MemberListResponse(items=items, total=total or 0, page=page, page_size=page_size)


# --- POST /orgs/{org_id}/members/invite ----------------------------------------------------


@router.post("/orgs/{org_id}/members/invite", response_model=InviteMemberResponse, status_code=201)
async def invite_member(
    org_id: UUID,
    payload: InviteMemberRequest,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> InviteMemberResponse | JSONResponse:
    """Invite a member by email (FR-RBAC-2), `org_membership.create`.

    Branches on whether `email` already resolves to a `User` (ADR-0017):

    - **Existing email, no membership in this org yet**: creates
      `OrgMembership(status=invited)` pointing at the existing `User`, no
      `Invite` row, `invite_link: null` (TC-RBAC-024).
    - **Existing email, already `invited` in this org**: resend — if a live
      `Invite` row exists (the original invite was via the new-email
      branch), replaces its `token_hash`/`expires_at` in place and returns a
      fresh `invite_link` (TC-RBAC-026); otherwise (original was the
      existing-user branch, no token involved) a no-op re-confirmation,
      `invite_link: null`.
    - **Existing email, already `active`/`suspended` in this org**: `409`
      (TC-RBAC-025).
    - **New email**: creates `Actor`+`User` (no `AuthIdentity` yet) +
      `OrgMembership(status=invited)` + an `Invite` row, `invite_link`
      non-null (TC-RBAC-004).

    `User.password_hash` is NOT NULL (Database Document §3.4) — the
    new-email branch's freshly created `User` gets a random, never-revealed
    placeholder hash (`hash_password(secrets.token_urlsafe(32))`) rather
    than a schema change. This is not a usable credential: `POST
    /auth/login` only ever resolves a `User` joined to a `provider=local`
    `AuthIdentity` row, which doesn't exist yet for this user — so "no
    password until they accept" (ADR-0017) holds functionally even though
    the column itself is never NULL.
    """
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    await require_permission("org_membership.create")(request, actor)

    email = payload.email.lower()
    existing_user = await db.scalar(select(User).where(User.email == email))

    if existing_user is not None:
        existing_membership = await db.scalar(
            select(OrgMembership).where(
                OrgMembership.org_id == org_id, OrgMembership.user_id == existing_user.actor_id
            )
        )
        if existing_membership is not None:
            if existing_membership.status != OrgMembershipStatus.invited:
                return _error(
                    409,
                    "membership_already_exists",
                    "This email is already a member of this organization.",
                )

            existing_invite = await db.scalar(
                select(Invite).where(Invite.org_membership_id == existing_membership.id)
            )
            if existing_invite is not None:
                # Resend, new-email path: replace this row's token/expiry in
                # place (ADR-0017) — TC-RBAC-026.
                raw_token = generate_invite_token()
                existing_invite.token_hash = hash_invite_token(raw_token)
                existing_invite.expires_at = datetime.now(UTC) + timedelta(days=_INVITE_EXPIRY_DAYS)
                await db.commit()
                invite_link = f"{settings.APP_BASE_URL}/invites/{raw_token}/accept"
                return InviteMemberResponse(
                    membership_id=existing_membership.id, status="invited", invite_link=invite_link
                )

            # Resend, existing-user path: no token was ever involved.
            return InviteMemberResponse(
                membership_id=existing_membership.id, status="invited", invite_link=None
            )

        # "Existing email" branch (ADR-0017): user exists, no membership in
        # this org yet.
        membership = OrgMembership(
            org_id=org_id, user_id=existing_user.actor_id, status=OrgMembershipStatus.invited
        )
        db.add(membership)
        await db.commit()
        await db.refresh(membership)
        return InviteMemberResponse(membership_id=membership.id, status="invited", invite_link=None)

    # "New email" branch (ADR-0017): Actor+User (no AuthIdentity yet) +
    # OrgMembership(invited) + Invite.
    placeholder_secret = secrets.token_urlsafe(32)  # never revealed, see docstring
    new_user = User(name=email, email=email, password_hash=hash_password(placeholder_secret))
    db.add(new_user)
    await db.flush()  # populate new_user.actor_id (joined-table inheritance PK/FK)

    membership = OrgMembership(org_id=org_id, user_id=new_user.actor_id, status=OrgMembershipStatus.invited)
    db.add(membership)
    await db.flush()  # populate membership.id

    raw_token = generate_invite_token()
    now = datetime.now(UTC)
    db.add(
        Invite(
            org_membership_id=membership.id,
            token_hash=hash_invite_token(raw_token),
            expires_at=now + timedelta(days=_INVITE_EXPIRY_DAYS),
            invited_by_actor_id=actor.actor_id,
        )
    )
    await db.commit()
    await db.refresh(membership)

    invite_link = f"{settings.APP_BASE_URL}/invites/{raw_token}/accept"
    return InviteMemberResponse(membership_id=membership.id, status="invited", invite_link=invite_link)


# --- POST /invites/{token}/accept ------------------------------------------------------------


@router.post("/invites/{token}/accept", response_model=LoginResponse)
async def accept_invite_by_token(
    token: str,
    payload: AcceptInviteRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse | JSONResponse:
    """New-user accept path (FR-RBAC-2): public, no `Authorization` header.

    Looks up `Invite` by `token_hash`; missing or `expires_at` elapsed ->
    `404 invite_not_found` (does not distinguish "never existed" from
    "expired" — no enumeration value in doing so; TC-RBAC-027/028). On
    success: creates the pre-created `User`'s `AuthIdentity(provider=local)`
    (argon2 hash, same as signup/login), sets its real `password_hash`
    (overwriting the invite-time placeholder — see `invite_member`'s
    docstring), flips the linked `OrgMembership.status` to `active`, sets
    `joined_at`, deletes the `Invite` row, and issues tokens exactly like
    `POST /auth/login`'s success path (TC-RBAC-005).
    """
    token_hash = hash_invite_token(token)
    now = datetime.now(UTC)

    invite = await db.scalar(select(Invite).where(Invite.token_hash == token_hash))
    if invite is None or invite.expires_at < now:
        return _error(404, "invite_not_found", "This invite link is invalid or has expired.")

    membership = await db.get(OrgMembership, invite.org_membership_id)
    user = await db.get(User, membership.user_id)
    org = await db.get(Organization, membership.org_id)

    user.password_hash = hash_password(payload.password)
    db.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

    membership.status = OrgMembershipStatus.active
    membership.joined_at = now

    await db.delete(invite)

    access_token = create_access_token(str(user.actor_id))
    raw_refresh_token = create_refresh_token(str(user.actor_id))
    db.add(
        RefreshToken(
            user_id=user.actor_id,
            token_hash=hash_refresh_token(raw_refresh_token),
            issued_at=now,
            expires_at=now + timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
        )
    )
    await db.commit()

    # Refresh token: httpOnly cookie only, never in the JSON body — same
    # params `login()`/`signup()` set it with (app/api/routes/auth.py).
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh_token,
        httponly=True,
        samesite="lax",
        secure=(settings.ENV != "dev"),
        max_age=settings.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    )

    return LoginResponse(
        access_token=access_token,
        org_context="auto",
        orgs=[OrgSummary(id=org.id, name=org.name, slug=org.slug)],
    )


# --- POST /orgs/{org_id}/members/{membership_id}/accept -------------------------------------


@router.post("/orgs/{org_id}/members/{membership_id}/accept", response_model=MemberSummary)
async def accept_membership_self(
    org_id: UUID,
    membership_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> MemberSummary | JSONResponse:
    """Existing-user accept path (FR-RBAC-2): authenticated, identity-gated.

    No `Permission` code — the caller must be the `User` the membership
    targets (`actor.actor_id == membership.user_id`); anything else is
    `403 actor_forbidden`, same shape as every other identity-mismatch
    rejection in this codebase (TC-RBAC-030). Membership must be
    `status = invited`, else `422` (TC-RBAC-029).
    """
    membership = await db.scalar(
        select(OrgMembership).where(OrgMembership.id == membership_id, OrgMembership.org_id == org_id)
    )
    if membership is None:
        return _error(404, "not_found", "Membership not found.")

    if not isinstance(actor, User) or membership.user_id != actor.actor_id:
        return _error(403, "actor_forbidden", "This action is restricted to the invited user.")

    if membership.status != OrgMembershipStatus.invited:
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"status": ["Only a pending invite can be accepted."]},
        )

    membership.status = OrgMembershipStatus.active
    membership.joined_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(membership)

    return await _member_summary(db, membership)


# --- PATCH /orgs/{org_id}/members/{membership_id} --------------------------------------------


@router.patch("/orgs/{org_id}/members/{membership_id}", response_model=MemberSummary)
async def patch_membership_status(
    org_id: UUID,
    membership_id: UUID,
    payload: PatchMembershipRequest,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> MemberSummary | JSONResponse:
    """Suspend/reactivate a member (FR-RBAC-2), `org_membership.update`.

    The only legal transition is `active <-> suspended` (TC-RBAC-034) — see
    `_is_legal_patch_transition`. Same 404-vs-403 boundary as every
    org-scoped route.
    """
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    await require_permission("org_membership.update")(request, actor)

    membership = await db.scalar(
        select(OrgMembership).where(OrgMembership.id == membership_id, OrgMembership.org_id == org_id)
    )
    if membership is None:
        return _error(404, "not_found", "Membership not found.")

    requested_status = OrgMembershipStatus(payload.status)
    if not _is_legal_patch_transition(membership.status, requested_status):
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"status": ["Only active <-> suspended transitions are allowed through this route."]},
        )

    membership.status = requested_status
    await db.commit()
    await db.refresh(membership)

    return await _member_summary(db, membership)


# --- DELETE /orgs/{org_id}/members/{membership_id} -------------------------------------------


@router.delete("/orgs/{org_id}/members/{membership_id}", status_code=204, response_model=None)
async def revoke_pending_invite(
    org_id: UUID,
    membership_id: UUID,
    request: Request,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> Response | JSONResponse:
    """Revoke a pending invite (FR-RBAC-2), `org_membership.delete`.

    Scoped to `status = invited` only (`_is_revocable`) — `422` against an
    `active`/`suspended` membership (TC-RBAC-033); deletes the membership
    row and its `Invite` row, if any (TC-RBAC-032). Not a general
    remove-member action.
    """
    if not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", "Organization not found.")

    await require_permission("org_membership.delete")(request, actor)

    membership = await db.scalar(
        select(OrgMembership).where(OrgMembership.id == membership_id, OrgMembership.org_id == org_id)
    )
    if membership is None:
        return _error(404, "not_found", "Membership not found.")

    if not _is_revocable(membership.status):
        return _error(
            422,
            "validation_error",
            "Request failed validation.",
            field_errors={"status": ["Only a pending invite can be revoked."]},
        )

    await db.execute(delete(Invite).where(Invite.org_membership_id == membership.id))
    await db.execute(delete(OrgMembership).where(OrgMembership.id == membership.id))
    await db.commit()

    return Response(status_code=204)


# --- API-1 generic-CRUD factory additions (ADR-0021) --------------------------------------------

_ORG_MEMBERSHIP_CONFIG = CrudEntityConfig(
    model=OrgMembership,
    resource="org_membership",
    create_schema=None,
    update_schema=UpdateOrgMembershipRequest,
    summary_schema=OrgMembershipSummary,
    scope_field="org_id",
    resolve_org_id=chain_resolver([]),
    filter_fields=("status",),
    methods=frozenset({"list", "get", "update", "delete"}),
)

router.include_router(make_crud_router(_ORG_MEMBERSHIP_CONFIG))
