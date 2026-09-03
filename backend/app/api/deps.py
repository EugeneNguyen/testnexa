"""Shared FastAPI dependencies for API routes.

`get_db` wraps the session factory in `app/db/session.py` for use as a route
dependency (`Depends(get_db)`). `get_current_actor` (AUTH-2, Task 1)
re-exports the actor-resolution dependency implemented in `app/core/rbac.py`
so route modules depend on `app.api.deps` uniformly. The remaining
permission-check dependencies (`require_permission`/`has_permission`/
`require_human_actor`) stay stubbed in `app/core/rbac.py` — not re-exported
here until they're implemented.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import get_current_actor as get_current_actor  # noqa: PLC0414
from app.db.session import get_db as _get_db


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an `AsyncSession`, closed after the request.

    Thin re-export of `app.db.session.get_db` so route modules depend on
    `app.api.deps` (the conventional dependency-import location) without
    duplicating the session-factory wiring.
    """
    async for session in _get_db():
        yield session
