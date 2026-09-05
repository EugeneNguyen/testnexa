"""API-1: generic-CRUD factory routes for the taxonomy cluster (ADR-0022).

`TestDesignTechnique`/`TestLevel`/`TestType` are global catalogs (no tenant
at all) — `scope_field=None`, `is_global_catalog=True`, `resolve_org_id` a
constant-`None` function; list/create/item routes all gate via
`has_permission_in_any_org` instead of the `OrgMembership` 404-vs-403
boundary. Unlike `Permission` (read-only, `app/api/routes/rbac_routes.py`),
these three get full CRUD — they're in `CRUD_RESOURCES`
(`app/db/rbac_seed_catalog.py`), not `READ_ONLY_RESOURCES`.
"""

from fastapi import APIRouter

from app.api.crud_factory import CrudEntityConfig, make_crud_router, resolve_global_org_id
from app.models.taxonomy import TestDesignTechnique, TestLevel, TestType
from app.schemas.taxonomy import (
    CreateTestDesignTechniqueRequest,
    CreateTestLevelRequest,
    CreateTestTypeRequest,
    TestDesignTechniqueSummary,
    TestLevelSummary,
    TestTypeSummary,
    UpdateTestDesignTechniqueRequest,
    UpdateTestLevelRequest,
    UpdateTestTypeRequest,
)

router = APIRouter()

_TEST_DESIGN_TECHNIQUE_CONFIG = CrudEntityConfig(
    model=TestDesignTechnique,
    resource="test_design_technique",
    create_schema=CreateTestDesignTechniqueRequest,
    update_schema=UpdateTestDesignTechniqueRequest,
    summary_schema=TestDesignTechniqueSummary,
    scope_field=None,
    resolve_org_id=resolve_global_org_id,
    is_global_catalog=True,
)

_TEST_LEVEL_CONFIG = CrudEntityConfig(
    model=TestLevel,
    resource="test_level",
    create_schema=CreateTestLevelRequest,
    update_schema=UpdateTestLevelRequest,
    summary_schema=TestLevelSummary,
    scope_field=None,
    resolve_org_id=resolve_global_org_id,
    is_global_catalog=True,
)

_TEST_TYPE_CONFIG = CrudEntityConfig(
    model=TestType,
    resource="test_type",
    create_schema=CreateTestTypeRequest,
    update_schema=UpdateTestTypeRequest,
    summary_schema=TestTypeSummary,
    scope_field=None,
    resolve_org_id=resolve_global_org_id,
    is_global_catalog=True,
)

router.include_router(make_crud_router(_TEST_DESIGN_TECHNIQUE_CONFIG))
router.include_router(make_crud_router(_TEST_LEVEL_CONFIG))
router.include_router(make_crud_router(_TEST_TYPE_CONFIG))

__all__ = ["router"]
