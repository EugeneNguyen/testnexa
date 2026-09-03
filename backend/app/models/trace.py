"""Traceability cluster: the 4 dedicated link tables (ADR-0005).

Source: Database Document §3.9. All four share the same shape: surrogate
uuid PK, two FK columns (not null, indexed, on delete cascade), unique
constraint on the pair, `created_at` only — links are immutable
(delete-and-recreate, never edited).
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7


class RequirementTestCaseLink(Base):
    __tablename__ = "requirement_test_case_link"
    __table_args__ = (
        UniqueConstraint("requirement_id", "test_case_id", name="uq_requirement_test_case_link"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    requirement_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("requirement.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_case.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = created_at_column()


class RequirementTestConditionLink(Base):
    __tablename__ = "requirement_test_condition_link"
    __table_args__ = (
        UniqueConstraint(
            "requirement_id", "test_condition_id", name="uq_requirement_test_condition_link"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    requirement_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("requirement.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_condition_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_condition.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = created_at_column()


class TestConditionTestCaseLink(Base):
    __tablename__ = "test_condition_test_case_link"
    __table_args__ = (
        UniqueConstraint(
            "test_condition_id", "test_case_id", name="uq_test_condition_test_case_link"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_condition_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_condition.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_case.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = created_at_column()


class TestCaseDefectLink(Base):
    __tablename__ = "test_case_defect_link"
    __table_args__ = (
        UniqueConstraint("test_case_id", "defect_id", name="uq_test_case_defect_link"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_case.id", ondelete="CASCADE"), nullable=False, index=True
    )
    defect_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("defect.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = created_at_column()
