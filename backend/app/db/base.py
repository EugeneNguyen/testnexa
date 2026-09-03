"""SQLAlchemy 2.0 declarative base + UUIDv7 primary-key generator.

Per ADR-0008: every table's primary key is a UUID generated at insert time,
using UUIDv7 (time-sortable) uniformly across all tables — no auto-increment
integers anywhere.
"""

import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

try:
    # Preferred: the `uuid6` package provides a spec-tracking uuid7() implementation.
    from uuid6 import uuid7 as _uuid7

    def generate_uuid7() -> uuid.UUID:
        """Generate a time-sortable UUIDv7 using the `uuid6` package."""
        return _uuid7()

except ImportError:  # pragma: no cover - exercised only when uuid6 is absent
    import os

    def _fallback_uuid7() -> uuid.UUID:
        """Minimal RFC 9562 (draft) UUIDv7 generator.

        Used ONLY as a fallback when the `uuid6` package is not installed.
        Layout: 48-bit big-endian ms timestamp | 4-bit version (7) |
        12-bit random | 2-bit variant (10) | 62-bit random.
        """
        unix_ts_ms = int(time.time() * 1000)
        rand_a = int.from_bytes(os.urandom(2), "big") & 0x0FFF  # 12 random bits
        rand_b = int.from_bytes(os.urandom(8), "big") & 0x3FFFFFFFFFFFFFFF  # 62 random bits

        uuid_int = (unix_ts_ms & 0xFFFFFFFFFFFF) << 80
        uuid_int |= 0x7 << 76  # version 7
        uuid_int |= rand_a << 64
        uuid_int |= 0b10 << 62  # variant
        uuid_int |= rand_b

        return uuid.UUID(int=uuid_int)

    def generate_uuid7() -> uuid.UUID:
        """Generate a time-sortable UUIDv7 (fallback, minimal RFC-draft implementation)."""
        return _fallback_uuid7()


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""



def utcnow() -> datetime:
    """Timezone-aware UTC now(), used as a Python-side default where needed."""
    return datetime.now(UTC)


def created_at_column() -> Mapped[datetime]:
    """Reusable `created_at` column factory for the schema-wide timestamp convention."""
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


def updated_at_column() -> Mapped[datetime]:
    """Reusable `updated_at` column factory (auto-touched on update).

    Not used on `TestLog`, which is append-only per the Database Document.
    """
    return mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
