"""Pydantic v2 schemas for the RBAC-2 `/orgs/{org_id}/members*` / `/invites/{token}/accept` routes.

Source: API Document §2 (route contracts), ADR-0017 (invite & manage org
members). `status` fields use a plain `Literal` of the 3
`OrgMembership.status` string values rather than importing
`app.models.tenancy.OrgMembershipStatus` directly — matching this package's
existing convention (`app/schemas/auth.py`'s `LoginResponse.org_context`
does the same, plain `Literal["auto", "picker"]`, not a model-imported enum;
no `app/schemas/*.py` module imports from `app.models` anywhere in this
codebase). Legal-transition business rules (`active <-> suspended` only via
`PATCH`, `invited -> active` only via the two accept routes) are enforced in
the route body, not the schema layer — same posture the org-slug-collision
`422` in `app/api/routes/organizations.py` takes for its own business-rule
validation.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr

MembershipStatus = Literal["invited", "active", "suspended"]


class InviteMemberRequest(BaseModel):
    """Body of `POST /orgs/{org_id}/members/invite`."""

    email: EmailStr


class MemberSummary(BaseModel):
    """One member row — `GET /orgs/{org_id}/members` list entry, and the
    response shape of both accept routes' success case.
    """

    membership_id: UUID
    user_id: UUID
    email: str
    status: MembershipStatus
    joined_at: datetime | None


class MemberListResponse(BaseModel):
    """Response of `GET /orgs/{org_id}/members`.

    Offset-paginated per NFR-6 (page size 25 default) — the API Document's
    own §2 entry for this route says only "paginated list of {...}" without
    spelling out an envelope shape (the generic CRUD factory referenced
    elsewhere in that document, which would otherwise set precedent for one,
    doesn't exist in code yet); this envelope follows NFR-6's own
    offset-pagination framing rather than returning a bare unpaginated array.
    """

    items: list[MemberSummary]
    total: int
    page: int
    page_size: int


class InviteMemberResponse(BaseModel):
    """Response of `POST /orgs/{org_id}/members/invite`.

    `invite_link` is non-null only for the "new email" branch (ADR-0017) —
    it embeds the raw, one-time invite token, shown exactly once, same
    one-time-secret posture `POST /orgs/{org_id}/agents`'s `api_key` takes.
    `null` for the "existing email" branch, which creates no `Invite` row at
    all (acceptance there is self-service via the already-authenticated
    user, not a token).
    """

    membership_id: UUID
    status: Literal["invited"]
    invite_link: str | None


class AcceptInviteRequest(BaseModel):
    """Body of `POST /invites/{token}/accept` (public, new-user path)."""

    password: str


class PatchMembershipRequest(BaseModel):
    """Body of `PATCH /orgs/{org_id}/members/{membership_id}`.

    Accepts any of the 3 `OrgMembership.status` values at the schema layer
    (a nonsense string is FastAPI's own 422) — the "only `active <->
    suspended` is a legal transition through this route, `invited` is never
    a legal value here at all" business rule is enforced in the route body
    (ADR-0017), matching this route's own bespoke-route-validated framing
    rather than a bare field-level `PATCH`.
    """

    status: MembershipStatus


__all__ = [
    "AcceptInviteRequest",
    "InviteMemberRequest",
    "InviteMemberResponse",
    "MemberListResponse",
    "MemberSummary",
    "MembershipStatus",
    "PatchMembershipRequest",
]
