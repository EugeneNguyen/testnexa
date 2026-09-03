"""FastAPI application entrypoint.

Codebase skeleton only — the single mounted route is the health check.
Feature/business routes and auth/RBAC enforcement are deferred to a later task.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import health

app = FastAPI(title="TestNexa API", version="0.1.0")

# Permissive CORS for dev only — tighten before any production deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
