"""Auth cluster: AuthIdentity, RefreshToken, LoginAttempt.

Source: Database Document §3.2. Only `provider="local"` has working auth
logic anywhere in this scaffold; other providers are schema-ready, unimplemented.
`LoginAttempt` backs the AUTH-1/ADR-0011 login throttle (NFR-11).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_column, generate_uuid7, updated_at_column


class AuthProvider(str, enum.Enum):
    local = "local"
    oidc = "oidc"
    saml = "saml"
    ldap = "ldap"
    github = "github"
    google = "google"


class AuthIdentity(Base):
    __tablename__ = "auth_identity"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    # NOTE: references user.actor_id — see actor.py joined-table-inheritance deviation note.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("user.actor_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    provider: Mapped[AuthProvider] = mapped_column(
        SAEnum(AuthProvider, name="auth_provider", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class RefreshToken(Base):
    """Not in the 07 ERD — added per ADR-0003 for revocable sessions."""

    __tablename__ = "refresh_token"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    # NOTE: references user.actor_id — see actor.py joined-table-inheritance deviation note.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("user.actor_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Unique index (ADR-0013): AUTH-2's `POST /auth/refresh` makes
    # `WHERE token_hash = ?` a hot-path lookup on every renewal — AUTH-1
    # never indexed this since nothing looked it up by value. Uniqueness
    # also backs the single-use rotation invariant at the DB level.
    token_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class LoginAttempt(Base):
    """Not in the 07 ERD — added per ADR-0011 for the login throttle (NFR-11).

    Append-only: no `updated_at`, no update/delete API path (same
    immutability pattern as `TestLog`) — the throttle query is "count
    `succeeded = false` rows for this `(email, client_ip)` within the last 15
    minutes." `email` is stored lowercased and recorded even when it doesn't
    resolve to a `User`, so a throttle check works identically for a
    nonexistent email.
    """

    __tablename__ = "login_attempt"
    __table_args__ = (
        Index("ix_login_attempt_email_ip_attempted_at", "email", "client_ip", "attempted_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=generate_uuid7)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    client_ip: Mapped[str] = mapped_column(String, nullable=False, index=True)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = created_at_column()
