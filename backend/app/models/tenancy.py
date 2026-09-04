"""Tenancy cluster: Organization, OrgMembership, Invite.

Source: Database Document §3.1. `Invite` added per ADR-0017 (RBAC-2 invite &
manage org members) — not in the original 07 ERD draft.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7, updated_at_column


class OrgMembershipStatus(str, enum.Enum):
    invited = "invited"
    active = "active"
    suspended = "suspended"


class Organization(Base):
    """Deployment-wide tenant root. See ADR-0007 (real multi-tenancy)."""

    __tablename__ = "organization"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    default_standards_profile: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class OrgMembership(Base):
    """Links a User to an Organization with an invitation/active/suspended lifecycle."""

    __tablename__ = "org_membership"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_org_membership_org_user"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # NOTE: references user.actor_id — see actor.py joined-table-inheritance deviation note.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("user.actor_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[OrgMembershipStatus] = mapped_column(
        SAEnum(
            OrgMembershipStatus,
            name="org_membership_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=OrgMembershipStatus.invited,
    )
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class Invite(Base):
    """One-time invite token, RBAC-2's "new email" invite path only (ADR-0017).

    Source: Database Document §3.1 (`Invite` table spec). Not on the 07 ERD —
    an implementation necessity for invite-token mechanics, same category as
    `RefreshToken`/`LoginAttempt`.

    Only ever created alongside an `OrgMembership(status=invited)` row when
    the invited email does NOT already resolve to an existing `User`
    (`POST /orgs/{org_id}/members/invite`'s "new email" branch) — the
    "existing email" branch creates the `OrgMembership(status=invited)` row
    directly with no `Invite` row at all, since that path is accepted by the
    already-authenticated existing user, not by a token.

    `org_membership_id` is unique: at most one live invite per membership.
    Resending an invite (re-POSTing the same still-`invited` email) updates
    this same row's `token_hash`/`expires_at` in place rather than inserting
    a second row. The row is deleted once consumed
    (`POST /invites/{token}/accept`) or revoked
    (`DELETE /orgs/{org_id}/members/{membership_id}` on the still-`invited`
    membership).
    """

    __tablename__ = "invite"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    org_membership_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("org_membership.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # Raw token never stored — same pattern as `RefreshToken.token_hash`
    # (Database Document §3.1/§4 index rationale): a fast SHA-256 digest, not
    # argon2, since the raw token is already high-entropy
    # (`secrets.token_urlsafe`) and this column is a hot lookup key on
    # `POST /invites/{token}/accept`, not a low-entropy human secret needing
    # a deliberately-slow KDF. See `app/core/security.py`'s
    # `hash_invite_token`.
    token_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    # 7 days from issuance (ADR-0017); set by the route, not a column default,
    # since "issuance" is an application-level moment, not insert time alone
    # (resending updates this same column on an existing row).
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # References the generic actor.id (the inviting org_admin, User or
    # AIAgent) — not user.actor_id, since either actor type may hold
    # org_membership.create and invite someone.
    invited_by_actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("actor.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
