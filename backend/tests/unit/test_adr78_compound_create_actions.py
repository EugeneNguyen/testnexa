"""ADR-0078 — compound create through a bespoke route: completeness and shape.

Covers TC-ADMIN-116 (every many-to-many tab direction can create its far
entity) and TC-ADMIN-117 (each declaration's internal consistency).

Pure-Python, no DB/network.

## What this file is actually for

The CTO's requirement is one sentence: **every n-n relationship tab offers both
"Link existing" and "Create new"**. ADR-0076 Amendment 1 shipped the second
action as *the far entity's generic `create`, then `linkCreate`* — which
silently does nothing for a direction whose far entity has no generic `create`
at all. Three of the twelve live directions are exactly that, and the symptom
is the one `backend/CLAUDE.md`'s registry note keeps describing: no error, no
`403`, just a button that never appears, on the tabs whose far entity is the
*hardest* to author anywhere else.

So the claim worth pinning is not "the three declarations exist" — that is a
restatement of the diff. It is **"no direction is left without a create path"**,
asserted over the directions the system actually derives.

## The oracle, and why it is not the registry tuple

`backend/CLAUDE.md`'s ADR-0075 note: *a completeness test that enumerates the
same set as the thing it checks passes vacuously — the oracle must come from
outside that set.* Applied here, the set under test is the **declarations**
(`config.compound_creates`), and the oracle is `derive_entity_relations` — a
computation over every registered config's FK graph, which is where the twelve
directions come from in the first place. A direction cannot hide from this test
by being un-declared, because nothing here reads a declaration to decide which
directions exist.

That leaves exactly one gap, and it is already guarded a level down: an entity
missing from `ALL_ENTITY_CONFIGS` entirely is invisible to the derivation too.
`test_adr75_registry_completeness.py` walks `Base.metadata` for precisely that,
and is the reason this file does not need to.

Per the same lesson, `directions_without_a_create_path` takes its collection as
a parameter and is **mutation-tested in-suite**: a deliberately-broken registry
goes through the same function and must report the exact expected gap, so "no
gaps" and "the checker cannot see gaps" are distinguishable results rather than
the same empty set.
"""

from __future__ import annotations

import re

import pytest

from app.api.crud_factory import (
    CompoundCreateAction,
    CrudEntityConfig,
    derive_entity_relations,
    derive_entity_schema,
    fk_fields_of,
    is_link_entity,
)
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.db.rbac_seed_catalog import build_permission_catalog

#: The three directions that need a compound create, and the bespoke route each
#: one borrows. Hand-written ON PURPOSE, and deliberately *not* used as the
#: oracle for completeness above — it is the human-readable record of the
#: design decision ("which routes did we choose, and does each still gate on
#: what we said"), checked against the declarations. The question "is any
#: direction missing" is answered by the derivation instead.
EXPECTED_DECLARATIONS: dict[tuple[str, str], tuple[str, str, bool]] = {
    # (link entity key, far_field): (path_template, permission, links_automatically)
    ("requirement-test-condition-links", "test_condition_id"): (
        "/requirements/{requirement_id}/test-conditions",
        "test_condition.create",
        True,
    ),
    ("test-condition-test-case-links", "test_condition_id"): (
        "/requirements/{requirement_id}/test-conditions",
        "test_condition.create",
        False,
    ),
    ("test-case-defect-links", "defect_id"): (
        "/executions/{test_execution_id}/defects",
        "defect.create",
        True,
    ),
}

#: Every entity with no generic `create` that is reachable as the far side of a
#: junction. Derived in the test below rather than trusted from here; listed for
#: the reader, since "why does this entity need special handling" is the whole
#: context (both have a `NOT NULL` parent FK the generic factory cannot stamp).
FAR_ENTITIES_WITHOUT_GENERIC_CREATE = {"test-conditions", "defects"}


def _many_to_many_directions(
    configs: dict[str, CrudEntityConfig],
) -> list[tuple[str, dict[str, object]]]:
    """Every (viewing entity, relation) pair the detail page renders as a
    many-to-many tab — i.e. every direction the CTO's requirement ranges over.

    Computed from `derive_entity_relations`, never from a list of junctions:
    this is the oracle, and it has to come from outside the set under test.
    """
    out: list[tuple[str, dict[str, object]]] = []
    for key, config in configs.items():
        for relation in derive_entity_relations(config, configs):
            if relation["kind"] == "many-to-many":
                out.append((key, relation))
    return out


def directions_without_a_create_path(
    configs: dict[str, CrudEntityConfig],
) -> set[tuple[str, str]]:
    """The whole point of ADR-0078, as a set that must be empty.

    A direction can create its far entity one of two ways, and needs exactly
    one of them:

    1. the far entity has a generic `create` (ADR-0076 Amendment 1's original
       composition: create, then `linkCreate`); or
    2. the link entity declares a `compound_creates` entry for **this**
       direction, naming the bespoke route that authors it.

    Returns `(viewing entity, tab label)` for every direction with neither —
    each one a tab that renders "Link existing" alone and offers no way to
    author a far record that does not exist yet.

    Parameterized so the mutation tests below can hand it a broken registry.
    """
    gaps: set[tuple[str, str]] = set()
    for key, relation in _many_to_many_directions(configs):
        link_config = configs[str(relation["entity"])]
        far_config = configs[str(relation["targetEntity"])]
        far_methods = far_config.full_methods or far_config.methods
        if "create" in far_methods:
            continue
        declared = any(
            action.far_field == relation["targetField"] for action in link_config.compound_creates
        )
        if not declared:
            gaps.add((key, str(relation["label"])))
    return gaps


def spurious_compound_create(configs: dict[str, CrudEntityConfig]) -> set[str]:
    """Keys declaring a `compound_creates` entry while not being a link entity.

    The other half of the partition. `compound_creates` is read off the *link*
    entity by `EntityRelationTab`, matched against `relation.targetField` —
    a non-link entity has no such field to match, so the declaration would be
    unreachable code advertising a capability nothing can invoke.
    """
    return {
        key
        for key, config in configs.items()
        if config.compound_creates and not is_link_entity(config)
    }


def unnecessary_compound_create(configs: dict[str, CrudEntityConfig]) -> set[tuple[str, str]]:
    """Declarations for a direction whose far entity already has a generic
    `create`.

    Not an error the app would crash on — the client prefers the generic path,
    so the declaration would simply never fire. It is an error because a dead
    declaration is a false record of why a route exists, and the next reader
    has no way to tell it apart from a live one.
    """
    dead: set[tuple[str, str]] = set()
    plural_by_singular = {c.resource.replace("_", "-"): key for key, c in configs.items()}
    for key, config in configs.items():
        fks = fk_fields_of(config)
        for action in config.compound_creates:
            far_ref = fks.get(action.far_field)
            far_key = plural_by_singular.get(far_ref) if far_ref else None
            if far_key is None:
                continue
            far_config = configs[far_key]
            if "create" in (far_config.full_methods or far_config.methods):
                dead.add((key, action.far_field))
    return dead


def _fake_link_config(resource: str, *, with_action: bool) -> CrudEntityConfig:
    """A structurally-valid link entity (2 FK fields, no create/update) whose
    far side has no generic `create`, for the mutation tests.

    `right_id` points at `defect` deliberately — a real registered entity that
    genuinely lacks a generic `create`, so the broken registry exercises the
    same branch the real gap did rather than a synthetic one that could
    accidentally be excluded for a different reason.
    """
    from pydantic import BaseModel

    from app.api.crud_factory import FieldMeta, NoSchema, chain_resolver

    class _Summary(BaseModel):
        left_id: str
        right_id: str

    return CrudEntityConfig(
        model=ALL_ENTITY_CONFIGS["test-case-defect-links"].model,
        resource=resource,
        create_schema=None,
        update_schema=NoSchema,
        summary_schema=_Summary,
        scope_field=("left_id", "right_id"),
        resolve_org_id=chain_resolver([]),
        methods=frozenset({"list", "get"}),
        field_meta={
            "left_id": FieldMeta(ref_entity="test-case"),
            "right_id": FieldMeta(ref_entity="defect"),
        },
        compound_creates=(
            CompoundCreateAction(
                far_field="right_id",
                path_template="/x/{parent_id}/y",
                permission="defect.create",
                links_automatically=True,
            ),
        )
        if with_action
        else (),
    )


def _declared_actions() -> list[tuple[str, CompoundCreateAction]]:
    return [
        (key, action)
        for key, config in ALL_ENTITY_CONFIGS.items()
        for action in config.compound_creates
    ]


# --- TC-ADMIN-116: the CTO's requirement, as a partition -----------------------------------


def test_every_many_to_many_direction_can_create_its_far_entity() -> None:
    """**TC-ADMIN-116.** The requirement itself: *every* n-n tab can create, not
    only the ones whose far entity happened to have a generic `create`.

    This is the assertion that would have failed before ADR-0078, naming the
    exact three tabs that rendered "Link existing" alone.
    """
    assert directions_without_a_create_path(ALL_ENTITY_CONFIGS) == set()


def test_there_are_twelve_directions_and_three_of_them_need_a_compound_create() -> None:
    """**TC-ADMIN-116.** The shape of the answer, not just its emptiness.

    Pinned as exact counts so a future change that *removes* a direction cannot
    make the partition above pass by shrinking the set it ranges over — the
    vacuous-pass failure mode `backend/CLAUDE.md` describes, one level up from
    the mutation tests below.
    """
    directions = _many_to_many_directions(ALL_ENTITY_CONFIGS)
    assert len(directions) == 12

    needing_compound = {
        (key, str(relation["label"]))
        for key, relation in directions
        if "create"
        not in (
            ALL_ENTITY_CONFIGS[str(relation["targetEntity"])].full_methods
            or ALL_ENTITY_CONFIGS[str(relation["targetEntity"])].methods
        )
    }
    assert needing_compound == {
        ("requirements", "Test conditions (linked)"),
        ("test-cases", "Test conditions (linked)"),
        ("test-cases", "Defects (linked)"),
    }


def test_the_two_far_entities_lacking_a_generic_create_are_the_expected_ones() -> None:
    """**TC-ADMIN-116.** *Why* those three directions need this at all, asserted
    rather than asserted-in-a-comment.

    Both entities are bespoke-create-only because their parent FK is `NOT NULL`
    and the generic factory has no way to stamp it — `TestCondition.requirement_id`
    (ADR-0028) and `Defect.test_execution_id` (ADR-0044). If a future story gives
    either a generic `create`, this test fails and the corresponding declaration
    becomes dead code that `test_no_declaration_is_dead_code` will then catch.
    """
    far_keys = {str(relation["targetEntity"]) for _, relation in _many_to_many_directions(ALL_ENTITY_CONFIGS)}
    without_create = {
        key
        for key in far_keys
        if "create" not in (ALL_ENTITY_CONFIGS[key].full_methods or ALL_ENTITY_CONFIGS[key].methods)
    }
    assert without_create == FAR_ENTITIES_WITHOUT_GENERIC_CREATE


def test_the_completeness_checker_actually_sees_a_gap() -> None:
    """**TC-ADMIN-116.** In-suite mutation check (ADR-0075's lesson,
    `backend/CLAUDE.md`).

    Strip the `Defect` direction's declaration and the checker must name that
    exact tab. Without this, `== set()` above is indistinguishable from a
    checker that can never return anything.
    """
    broken = dict(ALL_ENTITY_CONFIGS)
    original = broken["test-case-defect-links"]
    import dataclasses

    broken["test-case-defect-links"] = dataclasses.replace(original, compound_creates=())

    assert directions_without_a_create_path(broken) == {("test-cases", "Defects (linked)")}
    # ...and the real registry still reports none, in the same test, so the two
    # results differ for a reason rather than both being empty.
    assert directions_without_a_create_path(ALL_ENTITY_CONFIGS) == set()


def test_the_checker_is_not_fooled_by_a_declaration_for_the_other_direction() -> None:
    """**TC-ADMIN-116.** The subtlest way this could pass vacuously.

    `compound_creates` is a *list on the junction*, and a junction has two
    directions. A checker that asked "does this link entity declare anything"
    instead of "does it declare one for THIS direction" would be satisfied by
    the wrong end's declaration and report no gap — while the tab that needs it
    still has no button. Point the real `Defect` declaration at the opposite FK
    and the gap must reappear.
    """
    import dataclasses

    broken = dict(ALL_ENTITY_CONFIGS)
    original = broken["test-case-defect-links"]
    wrong_direction = dataclasses.replace(
        original.compound_creates[0], far_field="test_case_id"
    )
    broken["test-case-defect-links"] = dataclasses.replace(
        original, compound_creates=(wrong_direction,)
    )

    assert directions_without_a_create_path(broken) == {("test-cases", "Defects (linked)")}


def test_no_non_link_entity_declares_a_compound_create() -> None:
    """**TC-ADMIN-116.** The other half of the partition."""
    assert spurious_compound_create(ALL_ENTITY_CONFIGS) == set()


def test_the_spurious_checker_actually_sees_a_gap() -> None:
    """**TC-ADMIN-116.** Mutation check for that half."""
    broken = dict(ALL_ENTITY_CONFIGS)
    broken["fake-non-links"] = ALL_ENTITY_CONFIGS["requirements"]
    assert spurious_compound_create(broken) == set()  # requirements declares none

    from dataclasses import replace

    broken["fake-non-links"] = replace(
        ALL_ENTITY_CONFIGS["requirements"],
        compound_creates=(
            CompoundCreateAction(
                far_field="whatever",
                path_template="/x/{y}",
                permission="requirement.create",
                links_automatically=True,
            ),
        ),
    )
    assert spurious_compound_create(broken) == {"fake-non-links"}


def test_no_declaration_is_dead_code() -> None:
    """**TC-ADMIN-116.** A declaration for a direction whose far entity already
    has a generic `create` would never fire — the client prefers the generic
    path. Harmless at runtime, and a false record of why a route exists.
    """
    assert unnecessary_compound_create(ALL_ENTITY_CONFIGS) == set()


def test_the_fake_link_config_helper_is_itself_gap_shaped() -> None:
    """**TC-ADMIN-116.** Guards the mutation helper, not the app.

    `_fake_link_config` is only useful if a registry containing its
    `with_action=False` form genuinely produces a gap — otherwise the mutation
    tests above would be asserting against a fixture that cannot fail either.
    """
    assert _fake_link_config("fake_link", with_action=True).compound_creates
    assert _fake_link_config("fake_link", with_action=False).compound_creates == ()


# --- TC-ADMIN-117: internal consistency of each declaration -------------------------------


def test_the_declared_actions_are_exactly_the_three_expected() -> None:
    """**TC-ADMIN-117.** Each declaration's route, permission and
    `links_automatically` flag, pinned against the design record.

    `links_automatically` is pinned here because it is the one field with no
    mechanical check available anywhere — it asserts something about the
    *transaction body* of another module's route. `test_adr78_compound_create.py`
    (integration) is what actually proves each value true against a live server;
    this is the declaration side of that pair.
    """
    actual = {
        (key, action.far_field): (
            action.path_template,
            action.permission,
            action.links_automatically,
        )
        for key, action in _declared_actions()
    }
    assert actual == EXPECTED_DECLARATIONS


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_far_field_is_one_of_the_link_entity_s_own_two_fks(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-117.** `far_field` names the direction. A value that is not
    one of this entity's FK columns matches no `relation.targetField` ever, so
    the declaration would be silently unreachable — the exact failure shape
    this whole family of tests exists to make loud.
    """
    assert action.far_field in fk_fields_of(ALL_ENTITY_CONFIGS[key])


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_path_template_carries_exactly_one_placeholder(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-117.** The client reads the single placeholder to decide
    whether it already holds the parent or must ask for one
    (`compoundParentField`). Zero placeholders leaves nothing to substitute;
    two leaves it no way to know which is which, and it would POST a URL with a
    literal brace in it.
    """
    assert len(re.findall(r"\{([a-zA-Z_]+)\}", action.path_template)) == 1


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_path_template_is_an_absolute_api_path_with_no_api_prefix(
    key: str, action: CompoundCreateAction
) -> None:
    """**TC-ADMIN-117.** Same contract `link_create`'s own templates hold: the
    client prepends `/api/v1`, so a template carrying it would double-prefix
    into a bare FastAPI `404` with no `code` key (`backend/CLAUDE.md`).
    """
    assert action.path_template.startswith("/")
    assert not action.path_template.startswith("/api")


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_path_template_matches_a_real_registered_route(key: str, action: CompoundCreateAction) -> None:
    """**TC-ADMIN-117.** The declaration names a route that actually exists,
    and accepts `POST`.

    Checked against the app's own published path table (`app.openapi()`) rather
    than a list of strings, per `backend/CLAUDE.md`'s "pick an oracle nobody
    hand-maintains" — a route joins that table by being registered, so there is
    no second step to forget.

    Deliberately **not** `app.routes`: the routers are included on the app with
    a `/api/v1` prefix and that attribute yields only 27 entries here, four of
    them with a `methods` set at all — so a membership check against it passes
    vacuously (it did, on the first draft of this test: the computed set was
    empty and every assertion failed for the *right* reason by luck). The
    placeholder names differ from the route's own path params by design (the
    declaration names the *FK column*, the route says `{id}`), so both sides
    normalize to `{}` before comparing.
    """
    from app.main import app

    def _shape(path: str) -> str:
        return re.sub(r"\{[a-zA-Z_]+\}", "{}", path)

    paths = app.openapi()["paths"]
    registered = {
        _shape(path) for path, verbs in paths.items() if "post" in {v.lower() for v in verbs}
    }
    assert registered, "oracle is empty — this test would pass vacuously"
    assert _shape(f"/api/v1{action.path_template}") in registered


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_every_declared_permission_code_exists_in_the_rbac_catalog(
    key: str, action: CompoundCreateAction
) -> None:
    """**TC-ADMIN-117.** A code the catalog does not contain can never be held
    by anybody, so the button would be hidden from every actor forever — a
    failure indistinguishable, from the outside, from the gap ADR-0078 fixes.
    """
    codes = {code for code, _, _ in build_permission_catalog()}
    assert action.permission in codes


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_the_permission_is_the_far_entity_s_own_create_code(
    key: str, action: CompoundCreateAction
) -> None:
    """**TC-ADMIN-117.** True of all three today — and asserted rather than
    assumed, because the client must NOT derive it.

    `LinkCreateAction` had to declare its permission precisely because two of
    the six junctions gate on a parent's `.update` instead. These three happen
    to gate on `<far resource>.create`, which is a fact about the three routes
    we chose, not a rule — so it is worth pinning (a declaration that drifted
    from its route's real gate would hide or expose the button wrongly) while
    the client still reads the declared value.
    """
    fks = fk_fields_of(ALL_ENTITY_CONFIGS[key])
    far_resource = fks[action.far_field].replace("-", "_")
    assert action.permission == f"{far_resource}.create"


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_a_parent_picker_is_declared_exactly_when_one_is_needed(
    key: str, action: CompoundCreateAction
) -> None:
    """**TC-ADMIN-117.** The invariant the client derives rather than reads.

    A junction has two FKs; for a given direction the tab's own scope field is
    whichever one is *not* `far_field`. If the route's placeholder names that
    column, the tab already holds the parent and no picker is needed — and
    declaring picker metadata anyway would be a false promise of a UI step that
    never renders. If it names anything else, the picker fields are mandatory,
    or the modal renders an unlabelled `FkAutocomplete` over `undefined`.
    """
    fks = fk_fields_of(ALL_ENTITY_CONFIGS[key])
    near_field = next(name for name in fks if name != action.far_field)
    placeholder = re.findall(r"\{([a-zA-Z_]+)\}", action.path_template)[0]

    if placeholder == near_field:
        assert action.parent_entity is None
        assert action.parent_label is None
        assert action.parent_label_field is None
    else:
        assert action.parent_entity is not None
        assert action.parent_label is not None
        assert action.parent_label_field is not None


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_a_declared_parent_entity_is_a_registered_entity(
    key: str, action: CompoundCreateAction
) -> None:
    """**TC-ADMIN-117.** The picker fetches `parent_entity`'s own schema. An
    unregistered slug 404s that fetch and the modal never renders a picker at
    all.
    """
    if action.parent_entity is None:
        return
    plural_by_singular = {c.resource.replace("_", "-"): k for k, c in ALL_ENTITY_CONFIGS.items()}
    assert action.parent_entity in plural_by_singular


@pytest.mark.parametrize("key,action", _declared_actions(), ids=lambda v: getattr(v, "far_field", v))
def test_a_declared_parent_label_field_and_filters_name_real_columns(
    key: str, action: CompoundCreateAction
) -> None:
    """**TC-ADMIN-117.** `parent_label_field` must be a field the parent's
    schema actually serves, or every picker option renders blank; each
    `parent_filters` key must be a column that entity can actually be filtered
    by, or the list route `422`s and the picker is permanently empty.
    """
    if action.parent_entity is None:
        assert action.parent_filters == ()
        return

    from app.api.crud_factory import derive_filter_fields

    plural_by_singular = {c.resource.replace("_", "-"): k for k, c in ALL_ENTITY_CONFIGS.items()}
    parent_config = ALL_ENTITY_CONFIGS[plural_by_singular[action.parent_entity]]
    served = {entry["name"] for entry in derive_entity_schema(parent_config)["fields"]}

    assert action.parent_label_field in served
    for name, _value in action.parent_filters:
        assert name in derive_filter_fields(parent_config)


def test_a_parent_picker_s_scope_is_reachable_from_the_tab() -> None:
    """**TC-ADMIN-117.** The claim that makes the `Defect` direction *correct*
    rather than merely present.

    `POST /executions/{id}/defects` links the new defect to
    `execution.test_case_id`. So `links_automatically=True` is only true for
    this tab if the execution the user picks belongs to *this* test case —
    which requires `TestExecution` to be scopeable by `test_case_id`, the
    widening ADR-0078 makes. Without it the picker would offer every execution
    in reach and quietly file defects against other test cases.

    Asserted generically: for any declared parent picker, either the parent
    entity can be scoped by the tab's own scope column, or it can be scoped
    some other way the route supplies (`project_id`) — never neither.
    """
    from app.api.crud_factory import _scope_candidates

    plural_by_singular = {c.resource.replace("_", "-"): k for k, c in ALL_ENTITY_CONFIGS.items()}
    checked = 0
    for key, action in _declared_actions():
        if action.parent_entity is None:
            continue
        fks = fk_fields_of(ALL_ENTITY_CONFIGS[key])
        near_field = next(name for name in fks if name != action.far_field)
        parent_config = ALL_ENTITY_CONFIGS[plural_by_singular[action.parent_entity]]
        arms = set(_scope_candidates(parent_config))
        assert arms & ({near_field} | {"project_id"}), (
            f"{key}/{action.far_field}: parent {action.parent_entity} is scoped by {arms}, "
            f"none of which a tab scoped by {near_field} can supply"
        )
        checked += 1
    assert checked == 2, "both picker-bearing declarations must be exercised"


def test_test_execution_is_scopeable_by_test_case_id() -> None:
    """**TC-ADMIN-117.** The widening itself, pinned by name.

    The generic assertion above would still pass if `TestExecution` were merely
    `project_id`-scoped, which would satisfy "can be scoped" while silently
    reintroducing the wrong-test-case bug. This names the arm that actually
    matters, and the cycle arm beside it (declared first, so the item-route
    walk is byte-identical to its pre-widening behaviour).
    """
    from app.api.crud_factory import _scope_candidates

    assert _scope_candidates(ALL_ENTITY_CONFIGS["test-executions"]) == (
        "test_cycle_id",
        "test_case_id",
    )


# --- TC-ADMIN-117: serialization ------------------------------------------------------------


@pytest.mark.parametrize("key", sorted({k for k, _ in EXPECTED_DECLARATIONS}))
def test_derive_entity_schema_serializes_the_declaration_camel_cased(key: str) -> None:
    """**TC-ADMIN-117.** The wire shape the frontend's `CompoundCreateAction`
    interface is typed against.
    """
    served = derive_entity_schema(ALL_ENTITY_CONFIGS[key])["compoundCreates"]
    declared = ALL_ENTITY_CONFIGS[key].compound_creates
    assert len(served) == len(declared)
    for entry, action in zip(served, declared):
        assert entry == {
            "farField": action.far_field,
            "pathTemplate": action.path_template,
            "permission": action.permission,
            "linksAutomatically": action.links_automatically,
            "parentEntity": action.parent_entity,
            "parentLabel": action.parent_label,
            "parentLabelField": action.parent_label_field,
            "parentFilters": dict(action.parent_filters),
            "parentSelect": action.parent_select,
        }


def test_compound_creates_is_an_empty_list_on_every_entity_declaring_none() -> None:
    """**TC-ADMIN-117.** Always present, never omitted and never `null` —
    including on the three junctions that need none, which is why a client
    searches the list by direction instead of null-checking the key.
    """
    declaring = {k for k, _ in EXPECTED_DECLARATIONS}
    for key, config in ALL_ENTITY_CONFIGS.items():
        served = derive_entity_schema(config)["compoundCreates"]
        assert isinstance(served, list)
        if key not in declaring:
            assert served == [], key
