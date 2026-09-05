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

ADMIN-2/ADR-0022 adds a second global handler, `validation_exception_handler`,
for the same reason but a different FastAPI-owned error path:
`RequestValidationError` (raised by FastAPI's own request-body/query-param
parsing, including a Pydantic `model_validator` failure inside a body
schema) also bypasses every route's own `_error()`/`JSONResponse` pattern —
without this handler it would surface FastAPI's default nested
`{"detail": [...]}` shape instead of this API's flat
`{"code","message","field_errors"}` contract.
"""

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from app.api.routes import (
    agents,
    assets,
    auth,
    execution,
    governance,
    health,
    org_memberships,
    organizations,
    planning,
    projects,
    rbac_routes,
    releases,
    role_assignments,
    roles,
    taxonomy,
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


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Flatten FastAPI/Pydantic's default request-validation shape to the API
    Document §1/NFR-8 `{"code","message","field_errors"}` shape.

    Added by API-1/ADR-0021: the generic CRUD factory's create/update body
    schemas are the first place in this codebase a request-body validation
    failure needs to render in this API's own documented error shape on the
    wire rather than FastAPI's default `{"detail": [{"loc": [...], "msg":
    ...}]}` — without this handler, ANY schema-level validation failure
    (missing required field, malformed `UUID`, bad enum value, ...) across
    every route in this app, not just the new ones, would render in that
    default shape instead. `error["loc"]` is typically
    `("body"|"query"|"path", "<field_name>")` — the last element (if there is
    more than one) is used as the `field_errors` key; a whole-body error with
    no specific field (`loc == ("body",)`) falls back to `"__root__"`.
    """
    field_errors: dict[str, list[str]] = {}
    for error in exc.errors():
        loc = error.get("loc", ())
        field = str(loc[-1]) if len(loc) > 1 else "__root__"
        field_errors.setdefault(field, []).append(error.get("msg", "Invalid value."))

    return JSONResponse(
        status_code=422,
        content={"code": "validation_error", "message": "Request failed validation.", "field_errors": field_errors},
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
# ADMIN-2/ADR-0022: generic CRUD router factory, applied per cluster. Registered
# after RBAC-3's bespoke role-assignment/role routes above — rbac_routes.py's
# own `RoleAssignment`/`Role` configs are deliberately narrowed (no `create`/
# `list` for `RoleAssignment`, no path overlap for `Role`) to defer to those,
# not duplicate them (see rbac_routes.py's module docstring).
app.include_router(assets.router, prefix="/api/v1", tags=["assets"])
app.include_router(planning.router, prefix="/api/v1", tags=["planning"])
app.include_router(taxonomy.router, prefix="/api/v1", tags=["taxonomy"])
app.include_router(governance.router, prefix="/api/v1", tags=["governance"])
app.include_router(rbac_routes.router, prefix="/api/v1", tags=["rbac"])
app.include_router(execution.router, prefix="/api/v1", tags=["execution"])
