"""Health check route.

This is the only API route implemented in the scaffold — all business/feature
routes are deferred to a later task.
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness check. Returns 200 with a static status payload."""
    return {"status": "ok"}
