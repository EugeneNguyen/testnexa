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
    """Response of `GET /auth/me` (API Document §2, ADR-0013).

    Identity-only for AUTH-2 — no resolved permission codes yet (deferred
    until an RBAC story exists to resolve them).
    """

    actor_id: str
    email: str
    actor_type: str
