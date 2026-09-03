"""Tenancy cluster: Organization, OrgMembership.

Source: Database Document §3.1.
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
