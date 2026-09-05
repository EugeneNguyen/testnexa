"""Pydantic v2 schemas for the API-1 generic-CRUD factory's taxonomy cluster.

Source: API Document §3 (generic CRUD routes, ADR-0022), Database Document
§3.10 (`TestDesignTechnique`/`TestLevel`/`TestType`). All three are global
catalogs (`resolve_org_id` constant `None`, `is_global_catalog=True`,
gated by `has_permission_in_any_org`, never the `OrgMembership` 404-vs-403
boundary) but still get full CRUD — unlike `Permission` (read-only, no
create/update/delete permission codes exist for it at all), these three are
in `CRUD_RESOURCES` (`app/db/rbac_seed_catalog.py`).
"""

from uuid import UUID

from pydantic import BaseModel

# --- TestDesignTechnique -----------------------------------------------------------------------


class CreateTestDesignTechniqueRequest(BaseModel):
    name: str
    istqb_chapter_ref: str | None = None


class UpdateTestDesignTechniqueRequest(BaseModel):
    name: str | None = None
    istqb_chapter_ref: str | None = None


class TestDesignTechniqueSummary(BaseModel):
    id: UUID
    name: str
    istqb_chapter_ref: str | None = None


class TestDesignTechniqueListResponse(BaseModel):
    items: list[TestDesignTechniqueSummary]
    total: int
    page: int
    page_size: int


# --- TestLevel -------------------------------------------------------------------------------


class CreateTestLevelRequest(BaseModel):
    name: str


class UpdateTestLevelRequest(BaseModel):
    name: str | None = None


class TestLevelSummary(BaseModel):
    id: UUID
    name: str


class TestLevelListResponse(BaseModel):
    items: list[TestLevelSummary]
    total: int
    page: int
    page_size: int


# --- TestType --------------------------------------------------------------------------------


class CreateTestTypeRequest(BaseModel):
    name: str


class UpdateTestTypeRequest(BaseModel):
    name: str | None = None


class TestTypeSummary(BaseModel):
    id: UUID
    name: str


class TestTypeListResponse(BaseModel):
    items: list[TestTypeSummary]
    total: int
    page: int
    page_size: int


__all__ = [
    "CreateTestDesignTechniqueRequest",
    "CreateTestLevelRequest",
    "CreateTestTypeRequest",
    "TestDesignTechniqueListResponse",
    "TestDesignTechniqueSummary",
    "TestLevelListResponse",
    "TestLevelSummary",
    "TestTypeListResponse",
    "TestTypeSummary",
    "UpdateTestDesignTechniqueRequest",
    "UpdateTestLevelRequest",
    "UpdateTestTypeRequest",
]
