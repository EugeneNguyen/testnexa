"""ADR-0076 — `LinkCreateAction` completeness and shape (TC-ADMIN-080, TC-ADMIN-081).

Pure-Python, no DB/network. The risk this file exists to close is the same
"degrades silently" shape `backend/CLAUDE.md`'s registry-completeness note
describes and ADR-0075 hit for real: a junction entity that ships **without**
a `link_create` declaration renders a relationship tab that lists rows and
offers no way to add one — no error, no 403, just a missing button nobody
notices until someone tries to use the feature.

Two things are asserted, and they are different claims:

1. **Completeness** — every link entity in the registry declares one, and
   nothing else does. A *partition*, in both directions, not a spot check.
2. **Internal consistency** — each declaration's `path_template` placeholders
   are exactly that entity's own two FK field names, and its `permission` is a
   code the RBAC catalog actually contains. A declaration that type-checks but
   names a field the entity doesn't have would build a URL with a literal
   brace in it at runtime; one naming a nonexistent permission code would
   hide the button from everybody forever.

Per ADR-0075's own lesson (`backend/CLAUDE.md`: "a completeness test that
enumerates the same set as the thing it checks passes vacuously"), the
completeness checker takes its collection as a parameter and is
**mutation-tested in-suite** — a deliberately-broken registry is fed through
the same function and asserted to report the exact expected gap, so "no gaps"
and "the checker cannot see gaps" are distinguishable results rather than the
same empty set.

The oracle for *which* entities are link entities is `is_link_entity`, which
is computed structurally from each config's own FK count and method set — not
a hand-typed list. Registry membership itself is guarded one level down, at
the model layer, by `test_adr75_registry_completeness.py`.
"""

from __future__ import annotations

import re

import pytest

from app.api.crud_factory import (
    CrudEntityConfig,
    LinkCreateAction,
    NoSchema,
    chain_resolver,
    derive_entity_schema,
    fk_fields_of,
    is_link_entity,
)
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.db.rbac_seed_catalog import LINK_CREATE_RESOURCES, build_permission_catalog

_PLACEHOLDER = re.compile(r"\{([a-zA-Z_]+)\}")

#: The six junctions, and the permission each one's link-create route gates on.
#: Hand-written on purpose — this is the *expected* answer, and deriving it
#: from the configs is what the code under test already does. The two REQ-4/
#: PLAN-1 rows are the interesting ones: their routes predate ADR-0076 and keep
#: their original parent-`update` gate rather than getting a `.create` code.
EXPECTED_PERMISSIONS: dict[str, str] = {
    "requirement-test-case-links": "requirement_test_case_link.create",
    "requirement-test-condition-links": "requirement_test_condition_link.create",
    "test-condition-test-case-links": "test_condition_test_case_link.create",
    "test-case-defect-links": "test_case_defect_link.create",
    "test-suite-test-cases": "test_suite.update",
    "test-plan-test-suites": "test_plan.update",
}


def missing_link_create(configs: dict[str, CrudEntityConfig]) -> set[str]:
    """Registry keys that are link entities but declare no `link_create`.

    Takes `configs` as a parameter specifically so the mutation test below can
    hand it a deliberately-broken registry — a checker hard-wired to the real
    one can only ever report the answer it was written against.
    """
    return {key for key, config in configs.items() if is_link_entity(config) and config.link_create is None}


def spurious_link_create(configs: dict[str, CrudEntityConfig]) -> set[str]:
    """Registry keys declaring a `link_create` without being link entities.

    The other half of the partition. A non-link entity with one would advertise
    a "Link existing ..." action on a tab whose rows are not link rows, so the
    action would have no far id to send.
    """
    return {key for key, config in configs.items() if config.link_create is not None and not is_link_entity(config)}


def _fake_link_config(resource: str, *, with_action: bool) -> CrudEntityConfig:
    """A structurally-valid link entity (2 FK fields, no create/update), for the
    mutation test. Not registered anywhere — built and thrown away here."""
    from pydantic import BaseModel

    class _Summary(BaseModel):
        left_id: str
        right_id: str

    from app.api.crud_factory import FieldMeta

    return CrudEntityConfig(
        model=ALL_ENTITY_CONFIGS["requirement-test-case-links"].model,
        resource=resource,
        create_schema=None,
        update_schema=NoSchema,
        summary_schema=_Summary,
        scope_field=("left_id", "right_id"),
        resolve_org_id=chain_resolver([]),
        methods=frozenset({"list", "get"}),
        field_meta={
            "left_id": FieldMeta(ref_entity="requirement"),
            "right_id": FieldMeta(ref_entity="test-case"),
        },
        link_create=LinkCreateAction(path_template="/x/{left_id}/y/{right_id}", permission="x.create")
        if with_action
        else None,
    )


# --- TC-ADMIN-080: completeness, both directions --------------------------------------------


def test_every_link_entity_declares_a_link_create_action() -> None:
    assert missing_link_create(ALL_ENTITY_CONFIGS) == set()


def test_no_non_link_entity_declares_a_link_create_action() -> None:
    assert spurious_link_create(ALL_ENTITY_CONFIGS) == set()


def test_the_link_entities_are_exactly_the_six_junctions() -> None:
    """Pins the *size* of the partition, so the two assertions above cannot
    both pass by the registry having lost every link entity."""
    link_keys = {key for key, config in ALL_ENTITY_CONFIGS.items() if is_link_entity(config)}
    assert link_keys == set(EXPECTED_PERMISSIONS)
    assert len(link_keys) == 6


def test_the_completeness_checker_actually_sees_a_gap() -> None:
    """In-suite mutation check (ADR-0075's own lesson, `backend/CLAUDE.md`).

    A partition asserted against a fixed codebase has never been observed to
    fail, so nothing otherwise distinguishes "correct" from "structurally
    incapable of failing". Feed the same function a registry with one link
    entity's declaration removed and assert it names exactly that entity — and
    assert the real registry reports nothing in the same test, so the two
    results differ for a reason rather than both being empty.
    """
    broken = dict(ALL_ENTITY_CONFIGS)
    broken["synthetic-links"] = _fake_link_config("synthetic_link", with_action=False)

    assert missing_link_create(broken) == {"synthetic-links"}
    assert missing_link_create(ALL_ENTITY_CONFIGS) == set()


def test_the_spurious_checker_actually_sees_a_gap() -> None:
    """Mirror mutation check for the other direction: a config carrying a
    declaration while *not* classifying as a link entity (here, because it
    registers `create`) must be reported."""
    config = _fake_link_config("synthetic_writable", with_action=True)
    writable = CrudEntityConfig(**{**config.__dict__, "methods": frozenset({"list", "get", "create"})})
    assert not is_link_entity(writable)

    broken = dict(ALL_ENTITY_CONFIGS)
    broken["synthetic-writables"] = writable

    assert spurious_link_create(broken) == {"synthetic-writables"}
    assert spurious_link_create(ALL_ENTITY_CONFIGS) == set()


# --- TC-ADMIN-081: each declaration is internally consistent --------------------------------


@pytest.mark.parametrize("key", sorted(EXPECTED_PERMISSIONS))
def test_path_template_placeholders_are_exactly_the_entity_s_own_two_fks(key: str) -> None:
    """The whole substitution contract.

    `entityCrud.interpolateLinkPath` fills `{field}` from a map keyed by the
    link row's own FK names, which a relationship tab builds from
    `relation.scopeField` + `relation.targetField` — both of which come from
    `fk_fields_of` on the same config. A placeholder naming anything else can
    never be filled.
    """
    config = ALL_ENTITY_CONFIGS[key]
    placeholders = _PLACEHOLDER.findall(config.link_create.path_template)

    assert set(placeholders) == set(fk_fields_of(config))
    assert len(placeholders) == 2, "each id must appear exactly once"


@pytest.mark.parametrize("key", sorted(EXPECTED_PERMISSIONS))
def test_path_template_is_an_absolute_api_path_with_no_api_prefix(key: str) -> None:
    """`createLinkRow` prepends `/api/v1`, exactly as every other call in
    `lib/api/entityCrud.ts` does — a template carrying its own prefix would
    produce `/api/v1/api/v1/...`, the double-prefix trap `backend/CLAUDE.md`
    documents for `TEST_API_BASE_URL`."""
    template = ALL_ENTITY_CONFIGS[key].link_create.path_template
    assert template.startswith("/")
    assert not template.startswith("/api")


@pytest.mark.parametrize(("key", "expected"), sorted(EXPECTED_PERMISSIONS.items()))
def test_each_declaration_names_the_permission_its_route_actually_gates_on(key: str, expected: str) -> None:
    assert ALL_ENTITY_CONFIGS[key].link_create.permission == expected


@pytest.mark.parametrize("key", sorted(EXPECTED_PERMISSIONS))
def test_every_declared_permission_code_exists_in_the_rbac_catalog(key: str) -> None:
    """A code no `Permission` row backs can never be granted, so
    `usePermissions.has()` returns `false` for everyone and the button is
    invisible to every role including `org_admin` — a silent, total outage of
    the feature with no error anywhere."""
    codes = {code for code, _, _ in build_permission_catalog()}
    assert ALL_ENTITY_CONFIGS[key].link_create.permission in codes


def test_only_the_four_new_routes_gate_on_their_own_resource_create_code() -> None:
    """ADR-0076 introduces four `.create` codes and re-gates nothing.

    The two REQ-4/PLAN-1 junctions keep the parent-`update` gate their routes
    shipped with under ADR-0030/ADR-0031. Asserted here as well as in
    `test_rbac_seed_catalog.py` because this is the file a reader lands in when
    asking "why don't all six behave the same way".
    """
    for key, config in ALL_ENTITY_CONFIGS.items():
        if not is_link_entity(config):
            continue
        own_create = f"{config.resource}.create"
        if config.resource in LINK_CREATE_RESOURCES:
            assert config.link_create.permission == own_create, key
        else:
            assert config.link_create.permission != own_create, key
            assert config.link_create.permission.endswith(".update"), key


# --- TC-ADMIN-081: it reaches the wire ------------------------------------------------------


@pytest.mark.parametrize("key", sorted(EXPECTED_PERMISSIONS))
def test_derive_entity_schema_serializes_the_declaration_camel_cased(key: str) -> None:
    config = ALL_ENTITY_CONFIGS[key]
    assert derive_entity_schema(config)["linkCreate"] == {
        "pathTemplate": config.link_create.path_template,
        "permission": config.link_create.permission,
    }


def test_link_create_is_null_on_every_non_link_entity_s_schema() -> None:
    """Always present, never omitted — `toEntityConfig` distinguishes
    "no link action" from "an older backend" by the key's *value*, so the key
    itself must be unconditional."""
    for key, config in ALL_ENTITY_CONFIGS.items():
        schema = derive_entity_schema(config)
        assert "linkCreate" in schema, key
        if not is_link_entity(config):
            assert schema["linkCreate"] is None, key
