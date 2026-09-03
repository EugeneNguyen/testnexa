"""Planning cluster: TestPlan, EntryExitCriteria, TestCycle, Environment (+ junction).

Source: Database Document §3.7.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7, updated_at_column


class TestPlanStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    superseded = "superseded"


class EntryExitCriteriaType(str, enum.Enum):
    entry = "entry"
    exit = "exit"
    suspension = "suspension"
    resumption = "resumption"


class TestPlan(Base):
    __tablename__ = "test_plan"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("project.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_by_actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("actor.id", ondelete="RESTRICT"), nullable=False
    )
    identifier: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    approach: Mapped[str | None] = mapped_column(Text, nullable=True)
    staffing_and_training: Mapped[str | None] = mapped_column(Text, nullable=True)
    schedule: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TestPlanStatus] = mapped_column(
        SAEnum(TestPlanStatus, name="test_plan_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=TestPlanStatus.draft,
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class TestPlanTestSuite(Base):
    """Junction table (many-to-many). Immutable — created_at only."""

    __tablename__ = "test_plan_test_suite"
    __table_args__ = (
        UniqueConstraint("test_plan_id", "test_suite_id", name="uq_test_plan_test_suite"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_plan.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_suite_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_suite.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = created_at_column()


class EntryExitCriteria(Base):
    __tablename__ = "entry_exit_criteria"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_plan.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[EntryExitCriteriaType] = mapped_column(
        SAEnum(
            EntryExitCriteriaType,
            name="entry_exit_criteria_type",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    condition_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class Environment(Base):
    """Scoped to project_id — refinement beyond the 07 draft, required for tenant isolation (NFR-1)."""

    __tablename__ = "environment"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("project.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    config_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class TestCycle(Base):
    __tablename__ = "test_cycle"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_plan.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    release_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("release.id", ondelete="RESTRICT"), nullable=False
    )
    environment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("environment.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
