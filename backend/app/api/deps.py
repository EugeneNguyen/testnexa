"""Shared FastAPI dependencies for API routes.

`get_db` wraps the session factory in `app/db/session.py` for use as a route
dependency (`Depends(get_db)`). Full actor-resolution/permission-check
dependencies live in `app/core/rbac.py` (stubbed, out of scope for AUTH-1 —
login itself is a public route with no bearer-token dependency).
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db as _get_db


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an `AsyncSession`, closed after the request.

    Thin re-export of `app.db.session.get_db` so route modules depend on
    `app.api.deps` (the conventional dependency-import location) without
    duplicating the session-factory wiring.
    """
    async for session in _get_db():
        yield session
