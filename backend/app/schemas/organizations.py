"""Pydantic v2 schemas for the RBAC-1 `POST /orgs` route.

Source: API Document §2 (`POST /orgs` contract), ADR-0016 (organization
bootstrap & creation flow).
"""

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


__all__ = ["CreateOrgRequest", "OrgSummary"]
