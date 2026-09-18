"""ADR-0025: generic-CRUD factory routes for the 4 traceability link tables.

New module, `app/models/trace.py`'s own cluster naming. Every entity here is
`list`/`get` through the **factory** (`READ_ONLY_RESOURCES`,
`app/db/rbac_seed_catalog.py`) — no generic `create`/`update`/`delete` route
exists for any of them (ADR-0005).

**[ADR-0076](../../../../docs/adr/0076-relationship-tab-write-actions.md)
(2026-09-15): each of the four now has one bespoke `POST` that creates a link
row directly**, alongside the pre-existing side-effect creates (e.g.
`POST /requirements/{id}/test-cases` still inserts a `RequirementTestCaseLink`
as part of creating the case). The generic factory surface is unchanged —
`methods` stays `{"list","get"}`, `create_schema` stays `None`, and a link row
still cannot be `PATCH`ed or generically `POST`ed; links remain immutable
(delete-and-recreate), exactly as `app/models/trace.py`'s own docstring says.
The four routes exist because ADR-0074's relationship tabs could *list* a
traceability link but never create one, so linking two existing rows was
reachable only through whichever authoring route happened to create one side
as a side effect:

```
POST /requirements/{id}/test-case-links/{test_case_id}            requirement_test_case_link.create
POST /requirements/{id}/test-condition-links/{test_condition_id}  requirement_test_condition_link.create
POST /test-conditions/{id}/test-case-links/{test_case_id}         test_condition_test_case_link.create
POST /test-cases/{id}/defect-links/{defect_id}                    test_case_defect_link.create
```

All four are shaped verbatim on ADR-0030's `add_test_case_to_suite` and
ADR-0031's `include_suite_in_plan` — same 404-then-403 parent gate, same
same-org-`404`/cross-project-`422` split, same "let the unique constraint fire
and translate the `IntegrityError`" duplicate handling. Each is declared to the
generic surface through its config's `link_create` (ADR-0076's
`LinkCreateAction`), which is what lets a relationship tab invoke a route it
knows nothing else about.

**[ADR-0077](../../../../docs/adr/0077-relationship-tab-unlink-action.md)
(2026-09-16): each of the four gains the matching `DELETE`**, at the same URL
as its `POST`, closing the gap ADR-0076's own Consequences deferred by name
("Unlinking is not shipped... the tabs therefore grow monotonically today"):

```
DELETE /requirements/{id}/test-case-links/{test_case_id}            requirement_test_case_link.delete
DELETE /requirements/{id}/test-condition-links/{test_condition_id}  requirement_test_condition_link.delete
DELETE /test-conditions/{id}/test-case-links/{test_case_id}         test_condition_test_case_link.delete
DELETE /test-cases/{id}/defect-links/{defect_id}                    test_case_defect_link.delete
```

Shaped verbatim on REQ-4's `remove_test_case_from_suite` and PLAN-1's
`remove_suite_from_plan`, which are the two junction unlinks that have existed
all along: the **same** `_gate_parent` the `POST` above uses (so the NFR-1
existence boundary is literally one function for both verbs), then a lookup of
the link row by its own pair, then `204` — or `404` if that pair is not linked.
Deliberately **asymmetric with `POST`'s `409`**, exactly as ADR-0030 fixed for
its own pair: a `DELETE`'s "already true" case reads as "nothing to find here",
not as a conflict. And deliberately **not** idempotent-`204`, so a client that
unlinks a pair twice learns the second call did nothing.

There is no cross-project `422` on this side, and its absence is the point:
that check exists on `POST` to reject an *invalid new relationship*, and a link
row that already exists is by construction one the `POST` already accepted.
Re-deriving both sides' projects here could only ever reject a row the system
itself created — leaving a user unable to remove exactly the rows a past bug
let in.

Each is declared to the generic surface through its config's `link_delete`
(ADR-0077's `LinkDeleteAction`), the exact mirror of `link_create`. Links stay
**immutable**, not mutable: `methods` is still `{"list","get"}`, `create_schema`
still `None`, and a link row still cannot be `PATCH`ed or reached by the generic
factory's own `DELETE /{resource}/{id}`. ADR-0005's "delete-and-recreate" is
what these routes make *possible*, not something they contradict.

**Distinct from REQ-5's `POST /test-cases/{id}/link-requirement`**
(ADR-0069), which writes the same `RequirementTestCaseLink` table. That route
is a one-shot *retrofit* for a standalone case with no traceability at all — it
409s (`already_linked_to_requirement`) when the case already has **any**
Requirement link, deliberately enforcing at-most-one from the `TestCase` side.
`POST /requirements/{id}/test-case-links/{test_case_id}` is the table's real
many-to-many contract: it 409s only on the *pair* already existing, the same
rule `add_test_case_to_suite` applies to `TestSuiteTestCase`. Both are kept:
ADR-0076 does not re-gate or re-scope a shipped route, and the two answer
different questions (see ADR-0076's Consequences for why the asymmetry is
accepted rather than reconciled).

**ADR-0075 Amendment 1 (2026-09-15): every link here is scoped — and therefore
listable, and therefore tabbed — from BOTH ends.** Each `scope_field` is a
branching 2-tuple naming both of the link's own FK columns, the shape
`RiskItem` has always used, so `derive_entity_relations` (ADR-0074) emits one
relation per direction instead of one for the scope side only. ADR-0075
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

from typing import Any, Awaitable, Callable, Sequence
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import (
    CompoundCreateAction,
    CrudEntityConfig,
    FieldMeta,
    LinkCreateAction,
    LinkDeleteAction,
    NoSchema,
    ResolveOrgId,
    ScopeSelectorOption,
    _actor_membership_exists,
    branching_resolver,
    chain_resolver,
    make_crud_router,
    resolve_test_case_org_id,
    resolve_test_case_project_id,
    resolve_via_test_case,
)
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.db.base import Base
from app.models.actor import AIAgent, User
from app.models.assets import Requirement, TestCase, TestCondition
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
    # ADR-0075 Amendment 1: both ends, so `Requirement` gets a "Test cases
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
    # ADR-0076: the declarative handle on this module's own bespoke
    # `POST` below, so ADR-0074's relationship tab can create a link row
    # from either end of the junction. Unlike REQ-4's/PLAN-1's two older
    # junctions, these four routes are new in ADR-0076, so each gates on
    # its own new `requirement_test_case_link.create` code rather than on a
    # parent entity's `.update`.
    link_create=LinkCreateAction(
        path_template="/requirements/{requirement_id}/test-case-links/{test_case_id}",
        permission="requirement_test_case_link.create",
    ),
    # ADR-0077: the same handle for this module's own `DELETE` below. Same URL
    # as the `POST`, different verb and a *different permission code* — the
    # declaration is what makes both facts knowable to a client that hard-codes
    # neither.
    link_delete=LinkDeleteAction(
        path_template="/requirements/{requirement_id}/test-case-links/{test_case_id}",
        permission="requirement_test_case_link.delete",
    ),
    label="Requirement -> test case links",
    # ADR-0075 Amendment 1: one option per scope arm, `RiskItem`'s own shape —
    # without the second, the generic admin list page could only ever scope by
    # the arm that happened to be listed, even though the route serves both.
    scope_selector=(
        ScopeSelectorOption(
            ref_entity="requirement", param_name="requirement_id", label_field="description", label="By requirement", select=True
        ),
        ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id", label_field="title", label="By test case", select=True),
    ),
    field_meta={
        "requirement_id": FieldMeta(
            ref_entity="requirement", label_field="description", label="Requirement", select=True
        ),
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case", select=True),
    },
)

_REQUIREMENT_TEST_CONDITION_LINK_CONFIG = CrudEntityConfig(
    model=RequirementTestConditionLink,
    resource="requirement_test_condition_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=RequirementTestConditionLinkSummary,
    # ADR-0075 Amendment 1, both ends. The reverse arm gives `TestCondition` a
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
    # ADR-0076: the declarative handle on this module's own bespoke
    # `POST` below, so ADR-0074's relationship tab can create a link row
    # from either end of the junction. Unlike REQ-4's/PLAN-1's two older
    # junctions, these four routes are new in ADR-0076, so each gates on
    # its own new `requirement_test_condition_link.create` code rather than on a
    # parent entity's `.update`.
    link_create=LinkCreateAction(
        path_template="/requirements/{requirement_id}/test-condition-links/{test_condition_id}",
        permission="requirement_test_condition_link.create",
    ),
    # ADR-0077 — see the sibling config above.
    link_delete=LinkDeleteAction(
        path_template="/requirements/{requirement_id}/test-condition-links/{test_condition_id}",
        permission="requirement_test_condition_link.delete",
    ),
    # ADR-0078: the `Requirement` -> "Test conditions (linked)" direction. The
    # far entity (`TestCondition`) has no generic `create` — ADR-0028 removed
    # it precisely because a `TestCondition` cannot exist without a
    # `Requirement` (`requirement_id` is `NOT NULL`) *and* because its real
    # create must write this very link row in the same transaction.
    #
    # This is the cleanest of the three: REQ-3's atomic route is already
    # parented by exactly the record this tab is on, so the placeholder names
    # the tab's own scope field, no picker is needed, and the route writes this
    # junction's row itself — one request, and the tab is done.
    compound_creates=(
        CompoundCreateAction(
            far_field="test_condition_id",
            path_template="/requirements/{requirement_id}/test-conditions",
            permission="test_condition.create",
            # `create_test_condition_for_requirement` inserts the
            # `RequirementTestConditionLink` inside its own transaction — this
            # tab's row, not some other junction's. Following it with
            # `link_create` would 409 on the pair it just wrote.
            links_automatically=True,
        ),
    ),
    label="Requirement -> test condition links",
    scope_selector=(
        ScopeSelectorOption(
            ref_entity="requirement", param_name="requirement_id", label_field="description", label="By requirement", select=True
        ),
        ScopeSelectorOption(
            ref_entity="test-condition", param_name="test_condition_id", label_field="description", label="By test condition", select=True
        ),
    ),
    field_meta={
        "requirement_id": FieldMeta(
            ref_entity="requirement", label_field="description", label="Requirement", select=True
        ),
        "test_condition_id": FieldMeta(
            ref_entity="test-condition", label_field="description", label="Test condition", select=True
        ),
    },
)

_TEST_CONDITION_TEST_CASE_LINK_CONFIG = CrudEntityConfig(
    model=TestConditionTestCaseLink,
    resource="test_condition_test_case_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=TestConditionTestCaseLinkSummary,
    # ADR-0075 Amendment 1, both ends.
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
    # ADR-0076: the declarative handle on this module's own bespoke
    # `POST` below, so ADR-0074's relationship tab can create a link row
    # from either end of the junction. Unlike REQ-4's/PLAN-1's two older
    # junctions, these four routes are new in ADR-0076, so each gates on
    # its own new `test_condition_test_case_link.create` code rather than on a
    # parent entity's `.update`.
    link_create=LinkCreateAction(
        path_template="/test-conditions/{test_condition_id}/test-case-links/{test_case_id}",
        permission="test_condition_test_case_link.create",
    ),
    # ADR-0077 — see the sibling configs above.
    link_delete=LinkDeleteAction(
        path_template="/test-conditions/{test_condition_id}/test-case-links/{test_case_id}",
        permission="test_condition_test_case_link.delete",
    ),
    # ADR-0078: the `TestCase` -> "Test conditions (linked)" direction. Same far
    # entity as the sibling config above, same atomic route — and a materially
    # different shape, which is why the declaration is per-direction.
    #
    # Here the tab is on a `TestCase`, and REQ-3's route is parented by a
    # `Requirement` the tab has no way to know. `TestCondition.requirement_id`
    # is `NOT NULL`, so there is no "create it without one" to fall back to and
    # no honest way to guess: the user picks the requirement the new condition
    # belongs to, which is a real authoring decision, not a scoping detail.
    # That is the rigor path run in reverse — author the condition under its
    # requirement, then attach it to the case that covers it.
    #
    # The atomic route then writes the *requirement* link, not this one, so
    # this direction is genuinely two calls and `links_automatically` is False:
    # the client follows with this config's own `link_create` above, the
    # identical second request ADR-0076 Amendment 1 already makes.
    compound_creates=(
        CompoundCreateAction(
            far_field="test_condition_id",
            path_template="/requirements/{requirement_id}/test-conditions",
            permission="test_condition.create",
            links_automatically=False,
            parent_entity="requirement",
            parent_label="Requirement",
            # `description` is what `_REQUIREMENT_TEST_CONDITION_LINK_CONFIG`'s
            # own `requirement_id` FieldMeta labels a requirement with, reused
            # verbatim so the same row reads the same way in both places.
            parent_label_field="description",
            parent_select=True,
        ),
    ),
    label="Test condition -> test case links",
    scope_selector=(
        ScopeSelectorOption(
            ref_entity="test-condition", param_name="test_condition_id", label_field="description", label="By test condition", select=True
        ),
        ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id", label_field="title", label="By test case", select=True),
    ),
    field_meta={
        "test_condition_id": FieldMeta(
            ref_entity="test-condition", label_field="description", label="Test condition", select=True
        ),
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case", select=True),
    },
)

_TEST_CASE_DEFECT_LINK_CONFIG = CrudEntityConfig(
    model=TestCaseDefectLink,
    resource="test_case_defect_link",
    create_schema=None,
    update_schema=NoSchema,
    summary_schema=TestCaseDefectLinkSummary,
    # ADR-0075 Amendment 1, both ends. The reverse arm is what finally gives
    # `Defect` a relationship tab at all — its detail page rendered no strip
    # whatsoever before, the same symptom ADR-0075 fixed for `TestSuite`.
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
    # ADR-0076: the declarative handle on this module's own bespoke
    # `POST` below, so ADR-0074's relationship tab can create a link row
    # from either end of the junction. Unlike REQ-4's/PLAN-1's two older
    # junctions, these four routes are new in ADR-0076, so each gates on
    # its own new `test_case_defect_link.create` code rather than on a
    # parent entity's `.update`.
    link_create=LinkCreateAction(
        path_template="/test-cases/{test_case_id}/defect-links/{defect_id}",
        permission="test_case_defect_link.create",
    ),
    # ADR-0077 — see the sibling configs above. This is the one of the four
    # whose `.delete` code `tester` also holds (ADR-0077 Decision §3): it is the
    # exact undo of the one link `tester` may create.
    link_delete=LinkDeleteAction(
        path_template="/test-cases/{test_case_id}/defect-links/{defect_id}",
        permission="test_case_defect_link.delete",
    ),
    # ADR-0078: the `TestCase` -> "Defects (linked)" direction. `Defect` has no
    # generic `create` either, and for the same reason one level deeper:
    # `Defect.test_execution_id` is `NOT NULL`, and EXEC-3's
    # `POST /executions/{id}/defects` additionally `422`s unless that execution
    # actually failed.
    #
    # What makes this direction work rather than merely compile: that route
    # writes `TestCaseDefectLink(test_case_id=execution.test_case_id, ...)`
    # itself — so the link lands on *this* tab's test case precisely when the
    # chosen execution belongs to it. The picker is therefore scoped to this
    # test case's own executions (derived client-side: `TestExecution`'s scope
    # field, widened to a branching pair by this same ADR, includes the very
    # column this tab is scoped by), and filtered to the failed ones. Inside
    # that scope `links_automatically=True` is exact, not approximate.
    #
    # This also retires ADR-0076's own documented dead end for this direction —
    # "cannot be linked from that end today", behind `ScopeSelector`'s
    # cascading-picker gap — because the same widening gives "Link existing"
    # a scope it can actually fire with.
    compound_creates=(
        CompoundCreateAction(
            far_field="defect_id",
            path_template="/executions/{test_execution_id}/defects",
            permission="defect.create",
            links_automatically=True,
            parent_entity="test-execution",
            parent_label="Failed test execution",
            # NOT `_DEFECT_CONFIG`'s own `test_execution_id` label field
            # (`result`): this picker only ever offers failed executions, so
            # every option would read "fail". `executed_at` is the column that
            # actually distinguishes one run of this test case from another.
            parent_label_field="executed_at",
            # EXEC-3 AC1's literal precondition, enforced by the route with a
            # `422`. Offering a passed execution here would be offering a
            # guaranteed rejection.
            parent_filters=(("result", "fail"),),
            parent_select=True,
        ),
    ),
    label="Test case -> defect links",
    scope_selector=(
        ScopeSelectorOption(ref_entity="test-case", param_name="test_case_id", label_field="title", label="By test case", select=True),
        ScopeSelectorOption(ref_entity="defect", param_name="defect_id", label_field="display_name", label="By defect", select=True),
    ),
    field_meta={
        "test_case_id": FieldMeta(ref_entity="test-case", label_field="title", label="Test case", select=True),
        "defect_id": FieldMeta(ref_entity="defect", label_field="display_name", label="Defect", select=True),
    },
)

# --- ADR-0076: the four bespoke link-create routes ----------------------------------------------
#
# See this module's own docstring for the contract. Everything below is the
# ADR-0030/ADR-0031 membership-route shape with the entity names changed —
# deliberately so, since a fifth independently-reasoned variant of "gate the
# parent, then check the far side's tenant, then its project, then insert" is
# how the four end up disagreeing about which boundary returns which status.

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."

#: Every one of the four new routes 409s with this single code. The two older
#: junction routes have bespoke codes (`already_in_suite`,
#: `already_included_in_plan`) because each shipped alone, a story apart; these
#: four ship together as one uniform contract, so one code reads as one rule
#: rather than four coincidentally-identical ones. The human-readable `message`
#: still names the specific pair.
_ALREADY_LINKED_CODE = "link_already_exists"

ResolveProjectId = Callable[[AsyncSession, Any], Awaitable[UUID | None]]


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """API Document §1 error shape.

    A local copy, matching this codebase's established per-module convention
    (`test_suite_membership.py`/`test_plan_membership.py`/`releases.py`/
    `crud_factory.py` each keep their own) rather than a shared import.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


def _project_chain(hops: Sequence[tuple[type, str]]) -> ResolveProjectId:
    """`chain_resolver`'s project-side sibling: walk `hops`, then read `project_id`.

    The org-side walk (`chain_resolver` -> `resolve_terminal_org_id`) converts
    `project_id` -> `Project.org_id` and discards the `project_id`, so the
    cross-project `422` check every route below performs cannot reuse it — the
    same reason `resolve_test_case_project_id` exists beside
    `resolve_test_case_org_id` in `crud_factory`. Each chain declared below is
    that entity's own org chain minus its terminal `Project` hop, so the two
    walk the same path and can only disagree about the final column.
    """

    async def _resolve(db: AsyncSession, row: Any) -> UUID | None:
        current: Any = row
        for parent_model, fk_column in hops:
            fk_value = getattr(current, fk_column, None)
            if fk_value is None:
                return None
            current = await db.get(parent_model, fk_value)
            if current is None:
                return None
        return getattr(current, "project_id", None)

    return _resolve


# Applied to a **parent entity row itself**, not to a link row — each is the
# corresponding config arm above with its own leading `(Model, "<fk>")` hop
# removed, because the routes below already hold the fetched row.
_resolve_requirement_org_id: ResolveOrgId = chain_resolver([])
_resolve_test_condition_org_id: ResolveOrgId = chain_resolver([(Requirement, "requirement_id")])
_resolve_defect_org_id: ResolveOrgId = chain_resolver(
    [(TestExecution, "test_execution_id"), (TestCycle, "test_cycle_id"), (TestPlan, "test_plan_id")]
)

_resolve_requirement_project_id: ResolveProjectId = _project_chain([])
_resolve_test_condition_project_id: ResolveProjectId = _project_chain([(Requirement, "requirement_id")])
_resolve_defect_project_id: ResolveProjectId = _project_chain(
    [(TestExecution, "test_execution_id"), (TestCycle, "test_cycle_id"), (TestPlan, "test_plan_id")]
)


async def _gate_parent(
    db: AsyncSession,
    model: type[Base],
    row_id: UUID,
    resolve_org_id: ResolveOrgId,
    actor: User | AIAgent,
    permission: str,
    not_found_message: str,
) -> tuple[Any, UUID] | JSONResponse:
    """Shared 404-then-403 gate on the route's own path parent.

    Identical in shape to `test_suite_membership._load_suite_for_actor` /
    `test_plan_membership._load_plan_for_actor`, generalized over the model and
    resolver so all four routes share one copy — the boundary that decides
    NFR-1 existence-hiding must not be able to drift between them.

    One deliberate difference from those two: membership is checked with
    `_actor_membership_exists`, not the older `User`-only
    `_org_membership_exists`. `backend/CLAUDE.md` makes this the rule for any
    *new* resource-gating route — `OrgMembership.user_id` FKs `user.actor_id`,
    so an `AIAgent` caller has no row there at all and the older helper 404s
    every MCP-originated request regardless of its
    `acting_on_behalf_of_user_id`. The two older membership routes are left on
    the older helper rather than changed here; that is its own separate fix.
    """
    row = await db.get(model, row_id)
    if row is None:
        return _error(404, "not_found", not_found_message)

    org_id = await resolve_org_id(db, row)
    if org_id is None or not await _actor_membership_exists(db, org_id, actor):
        return _error(404, "not_found", not_found_message)

    if not await has_permission(actor, str(org_id), permission):
        return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    return row, org_id


async def _load_same_org(
    db: AsyncSession,
    model: type[Base],
    row_id: UUID,
    resolve_org_id: ResolveOrgId,
    org_id: UUID,
    not_found_message: str,
) -> Any | JSONResponse:
    """Fetch the far side and require it in the *same* org as the parent.

    A row in another org — or one whose tenant cannot be resolved at all — is
    indistinguishable from a nonexistent one at this boundary (NFR-1/ADR-0007),
    so it is `404`, never `403` and never the cross-project `422` below. This
    is the security boundary the four routes' own negative tests exercise.
    """
    row = await db.get(model, row_id)
    if row is None:
        return _error(404, "not_found", not_found_message)

    far_org_id = await resolve_org_id(db, row)
    if far_org_id is None or far_org_id != org_id:
        return _error(404, "not_found", not_found_message)

    return row


async def _insert_link(db: AsyncSession, link_row: Base, conflict_message: str, body: dict[str, str]) -> JSONResponse:
    """Insert one link row, translating the pair's unique constraint into `409`.

    Caught at the database rather than pre-checked with an existence query,
    matching `crud_factory.create_item`'s and both membership routes' posture.
    The constraint is on the **pair** (`uq_*_link`, `app/models/trace.py`), so
    linking the same row to a *second* partner is a normal `201`.
    """
    db.add(link_row)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(409, _ALREADY_LINKED_CODE, conflict_message)

    await db.commit()
    return JSONResponse(status_code=201, content=body)


async def _delete_link(
    db: AsyncSession,
    model: type[Base],
    first_column: Any,
    first_value: UUID,
    second_column: Any,
    second_value: UUID,
    not_linked_message: str,
) -> Response | JSONResponse:
    """ADR-0077: remove the one link row naming this pair, or `404`.

    The mirror of `_insert_link` above, and shaped verbatim on
    `test_suite_membership.remove_test_case_from_suite` /
    `test_plan_membership.remove_suite_from_plan` — the two junction unlinks
    that predate this ADR. Shared by all four routes for the same reason
    `_gate_parent`/`_load_same_org` are: a fifth independently-reasoned copy of
    "look the pair up, 404 if it isn't there, otherwise delete and 204" is how
    four routes that are supposed to be identical end up disagreeing about
    which case returns which status.

    `404`, not an idempotent `204`, when the pair is not linked — ADR-0030's
    own deliberate asymmetry with `POST`'s `409`, inherited unchanged. Note
    every caller runs this only *after* `_gate_parent`, so this `404` can never
    reveal anything about a row the caller could not already see.

    No cross-project `422` here, unlike the `POST` side: see this module's
    docstring for why re-validating an already-existing relationship could only
    ever strand rows.
    """
    link_row = await db.scalar(
        select(model).where(first_column == first_value, second_column == second_value)
    )
    if link_row is None:
        return _error(404, "not_found", not_linked_message)

    await db.delete(link_row)
    await db.commit()
    # `Response(status_code=204)` + `response_model=None` on each decorator,
    # exactly as `crud_factory.delete_item` and both membership routes do it —
    # FastAPI asserts that a 204 route declares no response body.
    return Response(status_code=204)


_REQUIREMENT_NOT_FOUND = "Requirement not found."
_TEST_CONDITION_NOT_FOUND = "Test condition not found."
_TEST_CASE_NOT_FOUND = "Test case not found."
_DEFECT_NOT_FOUND = "Defect not found."


@router.post("/requirements/{id}/test-case-links/{test_case_id}", status_code=201)
async def link_test_case_to_requirement_trace(
    id: UUID,
    test_case_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Link an existing `TestCase` to `Requirement` `id` (ADR-0076, FR-ADMIN-8).

    The `TestCase` side is resolved with `resolve_test_case_org_id` /
    `resolve_test_case_project_id` verbatim (ADR-0029's branching chain plus
    ADR-0069's standalone branch), never a re-derived walk — the same resolvers
    `add_test_case_to_suite` uses for its own tenant and project checks.
    """
    gate = await _gate_parent(
        db,
        Requirement,
        id,
        _resolve_requirement_org_id,
        actor,
        "requirement_test_case_link.create",
        _REQUIREMENT_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    requirement, org_id = gate

    test_case = await _load_same_org(db, TestCase, test_case_id, resolve_test_case_org_id, org_id, _TEST_CASE_NOT_FOUND)
    if isinstance(test_case, JSONResponse):
        return test_case

    case_project_id = await resolve_test_case_project_id(db, test_case)
    if case_project_id is None or case_project_id != requirement.project_id:
        return _error(422, "validation_error", "This test case belongs to a different project.")

    return await _insert_link(
        db,
        RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=test_case.id),
        "This test case is already linked to this requirement.",
        {"requirement_id": str(requirement.id), "test_case_id": str(test_case.id)},
    )


@router.post("/requirements/{id}/test-condition-links/{test_condition_id}", status_code=201)
async def link_test_condition_to_requirement(
    id: UUID,
    test_condition_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Link an existing `TestCondition` to `Requirement` `id` (ADR-0076, FR-ADMIN-8).

    A `TestCondition` already has one *owning* `Requirement`
    (`TestCondition.requirement_id`, REQ-3's rigor path). This link table is the
    ADR-0005 traceability relation *on top of* that: the same condition may be
    traced to any number of requirements, including its own owner. Linking a
    condition to its own owning requirement is therefore a normal `201`, not a
    conflict — the two relationships are separate, which is exactly why
    `Requirement`'s detail page carries both a "Test conditions" tab and a
    "Test conditions (linked)" one (ADR-0074's `" (linked)"` suffix exists for
    this collision).
    """
    gate = await _gate_parent(
        db,
        Requirement,
        id,
        _resolve_requirement_org_id,
        actor,
        "requirement_test_condition_link.create",
        _REQUIREMENT_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    requirement, org_id = gate

    condition = await _load_same_org(
        db, TestCondition, test_condition_id, _resolve_test_condition_org_id, org_id, _TEST_CONDITION_NOT_FOUND
    )
    if isinstance(condition, JSONResponse):
        return condition

    condition_project_id = await _resolve_test_condition_project_id(db, condition)
    if condition_project_id is None or condition_project_id != requirement.project_id:
        return _error(422, "validation_error", "This test condition belongs to a different project.")

    return await _insert_link(
        db,
        RequirementTestConditionLink(requirement_id=requirement.id, test_condition_id=condition.id),
        "This test condition is already linked to this requirement.",
        {"requirement_id": str(requirement.id), "test_condition_id": str(condition.id)},
    )


@router.post("/test-conditions/{id}/test-case-links/{test_case_id}", status_code=201)
async def link_test_case_to_test_condition(
    id: UUID,
    test_case_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Link an existing `TestCase` to `TestCondition` `id` (ADR-0076, FR-ADMIN-8).

    Same "traceability link on top of an owning FK" relationship as the route
    above: `TestCase.test_condition_id` is REQ-3's rigor-path owner, this table
    is the many-to-many trace, and a case may be linked to its own owning
    condition.
    """
    gate = await _gate_parent(
        db,
        TestCondition,
        id,
        _resolve_test_condition_org_id,
        actor,
        "test_condition_test_case_link.create",
        _TEST_CONDITION_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    condition, org_id = gate

    test_case = await _load_same_org(db, TestCase, test_case_id, resolve_test_case_org_id, org_id, _TEST_CASE_NOT_FOUND)
    if isinstance(test_case, JSONResponse):
        return test_case

    condition_project_id = await _resolve_test_condition_project_id(db, condition)
    case_project_id = await resolve_test_case_project_id(db, test_case)
    if condition_project_id is None or case_project_id is None or case_project_id != condition_project_id:
        return _error(422, "validation_error", "This test case belongs to a different project.")

    return await _insert_link(
        db,
        TestConditionTestCaseLink(test_condition_id=condition.id, test_case_id=test_case.id),
        "This test case is already linked to this test condition.",
        {"test_condition_id": str(condition.id), "test_case_id": str(test_case.id)},
    )


@router.post("/test-cases/{id}/defect-links/{defect_id}", status_code=201)
async def link_defect_to_test_case(
    id: UUID,
    defect_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Link an existing `Defect` to `TestCase` `id` (ADR-0076, FR-ADMIN-8).

    EXEC-3's `POST /executions/{id}/defects` already writes this row as a side
    effect of *raising* a defect against an execution. This route links a
    defect that already exists — the "I found this was already reported" case
    EXEC-3 has no route for — and is what makes `Defect`'s own single
    relationship tab (ADR-0075 Amendment 1 gave it its first) writable from the
    `TestCase` end.
    """
    gate = await _gate_parent(
        db,
        TestCase,
        id,
        resolve_test_case_org_id,
        actor,
        "test_case_defect_link.create",
        _TEST_CASE_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    test_case, org_id = gate

    defect = await _load_same_org(db, Defect, defect_id, _resolve_defect_org_id, org_id, _DEFECT_NOT_FOUND)
    if isinstance(defect, JSONResponse):
        return defect

    case_project_id = await resolve_test_case_project_id(db, test_case)
    defect_project_id = await _resolve_defect_project_id(db, defect)
    if case_project_id is None or defect_project_id is None or defect_project_id != case_project_id:
        return _error(422, "validation_error", "This defect belongs to a different project.")

    return await _insert_link(
        db,
        TestCaseDefectLink(test_case_id=test_case.id, defect_id=defect.id),
        "This defect is already linked to this test case.",
        {"test_case_id": str(test_case.id), "defect_id": str(defect.id)},
    )


# --- ADR-0077: the four matching unlink routes ---------------------------------------------------
#
# Same URL as each `POST` above, different verb. Each reuses `_gate_parent`
# verbatim — the same function, not a copy — so the NFR-1 boundary (`404` for a
# missing row, an unresolvable org or a non-member; `403` only past it) is
# literally shared between an entity's link and unlink, and cannot drift.
#
# Only the *permission code* differs from the `POST`: `<resource>.delete`
# instead of `<resource>.create` (ADR-0077 Decision §2). Neither verb is
# reachable with the other's grant, which is the whole reason these are
# separate codes rather than one `link` verb.
#
# None of them re-resolves the far row's own org or project. The link row's own
# existence under a parent the caller has already been authorized for is the
# complete authorization argument: a pair that exists was accepted by the
# matching `POST`, which enforced both checks at insert time, and a pair that
# does not exist is a `404` either way — so a far-side walk could only reject
# rows the system itself created (see the module docstring).


@router.delete("/requirements/{id}/test-case-links/{test_case_id}", status_code=204, response_model=None)
async def unlink_test_case_from_requirement_trace(
    id: UUID,
    test_case_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> Response | JSONResponse:
    """Remove the `RequirementTestCaseLink` for this pair (ADR-0077, FR-ADMIN-9).

    Deletes only the link row. Both the `Requirement` and the `TestCase`
    survive untouched, and the case remains linked to any other requirement,
    condition or suite it was linked to — the unique constraint is on the
    *pair*, and so is this delete.

    **Does not touch `TestCase.test_condition_id`.** That column is REQ-3's
    rigor-path *owning* FK, a different relationship that happens to involve
    the same two entity types; this route is the ADR-0005 traceability link on
    top of it, exactly as `link_test_condition_to_requirement`'s own docstring
    explains for the mirror case.
    """
    gate = await _gate_parent(
        db,
        Requirement,
        id,
        _resolve_requirement_org_id,
        actor,
        "requirement_test_case_link.delete",
        _REQUIREMENT_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    requirement, _org_id = gate

    return await _delete_link(
        db,
        RequirementTestCaseLink,
        RequirementTestCaseLink.requirement_id,
        requirement.id,
        RequirementTestCaseLink.test_case_id,
        test_case_id,
        "This test case is not linked to this requirement.",
    )


@router.delete(
    "/requirements/{id}/test-condition-links/{test_condition_id}", status_code=204, response_model=None
)
async def unlink_test_condition_from_requirement(
    id: UUID,
    test_condition_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> Response | JSONResponse:
    """Remove the `RequirementTestConditionLink` for this pair (ADR-0077, FR-ADMIN-9).

    Deletes only the link row — never `TestCondition.requirement_id`, REQ-3's
    own owning FK. Unlinking a condition from the requirement that *owns* it is
    therefore a normal `204` that leaves the condition exactly where it was,
    the precise mirror of the `POST`'s "linking a condition to its own owner is
    a normal `201`".
    """
    gate = await _gate_parent(
        db,
        Requirement,
        id,
        _resolve_requirement_org_id,
        actor,
        "requirement_test_condition_link.delete",
        _REQUIREMENT_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    requirement, _org_id = gate

    return await _delete_link(
        db,
        RequirementTestConditionLink,
        RequirementTestConditionLink.requirement_id,
        requirement.id,
        RequirementTestConditionLink.test_condition_id,
        test_condition_id,
        "This test condition is not linked to this requirement.",
    )


@router.delete(
    "/test-conditions/{id}/test-case-links/{test_case_id}", status_code=204, response_model=None
)
async def unlink_test_case_from_test_condition(
    id: UUID,
    test_case_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> Response | JSONResponse:
    """Remove the `TestConditionTestCaseLink` for this pair (ADR-0077, FR-ADMIN-9).

    Deletes only the link row — never `TestCase.test_condition_id`, the
    rigor-path owning FK, for the same reason the route above leaves
    `TestCondition.requirement_id` alone.
    """
    gate = await _gate_parent(
        db,
        TestCondition,
        id,
        _resolve_test_condition_org_id,
        actor,
        "test_condition_test_case_link.delete",
        _TEST_CONDITION_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    condition, _org_id = gate

    return await _delete_link(
        db,
        TestConditionTestCaseLink,
        TestConditionTestCaseLink.test_condition_id,
        condition.id,
        TestConditionTestCaseLink.test_case_id,
        test_case_id,
        "This test case is not linked to this test condition.",
    )


@router.delete("/test-cases/{id}/defect-links/{defect_id}", status_code=204, response_model=None)
async def unlink_defect_from_test_case(
    id: UUID,
    defect_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> Response | JSONResponse:
    """Remove the `TestCaseDefectLink` for this pair (ADR-0077, FR-ADMIN-9).

    Deletes only the link row: the `Defect` itself survives, with its own
    `TestExecution` provenance intact, and stays linked to every other
    `TestCase` it was linked to.

    This is the one of the four whose `.delete` code `tester` also holds
    (ADR-0077 Decision §3) — it is the exact undo of the one link that role may
    create, on a row that carries no content of its own.
    """
    gate = await _gate_parent(
        db,
        TestCase,
        id,
        resolve_test_case_org_id,
        actor,
        "test_case_defect_link.delete",
        _TEST_CASE_NOT_FOUND,
    )
    if isinstance(gate, JSONResponse):
        return gate
    test_case, _org_id = gate

    return await _delete_link(
        db,
        TestCaseDefectLink,
        TestCaseDefectLink.test_case_id,
        test_case.id,
        TestCaseDefectLink.defect_id,
        defect_id,
        "This defect is not linked to this test case.",
    )


router.include_router(make_crud_router(_REQUIREMENT_TEST_CASE_LINK_CONFIG))
router.include_router(make_crud_router(_REQUIREMENT_TEST_CONDITION_LINK_CONFIG))
router.include_router(make_crud_router(_TEST_CONDITION_TEST_CASE_LINK_CONFIG))
router.include_router(make_crud_router(_TEST_CASE_DEFECT_LINK_CONFIG))

__all__ = ["router"]
