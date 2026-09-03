"""Pydantic v2 schemas for the AUTH-1 login route and AUTH-2 session routes.

Source: API Document §2 (`POST /auth/login`, `POST /auth/refresh`,
`GET /auth/me` request/response contracts), ADR-0013 (refresh rotation policy).
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    """Body of `POST /auth/login`."""

    email: EmailStr
    password: str


class OrgSummary(BaseModel):
    """One entry in `LoginResponse.orgs` — a single `active`-membership Organization."""

    id: UUID
    name: str
    slug: str


class LoginResponse(BaseModel):
    """Response of `POST /auth/login`.

    The refresh token is never included here — it is set as an httpOnly
    cookie on the response (API Document §2, ADR-0003).
    """

    access_token: str
    org_context: Literal["auto", "picker"]
    orgs: list[OrgSummary]


class RefreshResponse(BaseModel):
    """Response of `POST /auth/refresh` (API Document §2, ADR-0013).

    Deliberately does NOT include `org_context`/`orgs` — the frontend already
    holds those from login; refresh's only job is renewing the access token.
    The rotated raw refresh token is never included here either — it is set
    as a new httpOnly cookie on the response, same as login.
    """

    access_token: str


class MeResponse(BaseModel):
    """Response of `GET /auth/me` (API Document §2, ADR-0013, ADR-0014).

    Identity-only — no resolved permission codes yet (deferred until an RBAC
    story exists to resolve them).

    AUTH-4 extends this to a second actor shape: `get_current_actor` can now
    resolve to either a `User` or an `AIAgent` (ADR-0014), and `GET /auth/me`
    branches on `actor_type` to serialize the right one. Rather than a
    `Union` of two separate response models, this is kept as a single model
    with `email`/`agent_name` both optional (Pydantic-v2-idiomatic, simpler
    for the route/OpenAPI schema than a discriminated union for two fields):
    - `actor_type == "user"`: `email` set, `agent_name` `None`.
    - `actor_type == "ai_agent"`: `agent_name` set, `email` `None` — an
      `AIAgent` has no email address at all (Database Document §3.4).
    """

    actor_id: str
    actor_type: str
    email: str | None = None
    agent_name: str | None = None
