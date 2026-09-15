"""ADR-0025: generic-CRUD factory routes for the 4 traceability link tables.

New module, `app/models/trace.py`'s own cluster naming. Every entity here is
`list`/`get` only (`READ_ONLY_RESOURCES`, `app/db/rbac_seed_catalog.py`) — no
`create`/`update`/`delete` route exists for any of them, generic or bespoke
(ADR-0005): a row is only ever created as a side effect of a bespoke §4
route (e.g. `POST /requirements/{id}/test-cases` also inserts a
`RequirementTestCaseLink`).

**ADR-0072 Amendment 1 (2026-09-15): every link here is scoped — and therefore
listable, and therefore tabbed — from BOTH ends.** Each `scope_field` is a
branching 2-tuple naming both of the link's own FK columns, the shape
`RiskItem` has always used, so `derive_entity_relations` (ADR-0071) emits one
relation per direction instead of one for the scope side only. ADR-0072
Decision §3 deliberately deferred this ("widening all six later remains open")
because doing it for two of six junctions would have made the rule incoherent;
all six move together here, so that objection is spent. Nothing about the
read-only posture changes: still no `create`/`update`/`delete`, generic or
bespoke.

Every resolver here composes `chain_resolver`/`resolve_via_test_case`/
`branching_resolver` directly, no new resolver logic. A branching `scope_field`
**requires** a branching resolver: `_resolve_scope_for_write` hands
`resolve_org_id` a stand-in carrying only the arm the caller actually supplied,
so a single-arm walk would 404 every request scoped by the other end. In each
pair below, the arm that was this config's sole `scope_field` before the
widening is declared **first**, which keeps the item-route walk (where a real
row carries both FKs) byte-identical to its pre-widening behaviour:

- `RequirementTestCaseLink`: `requirement_id` -> `Requirement.project_id` ->
  `Project.org_id`; else `test_case_id` -> `resolve_via_test_case`.
- `RequirementTestConditionLink`: `requirement_id` as above; else
  `test_condition_id` -> `TestCondition` -> `Requirement` -> `Project.org_id`.
- `TestConditionTestCaseLink`: `test_condition_id` two hops as above; else
  `test_case_id` -> `resolve_via_test_case`.
- `TestCaseDefectLink`: `test_case_id` -> `resolve_via_test_case` (it already
  accepts any row exposing a `test_case_id` attribute — this link table's own
  `test_case_id` column fits with no adapter needed); else `defect_id` ->
  `Defect` -> `TestExecution` -> `TestCycle` -> `TestPlan.project_id` ->
  `Project.org_id`, which is `_DEFECT_CONFIG`'s own chain with one hop
  prepended, composed rather than re-derived.
"""

from fastapi import APIRouter

from app.api.crud_factory import (
    CrudEntityConfig,
    FieldMeta,
    NoSchema,
    ScopeSelectorOption,
    branching_resolver,
    chain_resolver,
    make_crud_router,
    resolve_via_test_case,
)
from app.models.assets import Requirement, TestCondition
from app.models.execution import Defect, TestExecution
from app.models.planning import TestCycle, TestPlan
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
    # ADR-0072 Amendment 1: both ends, so `Requirement` gets a "Test cases
    # (linked)" tab and `TestCase` the reverse "Requirements (linked)" one.
    scope_field=("requirement_id", "test_case_id"),
    resolve_org_id=branching_resolver(
        [
            ("requirement_id", chain_resolver([(Requirement, "requirement_id")])),
            ("test_case_id", resolve_via_test_case),
        ]
    ),
    methods=_READ_ONLY_METHODS,
    # ADR-0053
    label="Requirement -> test case links",
    # ADR-0072 Amendment 1: one option per scope arm, `RiskItem`'s own shape —
    # without the second, the generic admin list page could only ever scope by
    # the arm that happened to be listed, even though the route serves both.
    scope_selector=(
        ScopeSelectorOption(ref_entity="requirement", param_name="requirement_id", label="By requirement"),
        ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id", label="By test case"),
    ),
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
    # ADR-0072 Amendment 1, both ends. The reverse arm gives `TestCondition` a
    # "Requirements (linked)" tab beside the "Test cases (linked)" one it
    # already had from `TestConditionTestCaseLink`.
    scope_field=("requirement_id", "test_condition_id"),
    resolve_org_id=branching_resolver(
        [
            ("requirement_id", chain_resolver([(Requirement, "requirement_id")])),
            (
                "test_condition_id",
                chain_resolver([(TestCondition, "test_condition_id"), (Requirement, "requirement_id")]),
            ),
        ]
    ),
    methods=_READ_ONLY_METHODS,
    # ADR-0053
    label="Requirement -> test condition links",
    scope_selector=(
        ScopeSelectorOption(ref_entity="requirement", param_name="requirement_id", label="By requirement"),
        ScopeSelectorOption(
            ref_entity="test-condition", param_name="test_condition_id", label="By test condition"
        ),
    ),
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
    # ADR-0072 Amendment 1, both ends.
    scope_field=("test_condition_id", "test_case_id"),
    resolve_org_id=branching_resolver(
        [
            (
                "test_condition_id",
                chain_resolver([(TestCondition, "test_condition_id"), (Requirement, "requirement_id")]),
            ),
            ("test_case_id", resolve_via_test_case),
        ]
    ),
    methods=_READ_ONLY_METHODS,
    # ADR-0053
    label="Test condition -> test case links",
    scope_selector=(
        ScopeSelectorOption(
            ref_entity="test-condition", param_name="test_condition_id", label="By test condition"
        ),
        ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id", label="By test case"),
    ),
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
    # ADR-0072 Amendment 1, both ends. The reverse arm is what finally gives
    # `Defect` a relationship tab at all — its detail page rendered no strip
    # whatsoever before, the same symptom ADR-0072 fixed for `TestSuite`.
    scope_field=("test_case_id", "defect_id"),
    resolve_org_id=branching_resolver(
        [
            ("test_case_id", resolve_via_test_case),
            (
                "defect_id",
                chain_resolver(
                    [
                        (Defect, "defect_id"),
                        (TestExecution, "test_execution_id"),
                        (TestCycle, "test_cycle_id"),
                        (TestPlan, "test_plan_id"),
                    ]
                ),
            ),
        ]
    ),
    methods=_READ_ONLY_METHODS,
    # ADR-0053. `test-case`'s own scope-selector search can't resolve against a
    # live backend today (no `TestCase` list route exists) — see
    # `entityConfigs/test-case.ts`'s docstring; carried over verbatim rather
    # than "fixed" here, since that's a route-surface gap, not a schema one.
    label="Test case -> defect links",
    scope_selector=(
        ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id", label="By test case"),
        ScopeSelectorOption(ref_entity="defect", param_name="defect_id", label="By defect"),
    ),
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
