"""Pydantic v2 schemas for the AUTH-1 login route.

Source: API Document §2 (`POST /auth/login` request/response contract).
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
