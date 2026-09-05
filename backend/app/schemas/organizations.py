"""Pydantic v2 schemas for the RBAC-1 `POST /orgs` route and the API-1
generic-CRUD factory's `Organization` `GET`/`PATCH`/`DELETE /organizations/{id}`
routes (ADR-0022).

Source: API Document §2 (`POST /orgs` contract), §3 (generic CRUD routes),
ADR-0016 (organization bootstrap & creation flow).
"""

from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.auth import OrgSummary

# Same slug pattern `SignupRequest.org_slug` validates (`app/schemas/auth.py`)
# — duplicated as a literal rather than imported to avoid the two schema
# modules importing each other in a cycle (`OrgSummary` is imported *from*
# `app/schemas/auth.py` below, so the reverse import would be circular).
_SLUG_PATTERN = r"^[a-z0-9-]+$"


class CreateOrgRequest(BaseModel):
    """Body of `POST /orgs` — an existing authenticated actor minting a further Organization."""

    name: str
    slug: str = Field(pattern=_SLUG_PATTERN)


class UpdateOrganizationRequest(BaseModel):
    """Body of `PATCH /organizations/{id}` (ADR-0022) — partial update,
    `exclude_unset` semantics. `slug` is not reassignable through this route
    (no ADR/story asks for renaming an org's slug post-creation).
    """

    name: str | None = None
    default_standards_profile: str | None = None


class OrganizationDetail(BaseModel):
    """Response shape for `GET`/`PATCH /organizations/{id}` (ADR-0022).

    A separate schema from `OrgSummary` (`app/schemas/auth.py`) — that one is
    deliberately lightweight (`id`/`name`/`slug` only, for `LoginResponse.orgs`/
    `POST /orgs`'s response); this one additionally exposes
    `default_standards_profile`, needed for the factory's `GET`/`PATCH` item
    routes but not the lighter-weight login/creation responses.
    """

    id: UUID
    name: str
    slug: str
    default_standards_profile: str | None = None


__all__ = ["CreateOrgRequest", "OrgSummary", "OrganizationDetail", "UpdateOrganizationRequest"]
