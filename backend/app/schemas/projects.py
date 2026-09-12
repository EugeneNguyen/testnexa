"""Pydantic v2 schemas for the PROJ-1 `Project` routes.

Source: API Document §3 (`POST /orgs/{org_id}/projects`, `GET`/`PATCH
/projects/{id}` contracts), ADR-0017 (project creation flow —
`standards_profile` inheritance, bespoke create route).
"""

from uuid import UUID

from pydantic import BaseModel


class CreateProjectRequest(BaseModel):
    """Body of `POST /orgs/{org_id}/projects`.

    `standards_profile` omitted OR explicit `null` triggers
    `Organization.default_standards_profile` inheritance (ADR-0017 Q3,
    amended [ADR-0059](../../../docs/adr/0059-project-generic-admin-create.md)):
    the route checks `payload.standards_profile is None`, not
    `model_fields_set` — the original omitted-vs-null distinction was
    collapsed because `EntityForm` (the generic admin surface, ADR-0025)
    cannot express "omit this key," only "send it as `null`." A non-`null`
    value always wins regardless of source.
    """

    name: str
    standards_profile: str | None = None


class UpdateProjectRequest(BaseModel):
    """Body of `PATCH /projects/{id}` — partial update, `exclude_unset` semantics.

    Every field is optional so the route can apply only what the caller
    actually sent: an omitted field leaves the current value untouched, an
    explicit `null` for `standards_profile` clears it. The route distinguishes
    "omitted" from "explicit `null`" via `model_fields_set`/
    `.model_dump(exclude_unset=True)`, not any schema-level mechanism — this
    model's `standards_profile: str | None = None` default looks identical to
    `CreateProjectRequest`'s but is read differently by the route.
    """

    name: str | None = None
    standards_profile: str | None = None


class ProjectSummary(BaseModel):
    """Response shape for `POST /orgs/{org_id}/projects`, `GET`/`PATCH /projects/{id}`."""

    id: UUID
    org_id: UUID
    name: str
    standards_profile: str | None = None


__all__ = ["CreateProjectRequest", "ProjectSummary", "UpdateProjectRequest"]
