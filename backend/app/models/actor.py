"""Actor cluster: Actor (supertype), User, AIAgent — SQLAlchemy joined-table inheritance.

Source: Database Document §3.4.

DEVIATION FROM THE LITERAL DOC TABLE LISTING (documented per task instructions):
The Database Document lists `User`/`AIAgent` each with their own surrogate
`id` column PLUS a separate unique `actor_id` FK column — an association-table
shape. The scaffold task explicitly directs "SQLAlchemy joined-table
inheritance ... via actor_id FK+PK", which is the standard SQLAlchemy 2.0
joined-table-inheritance mechanism: the child table's primary key IS the
foreign key to the parent (one column, not two). We follow the explicit
architecture instruction: `User.actor_id` / `AIAgent.actor_id` are each both
the primary key and the FK to `actor.id` — there is no separate `id` column
on these two tables. Every other model's FK that pointed at `user.id` per the
Database Document now points at `user.actor_id` instead (the real PK).
"""

import enum
import uuid
from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7, updated_at_column


class ActorType(str, enum.Enum):
    user = "user"
    ai_agent = "ai_agent"


class Actor(Base):
    """Supertype. Never queried alone in practice — resolved to User/AIAgent
    via one shared helper everywhere a created_by/executed_by/reported_by
    field is serialized (per ADR-0002's consequence note)."""

    __tablename__ = "actor"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    actor_type: Mapped[ActorType] = mapped_column(
        SAEnum(ActorType, name="actor_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    __mapper_args__: ClassVar[dict[str, Any]] = {
        "polymorphic_identity": "actor",
        "polymorphic_on": "actor_type",
    }


class User(Actor):
    __tablename__ = "user"

    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("actor.id", ondelete="CASCADE"), primary_key=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    # Own `created_at`/`updated_at` columns on the `user` table per the Database
    # Document's per-table listing (distinct physical columns from `actor`'s).
    # Mapped under distinct Python attribute names to avoid SQLAlchemy's
    # same-attribute-name column-combining warning across joined-inheritance tables.
    user_created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    user_updated_at: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __mapper_args__: ClassVar[dict[str, Any]] = {"polymorphic_identity": "user"}


class AIAgent(Actor):
    """Credential fields added beyond the 07 draft, per AUTH-4."""

    __tablename__ = "ai_agent"

    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("actor.id", ondelete="CASCADE"), primary_key=True
    )
    agent_name: Mapped[str] = mapped_column(String, nullable=False)
    model_or_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    mcp_session_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    # Accountability link, not an approver. References user.actor_id — see module docstring.
    acting_on_behalf_of_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("user.actor_id", ondelete="RESTRICT"), nullable=False
    )
    key_hash: Mapped[str] = mapped_column(String, nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(8), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # AUTH-4/ADR-0015: the AC3 `AuthIdentity.last_login_at`-equivalent for
    # agent sessions. Nullable — NULL until the agent's first successful
    # bearer-key authentication (an agent that's been issued a key but never
    # used it yet). Updated on every successful `get_current_actor` agent-key
    # resolution (`app/core/rbac.py`), not throttled to session boundaries —
    # see ADR-0015 for why "every request" wins over debounce complexity here.
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Own `created_at`/`updated_at` columns on the `ai_agent` table — see User's
    # equivalent fields above for why these use distinct Python attribute names.
    ai_agent_created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    ai_agent_updated_at: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __mapper_args__: ClassVar[dict[str, Any]] = {"polymorphic_identity": "ai_agent"}
