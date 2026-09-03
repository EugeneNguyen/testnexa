"""Governance cluster: Approval, RiskItem, Attachment.

Source: Database Document §3.11.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7, updated_at_column


class RiskLevel(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Approval(Base):
    """`approved_by_user_id` FKs `user.actor_id` directly, never `actor.id`,
    structurally enforcing human-only per ADR-0004. Immutable — created_at only."""

    __tablename__ = "approval"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_plan.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # NOTE: references user.actor_id — see actor.py joined-table-inheritance deviation note.
    approved_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("user.actor_id", ondelete="RESTRICT"), nullable=False
    )
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class RiskItem(Base):
    __tablename__ = "risk_item"
    __table_args__ = (
        CheckConstraint(
            "requirement_id IS NOT NULL OR test_plan_id IS NOT NULL",
            name="ck_risk_item_requirement_or_test_plan",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    requirement_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("requirement.id", ondelete="RESTRICT"), nullable=True
    )
    test_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_plan.id", ondelete="RESTRICT"), nullable=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    likelihood: Mapped[RiskLevel] = mapped_column(
        SAEnum(RiskLevel, name="risk_likelihood", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    impact: Mapped[RiskLevel] = mapped_column(
        SAEnum(RiskLevel, name="risk_impact", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    mitigation: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class Attachment(Base):
    __tablename__ = "attachment"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_case.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Opaque to the DB either way — ATTACHMENT_STORAGE env var selects local vs S3 at the app layer.
    url_or_path: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
