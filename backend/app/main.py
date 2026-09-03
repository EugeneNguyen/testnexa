"""FastAPI application entrypoint.

AUTH-1 adds the first real feature route (`POST /api/v1/auth/login`)
alongside the scaffold's health check. Remaining feature/business routes and
full RBAC enforcement are deferred to later tasks.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, health

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

app.include_router(health.router)
# API design doc §1: base path `/api/v1`. nginx (nginx.dev.conf) proxies
# `/api/*` straight through to the backend, so the router itself must be
# mounted under this prefix (unlike the unprefixed health route).
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
