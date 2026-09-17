"""ADR-0079 — compound create for one-to-many tabs: completeness and shape.

Covers TC-ADMIN-129 (every one-to-many tab whose child has no generic
`create`, but a real bespoke atomic-create route, offers a way to author one)
and TC-ADMIN-130 (each declaration's internal consistency).

Pure-Python, no DB/network.

## What this file is actually for

`tests/unit/test_adr78_compound_create_actions.py` closed the CTO's
requirement for every many-to-many tab. The identical shape of gap exists on
one-to-many tabs: a child entity with no generic `create` renders no "New"
button at all, even when a real bespoke atomic-create route exists and is
already reachable from *this exact* tab's own scope. Live audit (2026-09-16)
found seven such tabs; three have a real route whose parent IS the tab's own
scope (`Requirement` -> Test conditions, `TestExecution` -> Defects,
`TestPlan` -> Test cycles) and were closed in the original pass. Two need a
genuinely new picker mechanism (`TestExecution`'s two 1-n directions, both
needing the *other* of its two real parents picked) and are deliberately left
open, named explicitly below rather than silently passed over. One is not a
gap at all — `OrgMembership` is authored only through Invite+Accept, a
materially different flow a "New" button cannot represent.

**Amendment 1 (2026-09-16, same day, pre-merge — `docs/CLAUDE.md`'s
same-branch-correction convention):** `TestExecution` -> "Test logs" was
originally classified an "exception" alongside `OrgMembership` ("append-only
by schema, no route could exist"). That was wrong — `POST
/executions/{id}/comments` (EXEC-2) already exists, is structurally identical
to the other three closed routes (one bespoke route, parent = path
placeholder = this entity's own `scope_field`, one transaction, no separate
link table), and was missed only because its name/shape ("add a comment")
doesn't read like a generic entity create the way `POST
/requirements/{id}/test-conditions` does. Closing it needed one more piece
none of the original three did: `_TEST_LOG_CONFIG` had no writable schema at
all (`create_schema=None`, `update_schema=NoSchema`), so `derive_entity_schema`
derived every field `readOnly: true` and the generic create form had nothing
to render — fixed by setting `create_schema=AddTestLogCommentRequest`
*without* adding `"create"` to `methods` (the generic factory only registers
a create route when both are true), which supplies real writable fields for
the compound-create form with zero change to `TestLog`'s actual REST surface.
`TestExecution` -> "Test logs" moves from "exception" to "closed"; only
`OrgMembership` remains a genuine exception.

## The oracle, same discipline as ADR-0078

`backend/CLAUDE.md`'s ADR-0075 note: a completeness test that enumerates the
same set as the thing it checks passes vacuously. The set under test is
`config.child_compound_creates`; the oracle is `derive_entity_relations`,
computed independently of any declaration.
"""

from __future__ import annotations

import dataclasses
import re

import pytest

from app.api.crud_factory import (
    CompoundCreateAction,
    CrudEntityConfig,
    derive_entity_relations,
    fk_fields_of,
    is_link_entity,
)
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.db.rbac_seed_catalog import build_permission_catalog

#: Every one-to-many tab whose child has no generic `create`, live on
#: `main` as of this ADR — the WHOLE population this file's oracle ranges
#: over. Not the oracle itself (that is `derive_entity_relations`); this is
#: the human-readable classification of what it finds, checked against the
#: declarations rather than trusted in their place.
#:
#: `"closed"` -> a `child_compound_creates` entry exists and the tab's own
#: scope already is the route's parent, no picker needed.
#: `"open"` -> a real bespoke create route exists but needs a picker
#: mechanism this ADR does not yet build (`TestExecution`'s two directions,
#: each needing the *other* of its two real parents).
#: `"exception"` -> no route could close this, or closing it via a plain
#: "New" button would misrepresent a materially different authoring flow.
CLASSIFICATION: dict[tuple[str, str], str] = {
    ("requirements", "Test conditions"): "closed",
    ("test-executions", "Defects"): "closed",
    ("test-plans", "Test cycles"): "closed",
    # ADR-0084 opened this (the project-scoped arm needed a picker mechanism
    # that didn't exist yet); ADR-0086 closed it — `child_compound_creates`
    # now declares the `project_id` arm too, with `parent_entity="test-plan"`
    # driving a real parent picker (`EntityListPage.tsx`'s own generalization
    # of `EntityRelationTab.tsx`'s pre-existing compound-parent-picker logic).
    ("projects", "Test cycles"): "closed",
    ("test-cases", "Test executions"): "open",
    ("test-cycles", "Test executions"): "open",
    ("test-executions", "Test logs"): "closed",  # Amendment 1 (2026-09-16)
    ("organizations", "Org memberships"): "exception",
}

#: The four closed directions and the bespoke route each borrows. Hand-written
#: on purpose and not used as the completeness oracle, mirroring ADR-0078's own
#: `EXPECTED_DECLARATIONS` — the human-readable design record, checked against
#: the declarations, while "is any direction missing" is answered by the
#: derivation instead.
EXPECTED_DECLARATIONS: dict[tuple[str, str], tuple[str, str, bool]] = {
    # (child entity key, far_field): (path_template, permission, links_automatically)
    ("test-conditions", "requirement_id"): (
        "/requirements/{requirement_id}/test-conditions",
        "test_condition.create",
        True,
    ),
    ("defects", "test_execution_id"): (
        "/executions/{test_execution_id}/defects",
        "defect.create",
        True,
    ),
    ("test-cycles", "test_plan_id"): (
        "/test-plans/{test_plan_id}/test-cycles",
        "test_cycle.create",
        True,
    ),
    # Amendment 1 (2026-09-16). Permission is deliberately `test_execution.update`,
    # not `test_log.create` (no such code exists) — the real route
    # (`add_test_execution_comment`) is gated on the SAME permission a
    # `result` correction already requires, since appending a comment/log
    # entry is treated as updating the execution's own record, not creating
    # an independent one. `test_the_permission_is_the_child_s_own_create_code`
    # below carves this declaration out of its "always `${child}.create`"
    # assertion for exactly this reason.
    ("test-logs", "test_execution_id"): (
        "/executions/{test_execution_id}/comments",
        "test_execution.update",
        True,
    ),
    # ADR-0086: the first declaration whose placeholder genuinely differs
    # from `far_field` — see `test_path_template_placeholder_needs_a_picker_iff_it_differs_from_far_field`
    # for the parent-picker fields this implies (`parent_entity`/`parent_label`),
    # not checked by this dict (which only pins route/permission/links_automatically).
    ("test-cycles", "project_id"): (
        "/test-plans/{test_plan_id}/test-cycles",
        "test_cycle.create",
        True,
    ),
}


def _one_to_many_directions(
    configs: dict[str, CrudEntityConfig],
) -> list[tuple[str, dict[str, object]]]:
    """Every (viewing entity, relation) pair the detail page renders as a
    one-to-many tab. Computed from `derive_entity_relations`, never from a
    list of children — this is the oracle."""
    out: list[tuple[str, dict[str, object]]] = []
    for key, config in configs.items():
        for relation in derive_entity_relations(config, configs):
            if relation["kind"] == "one-to-many":
                out.append((key, relation))
    return out


def one_to_many_directions_without_a_create_path(
    configs: dict[str, CrudEntityConfig],
) -> set[tuple[str, str]]:
    """One-to-many tabs whose child has no generic `create` and no matching
    `child_compound_creates` declaration either — a tab offering no way to
    author a row that does not exist yet.

    Parameterized so the mutation test below can hand it a broken registry.
    """
    gaps: set[tuple[str, str]] = set()
    for key, relation in _one_to_many_directions(configs):
        child_config = configs[str(relation["entity"])]
        child_methods = child_config.full_methods or child_config.methods
        if "create" in child_methods:
            continue
        declared = any(
            action.far_field == relation["scopeField"] for action in child_config.child_compound_creates
        )
        if not declared:
            gaps.add((key, str(relation["label"])))
    return gaps


def spurious_child_compound_create(configs: dict[str, CrudEntityConfig]) -> set[tuple[str, str]]:
    """`(key, far_field)` pairs declaring a `child_compound_creates` entry that
    matches no real one-to-many direction's `scopeField` — the entry would be
    unreachable code, exactly the failure `test_adr78`'s `spurious_compound_create`
    guards on the many-to-many side.
    """
    real_scope_fields: dict[str, set[str]] = {}
    for key, relation in _one_to_many_directions(configs):
        real_scope_fields.setdefault(str(relation["entity"]), set()).add(str(relation["scopeField"]))

    spurious: set[tuple[str, str]] = set()
    for key, config in configs.items():
        for action in config.child_compound_creates:
            if action.far_field not in real_scope_fields.get(key, set()):
                spurious.add((key, action.far_field))
    return spurious


def _declared_actions() -> list[tuple[str, CompoundCreateAction]]:
    return [
        (key, action)
        for key, config in ALL_ENTITY_CONFIGS.items()
        for action in config.child_compound_creates
    ]


# --- TC-ADMIN-129: the classification is exhaustive and the closed set is really closed --------


def test_the_classification_accounts_for_every_live_gap() -> None:
    """The `CLASSIFICATION` table is not the oracle, but it must at least be
    complete relative to it: every one-to-many direction whose child lacks a
    generic `create` appears in the table under some classification, and the
    table names nothing that is not a real gap."""
    real_gaps = set()
    for key, relation in _one_to_many_directions(ALL_ENTITY_CONFIGS):
        child_config = ALL_ENTITY_CONFIGS[str(relation["entity"])]
        methods = child_config.full_methods or child_config.methods
        if "create" not in methods:
            real_gaps.add((key, str(relation["label"])))
    assert real_gaps == set(CLASSIFICATION)


def test_every_classified_closed_direction_has_a_working_create_path() -> None:
    """**TC-ADMIN-129.** The requirement itself, for the subset this ADR
    actually closes: a "closed" direction must have no remaining gap."""
    closed = {pair for pair, status in CLASSIFICATION.items() if status == "closed"}
    gaps = one_to_many_directions_without_a_create_path(ALL_ENTITY_CONFIGS)
    assert gaps & closed == set()


def test_open_and_exception_directions_are_named_not_silently_passing() -> None:
    """The two "open" directions must still show up as real gaps — proving
    they were deliberately left, not accidentally closed by something else,
    and not silently absent from the oracle."""
    open_directions = {pair for pair, status in CLASSIFICATION.items() if status == "open"}
    gaps = one_to_many_directions_without_a_create_path(ALL_ENTITY_CONFIGS)
    assert open_directions <= gaps


def test_the_one_exception_direction_has_no_generic_create_and_no_declaration() -> None:
    """**TC-ADMIN-129.** `OrgMembership` is the one gap this ADR does not
    attempt to close — asserted here so a future change that quietly adds a
    `child_compound_creates` entry for it doesn't merge unreviewed (the
    exception's whole reasoning — invite-flow authoring, a plain "New" form
    would misrepresent it — would need re-litigating, not just re-testing).

    `TestLog` was the sibling exception until Amendment 1 (2026-09-16) found
    a real route and closed it — see `test_the_declared_actions_are_exactly_
    the_five_expected` for its own declaration-shape assertions instead."""
    exceptions = {pair for pair, status in CLASSIFICATION.items() if status == "exception"}
    assert exceptions == {("organizations", "Org memberships")}
    assert ALL_ENTITY_CONFIGS["org-memberships"].child_compound_creates == ()


def test_the_completeness_checker_actually_sees_a_gap() -> None:
    """**TC-ADMIN-129.** In-suite mutation check (ADR-0075's lesson). Strip the
    `TestCondition` direction's declaration and the checker must name that
    exact tab."""
    broken = dict(ALL_ENTITY_CONFIGS)
    broken["test-conditions"] = dataclasses.replace(broken["test-conditions"], child_compound_creates=())

    assert ("requirements", "Test conditions") in one_to_many_directions_without_a_create_path(broken)
    assert ("requirements", "Test conditions") not in one_to_many_directions_without_a_create_path(
        ALL_ENTITY_CONFIGS
    )


def test_no_spurious_declaration_exists_in_the_live_registry() -> None:
    """**TC-ADMIN-129.** The other half of the partition."""
    assert spurious_child_compound_create(ALL_ENTITY_CONFIGS) == set()


def test_the_spurious_checker_actually_sees_a_gap() -> None:
    """**TC-ADMIN-129.** Mutation check for that half — a declaration whose
    `far_field` names a scope field nothing actually scopes by."""
    broken = dict(ALL_ENTITY_CONFIGS)
    broken["test-conditions"] = dataclasses.replace(
        broken["test-conditions"],
        child_compound_creates=(
            CompoundCreateAction(
                far_field="not_a_real_scope_field",
                path_template="/x/{not_a_real_scope_field}",
                permission="test_condition.create",
                links_automatically=True,
            ),
        ),
    )
    assert ("test-conditions", "not_a_real_scope_field") in spurious_child_compound_create(broken)
    assert spurious_child_compound_create(ALL_ENTITY_CONFIGS) == set()


def test_the_declared_actions_are_exactly_the_five_expected() -> None:
    """**TC-ADMIN-130.** Each declaration's route, permission and
    `links_automatically` flag, pinned against the design record. Four ->
    five with ADR-0086's `("test-cycles", "project_id")` addition."""
    actual = {
        (key, action.far_field): (action.path_template, action.permission, action.links_automatically)
        for key, action in _declared_actions()
    }
    assert actual == EXPECTED_DECLARATIONS


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_far_field_names_a_real_scope_field_of_this_entity(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-130.** `far_field` must be a column this tab is genuinely
    scoped by — anything else matches no `relation.scopeField` ever, so the
    declaration would be silently unreachable."""
    scope_field = ALL_ENTITY_CONFIGS[key].scope_field
    scope_fields = scope_field if isinstance(scope_field, tuple) else (scope_field,)
    assert action.far_field in scope_fields


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_far_field_is_also_a_real_fk_column(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-130.** Belt-and-suspenders alongside the scope-field check:
    the value must resolve to an actual FK the schema serves, or the picker's
    own scoping logic (`compoundParentScopeParams`) has nothing to key off."""
    assert action.far_field in fk_fields_of(ALL_ENTITY_CONFIGS[key])


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_declaring_entity_is_not_a_link_entity(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-130.** `child_compound_creates` exists specifically because
    `compound_creates`' own "the other of exactly two FKs" derivation does not
    hold for a plain child entity — asserting the declarer is not a link
    entity pins that the two fields are never confused for the same config."""
    assert not is_link_entity(ALL_ENTITY_CONFIGS[key])


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_path_template_carries_exactly_one_placeholder(key: str, action: CompoundCreateAction) -> None:
    assert len(re.findall(r"\{([a-zA-Z_]+)\}", action.path_template)) == 1


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_path_template_placeholder_needs_a_picker_iff_it_differs_from_far_field(
    key: str, action: CompoundCreateAction
) -> None:
    """**TC-ADMIN-130, generalized by ADR-0086.** Originally "all three closed
    directions need no picker: the route's own parent already is the tab's
    own scope" — true of every declaration until `test-cycles`' `project_id`
    arm (ADR-0086), the first that genuinely needs one (the route's path
    needs `test_plan_id`, which a project-scoped list doesn't carry). The
    invariant this asserts in both directions: a placeholder equal to
    `far_field` declares no parent fields at all (no picker needed, matching
    the original three); a placeholder that differs MUST declare
    `parent_entity`/`parent_label` (a picker is unavoidable) — neither
    direction may silently omit or silently carry unused parent fields."""
    placeholder = re.findall(r"\{([a-zA-Z_]+)\}", action.path_template)[0]
    if placeholder == action.far_field:
        assert action.parent_entity is None
        assert action.parent_label is None
        assert action.parent_label_field is None
        assert action.parent_filters == ()
    else:
        assert action.parent_entity is not None
        assert action.parent_label is not None


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_path_template_is_an_absolute_api_path_with_no_api_prefix(
    key: str, action: CompoundCreateAction
) -> None:
    assert action.path_template.startswith("/")
    assert not action.path_template.startswith("/api")


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_path_template_matches_a_real_registered_route(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-130.** Checked against the app's own published OpenAPI path
    table, per `backend/CLAUDE.md`'s "pick an oracle nobody hand-maintains" —
    the identical technique `test_adr78`'s own version of this test uses
    (`app.routes` yields only 27 entries here, most with no `methods` at all,
    so a membership check against it passes vacuously)."""
    from app.main import app

    def _shape(path: str) -> str:
        return re.sub(r"\{[a-zA-Z_]+\}", "{}", path)

    paths = app.openapi()["paths"]
    registered = {_shape(path) for path, verbs in paths.items() if "post" in {v.lower() for v in verbs}}
    assert registered, "oracle is empty — this test would pass vacuously"
    assert _shape(f"/api/v1{action.path_template}") in registered


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_every_declared_permission_code_exists_in_the_rbac_catalog(
    key: str, action: CompoundCreateAction
) -> None:
    codes = {code for code, _, _ in build_permission_catalog()}
    assert action.permission in codes


@pytest.mark.parametrize(
    "key,action",
    [(k, a) for k, a in _declared_actions() if k != "test-logs"],
    ids=lambda v: getattr(v, "far_field", v),
)
def test_the_permission_is_the_child_s_own_create_code(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-130.** True of three of the four — asserted, not assumed,
    per ADR-0078's own sibling test's reasoning: a fact about these three
    routes, not a rule the client is allowed to derive. `test-logs` is
    deliberately excluded and covered by its own sibling test below instead
    — no `test_log.create` permission code exists at all, by design (ADR-0079
    Amendment 1: `TestLog` is still append-only/immutable by schema, gated on
    the parent `TestExecution`'s own `.update` code)."""
    child_resource = ALL_ENTITY_CONFIGS[key].resource
    assert action.permission == f"{child_resource}.create"


def test_the_test_log_declaration_is_gated_on_the_parent_s_update_code_not_a_create_code() -> None:
    """**TC-ADMIN-130.** The one declaration excluded from the test above,
    asserted on its own literal (not-derived) value — `test_log.create` is
    not in the RBAC catalog at all (`TestLog` has no `create` permission
    code, ever), so this is not an oversight to close but the correct gate
    for the real route it borrows."""
    action = ALL_ENTITY_CONFIGS["test-logs"].child_compound_creates[0]
    assert action.permission == "test_execution.update"
    codes = {code for code, _, _ in build_permission_catalog()}
    assert "test_log.create" not in codes
