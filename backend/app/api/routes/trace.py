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
    FieldMeta,
    NoSchema,
    ScopeSelectorOption,
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

# ADR-0053 note, shared by all four configs below. `create_schema=None` +
# `update_schema=NoSchema` means there are no writable fields at all, so
# `derive_entity_schema` marks every one of them `readOnly` and none of them
# `required` — which is exactly what each `entityConfigs/*-link.ts` already
# declared by hand, so nothing diverges here (unlike `_TEST_CONDITION_CONFIG`,
# whose stale `.ts` still claimed `required: true` after its generic create was
# removed). `field_order` is likewise unnecessary: every field is summary-only,
# so the derived order IS the `*LinkSummary` declaration order, which already
# matches each hand-written config's own `fields[]` order. Only the two FK
# fields per entity need a `FieldMeta` — their `ref_entity`/`label_field` have
# no Python-type correlate, and their labels are the hand-picked "Requirement"/
# "Test case" rather than `_label_for`'s "Requirement id"/"Test case id".
# `created_at` needs no entry: "Created at" is exactly what `_label_for`
# produces, and its `datetime` annotation deriving as `date` (vs the `.ts`'s
# `string`) is the comparator's own accepted divergence.

_REQUIREMENT_TEST_CASE_LINK_CONFIG = CrudEntityConfig(
    model=RequirementTestCaseLink,
    resource="requirement_test_case_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=RequirementTestCaseLinkSummary,
    scope_field="requirement_id",
    resolve_org_id=chain_resolver([(Requirement, "requirement_id")]),
    methods=_READ_ONLY_METHODS,
    # ADR-0053
    label="Requirement -> test case links",
    scope_selector=ScopeSelectorOption(ref_entity="requirement", param_name="requirement_id"),
    field_meta={
        "requirement_id": FieldMeta(ref_entity="requirement", label_field="description", label="Requirement"),
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case"),
    },
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
    # ADR-0053
    label="Requirement -> test condition links",
    scope_selector=ScopeSelectorOption(ref_entity="requirement", param_name="requirement_id"),
    field_meta={
        "requirement_id": FieldMeta(ref_entity="requirement", label_field="description", label="Requirement"),
        "test_condition_id": FieldMeta(ref_entity="test-condition", label_field="description", label="Test condition"),
    },
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
    # ADR-0053
    label="Test condition -> test case links",
    scope_selector=ScopeSelectorOption(ref_entity="test-condition", param_name="test_condition_id"),
    field_meta={
        "test_condition_id": FieldMeta(ref_entity="test-condition", label_field="description", label="Test condition"),
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case"),
    },
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
    # ADR-0053. `test-case`'s own scope-selector search can't resolve against a
    # live backend today (no `TestCase` list route exists) — see
    # `entityConfigs/test-case.ts`'s docstring; carried over verbatim rather
    # than "fixed" here, since that's a route-surface gap, not a schema one.
    label="Test case -> defect links",
    scope_selector=ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id"),
    field_meta={
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case"),
        "defect_id": FieldMeta(ref_entity="defect", label_field="external_ref", label="Defect"),
    },
)

router.include_router(make_crud_router(_REQUIREMENT_TEST_CASE_LINK_CONFIG))
router.include_router(make_crud_router(_REQUIREMENT_TEST_CONDITION_LINK_CONFIG))
router.include_router(make_crud_router(_TEST_CONDITION_TEST_CASE_LINK_CONFIG))
router.include_router(make_crud_router(_TEST_CASE_DEFECT_LINK_CONFIG))

__all__ = ["router"]
