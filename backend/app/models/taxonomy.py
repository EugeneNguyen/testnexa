"""Taxonomy cluster: TestDesignTechnique, TestLevel, TestType (+ junction).

Source: Database Document §3.10. Lookup tables — hard delete allowed for an
admin with the corresponding `.delete` permission (application-layer concern).
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7, updated_at_column


class TestDesignTechnique(Base):
    __tablename__ = "test_design_technique"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    istqb_chapter_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class TestLevel(Base):
    __tablename__ = "test_level"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class TestType(Base):
    __tablename__ = "test_type"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class TestCaseTestDesignTechnique(Base):
    """Junction table (many-to-many, ADMIN-1). Immutable — created_at only."""

    __tablename__ = "test_case_test_design_technique"
    __table_args__ = (
        UniqueConstraint(
            "test_case_id", "test_design_technique_id", name="uq_test_case_test_design_technique"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_case.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_design_technique_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("test_design_technique.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = created_at_column()
