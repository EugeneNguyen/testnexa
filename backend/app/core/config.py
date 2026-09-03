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
    JWT_ACCESS_TTL_MINUTES: int = 15
    JWT_REFRESH_TTL_DAYS: int = 30

    # Attachment storage (Database Document §governance.py Attachment)
    ATTACHMENT_STORAGE: Literal["local", "s3"] = "local"
    ATTACHMENT_S3_BUCKET: str | None = None
    ATTACHMENT_S3_ENDPOINT: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


settings = get_settings()
