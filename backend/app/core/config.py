"""Application settings, loaded from environment variables / .env.

See:
- ADR-0002 (FastAPI + PostgreSQL + SQLAlchemy 2.0 + Alembic)
- ADR-0003 (JWT + argon2 + AIAgent API key auth strategy)
- Database Document §"Attachment" (ATTACHMENT_STORAGE is an app-config concern)
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central application configuration.

    Values are loaded from environment variables (and an optional `.env`
    file in the working directory) via pydantic-settings.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENV: Literal["dev", "test", "prod"] = "dev"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/testnexa"

    # JWT / auth (ADR-0003)
    JWT_SECRET: str = "change-me-in-production"
    # `float`, not `int`: `timedelta(minutes=...)` accepts either, and this
    # lets an isolated test env override it to a sub-minute value (e.g.
    # `JWT_ACCESS_TTL_MINUTES=0.05` == 3s) to exercise a real access-token
    # expiry -> refresh -> retry chain in an E2E test (fix round 2, Finding
    # 3) without waiting out the real 15-minute default. Production default
    # (15) is unaffected either way.
    JWT_ACCESS_TTL_MINUTES: float = 15
    JWT_REFRESH_TTL_DAYS: int = 30

    # RBAC-2 / ADR-0017: email delivery is descoped this pass — the invite
    # link is returned directly in `POST /orgs/{org_id}/members/invite`'s
    # response body for the inviting admin to copy/share out-of-band. This
    # is the base URL that link is built against; default matches
    # ADR-0010's single external nginx port (54593) for local dev.
    APP_BASE_URL: str = "http://localhost:54593"

    # Attachment storage (Database Document §governance.py Attachment)
    ATTACHMENT_STORAGE: Literal["local", "s3"] = "local"
    ATTACHMENT_S3_BUCKET: str | None = None
    ATTACHMENT_S3_ENDPOINT: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


settings = get_settings()
