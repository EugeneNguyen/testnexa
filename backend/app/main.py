"""FastAPI application entrypoint.

AUTH-1 adds the first real feature route (`POST /api/v1/auth/login`)
alongside the scaffold's health check. AUTH-4 adds the agent-credential
routes (`app/api/routes/agents.py`). Remaining feature/business routes and
full RBAC enforcement (beyond AUTH-4's minimal `has_permission`/
`require_permission` plumbing, ADR-0015) are deferred to later tasks.

AUTH-2 (Task 1 fix round 1) adds a global `HTTPException` handler — see
`http_exception_handler` below for why this is needed even though `auth.py`'s
own module docstring documents avoiding `HTTPException` for exactly this
reason: that workaround (return a `JSONResponse` directly from the route) is
only available to route handlers, not to a FastAPI *dependency* like
`app.core.rbac.get_current_actor`, which has no response object of its own
to return — it can only raise. This handler is what makes the API Document
§1/NFR-8 flat error-body contract hold for `HTTPException`s raised from
dependencies (and any future route that raises `HTTPException` directly
instead of using `auth.py`'s `_error()`/`JSONResponse` pattern).
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from app.api.routes import (
    agents,
    auth,
    health,
    org_memberships,
    organizations,
    projects,
    releases,
    role_assignments,
    roles,
)

app = FastAPI(title="TestNexa API", version="0.1.0")

# Permissive CORS for dev only — tighten before any production deployment.
# Left unchanged by AUTH-1: the documented dev topology (nginx.dev.conf)
# serves frontend and backend same-origin, so the browser sends/receives the
# httpOnly refresh-token cookie without needing credentialed CORS at all;
# revisiting this for a genuinely cross-origin deployment is out of scope here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Flatten `HTTPException(detail={...})` to the API Document §1/NFR-8 shape.

    FastAPI's default `HTTPException` handler wraps whatever `detail` is
    passed one level deeper (`{"detail": {...}}` on the wire), which does not
    match this API's `{"code", "message", "field_errors"}` top-level error
    shape. `auth.py`'s login route sidesteps this by returning a
    `JSONResponse` directly rather than raising `HTTPException` at all (see
    that module's own docstring) — but that option only exists for a route
    handler, not for a dependency like `get_current_actor`, which can only
    raise. This handler makes the same flat contract hold for `HTTPException`
    raised anywhere else in the app (dependency or route), starting with
    `get_current_actor`'s 401.
    """
    if isinstance(exc.detail, dict) and {"code", "message"} <= exc.detail.keys():
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    # Fallback for a plain-string-detail HTTPException (shouldn't happen in
    # this codebase's own routes/dependencies, but FastAPI/Starlette
    # internals — e.g. 404 on an unmatched route — can still raise one).
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": "http_error", "message": str(exc.detail), "field_errors": None},
    )


app.include_router(health.router)
# API design doc §1: base path `/api/v1`. nginx (nginx.dev.conf) proxies
# `/api/*` straight through to the backend, so the router itself must be
# mounted under this prefix (unlike the unprefixed health route).
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
# AUTH-4/ADR-0015: agent credential issuance/revocation routes.
app.include_router(agents.router, prefix="/api/v1", tags=["agents"])
# RBAC-1/ADR-0016: authenticated org-creation route (`POST /orgs`) — the
# `POST /auth/signup` bootstrap sibling lives in `auth.router` above.
app.include_router(organizations.router, prefix="/api/v1", tags=["organizations"])
# RBAC-2/ADR-0017: invite/list/accept/suspend/reactivate/revoke org members.
app.include_router(org_memberships.router, prefix="/api/v1", tags=["org_memberships"])
# PROJ-1/ADR-0017: Project create/read/update routes.
app.include_router(projects.router, prefix="/api/v1", tags=["projects"])
# PROJ-2/ADR-0019: Release create/read/list + audit-query routes.
app.include_router(releases.router, prefix="/api/v1", tags=["releases"])
# RBAC-3/ADR-0021: RoleAssignment create/list routes.
app.include_router(role_assignments.router, prefix="/api/v1", tags=["role-assignments"])
# RBAC-3 UI slice: role dropdown data source for the role-assignment form.
app.include_router(roles.router, prefix="/api/v1", tags=["roles"])
