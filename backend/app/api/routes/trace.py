"""ADR-0025: generic-CRUD factory routes for the 4 traceability link tables.

New module, `app/models/trace.py`'s own cluster naming. Every entity here is
`list`/`get` only (`READ_ONLY_RESOURCES`, `app/db/rbac_seed_catalog.py`) — no
`create`/`update`/`delete` route exists for any of them, generic or bespoke
(ADR-0005): a row is only ever created as a side effect of a bespoke §4
route (e.g. `POST /requirements/{id}/test-cases` also inserts a
`RequirementTestCaseLink`).

Every resolver here composes `chain_resolver`/`resolve_via_test_case`
directly, no new resolver logic:

- `RequirementTestCaseLink`/`RequirementTestConditionLink`: one hop to
  `Requirement`, then its own `project_id` -> `Project.org_id`.
- `TestConditionTestCaseLink`: two hops, `TestCondition` -> `Requirement` ->
  `Project.org_id`.
- `TestCaseDefectLink`: reuses `resolve_via_test_case` directly (it already
  accepts any row exposing a `test_case_id` attribute — this link table's
  own `test_case_id` column fits with no adapter needed).
"""

from fastapi import APIRouter

from app.api.crud_factory import (
    CrudEntityConfig,
    NoSchema,
    chain_resolver,
    make_crud_router,
    resolve_via_test_case,
)
from app.models.assets import Requirement, TestCondition
from app.models.trace import (
    RequirementTestCaseLink,
    RequirementTestConditionLink,
    TestCaseDefectLink,
    TestConditionTestCaseLink,
)
from app.schemas.trace import (
    RequirementTestCaseLinkSummary,
    RequirementTestConditionLinkSummary,
    TestCaseDefectLinkSummary,
    TestConditionTestCaseLinkSummary,
)

router = APIRouter()

_READ_ONLY_METHODS = frozenset({"list", "get"})

_REQUIREMENT_TEST_CASE_LINK_CONFIG = CrudEntityConfig(
    model=RequirementTestCaseLink,
    resource="requirement_test_case_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=RequirementTestCaseLinkSummary,
    scope_field="requirement_id",
    resolve_org_id=chain_resolver([(Requirement, "requirement_id")]),
    methods=_READ_ONLY_METHODS,
)

_REQUIREMENT_TEST_CONDITION_LINK_CONFIG = CrudEntityConfig(
    model=RequirementTestConditionLink,
    resource="requirement_test_condition_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=RequirementTestConditionLinkSummary,
    scope_field="requirement_id",
    resolve_org_id=chain_resolver([(Requirement, "requirement_id")]),
    methods=_READ_ONLY_METHODS,
)

_TEST_CONDITION_TEST_CASE_LINK_CONFIG = CrudEntityConfig(
    model=TestConditionTestCaseLink,
    resource="test_condition_test_case_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=TestConditionTestCaseLinkSummary,
    scope_field="test_condition_id",
    resolve_org_id=chain_resolver([(TestCondition, "test_condition_id"), (Requirement, "requirement_id")]),
    methods=_READ_ONLY_METHODS,
)

_TEST_CASE_DEFECT_LINK_CONFIG = CrudEntityConfig(
    model=TestCaseDefectLink,
    resource="test_case_defect_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=TestCaseDefectLinkSummary,
    scope_field="test_case_id",
    resolve_org_id=resolve_via_test_case,
    methods=_READ_ONLY_METHODS,
)

router.include_router(make_crud_router(_REQUIREMENT_TEST_CASE_LINK_CONFIG))
router.include_router(make_crud_router(_REQUIREMENT_TEST_CONDITION_LINK_CONFIG))
router.include_router(make_crud_router(_TEST_CONDITION_TEST_CASE_LINK_CONFIG))
router.include_router(make_crud_router(_TEST_CASE_DEFECT_LINK_CONFIG))

__all__ = ["router"]
