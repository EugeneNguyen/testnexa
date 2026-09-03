"""Execution cluster: TestExecution, TestLog, Defect.

Source: Database Document §3.8.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7, updated_at_column


class TestExecutionResult(str, enum.Enum):
    # NOTE: `pass` is a Python keyword and cannot be a member name, so the
    # member is named `passed` while its stored/DB *value* is exactly "pass"
    # (values_callable below persists .value, not .name).
    passed = "pass"
    fail = "fail"
    blocked = "blocked"
    skipped = "skipped"


class TestLogEventType(str, enum.Enum):
    status_change = "status_change"
    comment = "comment"
    attachment = "attachment"
    agent_action = "agent_action"


class DefectSeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class TestExecution(Base):
    __tablename__ = "test_execution"
    __table_args__ = (
        Index("ix_test_execution_cycle_case", "test_cycle_id", "test_case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_cycle_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_cycle.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_case.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    executed_by_actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("actor.id", ondelete="RESTRICT"), nullable=False
    )
    result: Mapped[TestExecutionResult] = mapped_column(
        SAEnum(
            TestExecutionResult,
            name="test_execution_result",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    actual_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class TestLog(Base):
    """Append-only: no `updated_at`, no update/delete API path (immutability enforced at schema level)."""

    __tablename__ = "test_log"
    __table_args__ = (
        Index("ix_test_log_execution_logged_at", "test_execution_id", "logged_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_execution_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_execution.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    event_type: Mapped[TestLogEventType] = mapped_column(
        SAEnum(
            TestLogEventType, name="test_log_event_type", values_callable=lambda e: [m.value for m in e]
        ),
        nullable=False,
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class Defect(Base):
    __tablename__ = "defect"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    test_execution_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("test_execution.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reported_by_actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("actor.id", ondelete="RESTRICT"), nullable=False
    )
    external_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    severity: Mapped[DefectSeverity] = mapped_column(
        SAEnum(DefectSeverity, name="defect_severity", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
