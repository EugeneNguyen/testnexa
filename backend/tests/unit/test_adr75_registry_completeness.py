"""ADR-0075: the completeness guard one level below ADR-0074's.

**Why this file exists, and why `test_adr74_entity_relations.py` could not be
where it lives.** That file's `TestInboundFkCompleteness` partitions "every
inbound FK in the whole registry" into served-or-excluded, and asserts the
partition is total. It is a genuinely good test, and it was still blind to a
real, shipped gap — because it enumerates `ALL_ENTITY_CONFIGS`, which is
*exactly the set the derivation it checks also enumerates*. A model with no
config in that registry contributes no FK to either side of the partition, so
the partition holds **vacuously** while that model's relationships silently
render no relationship tab at all.

That is not a hypothetical. `TestSuiteTestCase` (REQ-4) and `TestPlanTestSuite`
(PLAN-1) are genuine many-to-many join tables, populated in production by their
own bespoke membership routes, and `GET /entities/test-suites/schema` returned
`"relations": []` — an entirely empty relationship strip on `TestSuite`'s detail
page — with every assertion in that file green.

ADR-0074 Decision §1's reasoning ("the set is **computed** by walking
`ALL_ENTITY_CONFIGS`, never hand-authored... a derivation cannot omit what it
enumerates") is sound as far as it goes. What it does not cover is **the set
being enumerated**: `entity_registry._ALL_CONFIGS` is a hand-typed tuple, which
makes it precisely the kind of registry `backend/CLAUDE.md`'s
registry-completeness note (ADR-0068/MCP-5) warns about — "a registry built by
hand-declaring rows can silently omit one entity, and nothing about
spot-checking a handful would ever notice; the only test that catches this is a
**diff**."

So this file diffs against something that is *not* hand-authored: SQLAlchemy's
own `Base.metadata`, which every model registers itself into by declaration. A
new model cannot be forgotten here the way a registry row can, because adding
the model *is* adding the metadata entry.

**The rule it enforces.** Every table with a foreign key pointing into a
registered entity's table must either (a) be a registered entity itself, or
(b) appear in `EXPECTED_UNREGISTERED_CHILDREN` below with a stated reason.
Never neither. An unregistered child is not automatically a bug — `Release`'s
absence is a deliberate, ADR-documented decision — but it must be a *decision*,
recorded next to the thing it affects, rather than an oversight nothing
observes.
"""

from collections.abc import Mapping

import pytest
from sqlalchemy import Table

import app.models  # noqa: F401  — import for its side effect: every model registers into Base.metadata
from app.api.crud_factory import fk_fields_of, is_link_entity
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.db.base import Base

#: `{table_name: config_key}` for every entity the generic-CRUD registry serves.
REGISTERED_TABLES: dict[str, str] = {
    config.model.__tablename__: key for key, config in ALL_ENTITY_CONFIGS.items()
}

#: Columns every table in this schema carries, which therefore say nothing about
#: whether a table is a pure junction (`app/db/base.py`'s own column factories).
_BOOKKEEPING_COLUMNS = frozenset({"id", "created_at", "updated_at"})


#: Tables with a foreign key into a registered entity that deliberately have no
#: `CrudEntityConfig` of their own — each with the reason, and each a decision
#: rather than an oversight.
#:
#: A row here is a claim that the absence is intentional *today*. It is not a
#: permanent exemption: three of the five name a concrete condition under which
#: the entry should be removed and a config added instead.
EXPECTED_UNREGISTERED_CHILDREN: dict[str, str] = {
    # ADR-0027: create/list are 100% bespoke (`POST`/`GET
    # /projects/{id}/releases`), never registered through the ADR-0022 factory,
    # and `entity_registry`'s own docstring says so. The frontend keeps a
    # hand-written `STATIC_ENTITY_CONFIGS["releases"]` for exactly this reason.
    # Consequence, asserted below: `Project` has no "Releases" relationship tab.
    "release": "ADR-0027: 100% bespoke create/list, deliberately no CrudEntityConfig",
    # Bespoke approval routes in `app/api/routes/governance.py`. `approval` has
    # its own payload columns (`role`, `approved_at`, `approved_by_user_id`), so
    # it is an ordinary one-to-many child of `TestPlan`, not a junction — and
    # registering it would be a new admin-surface entity (nav entry, list page,
    # permission-gated create), which is its own product decision. Flagged by
    # ADR-0075's audit, not fixed by it.
    "approval": "bespoke approval routes (governance.py); registering it is a new admin entity decision",
    # Bespoke invite routes in `app/api/routes/org_memberships.py`. Carries a
    # `token_hash` — a credential secret — so exposing it through a generic
    # read surface is a security decision, not a completeness chore.
    "invite": "bespoke invite routes; carries token_hash, generic read is a security decision",
    # A genuine junction, and the RBAC grant graph itself. Not registered
    # because: (a) exposing which permission codes each role holds is a
    # security-surface decision needing its own story, and (b) the 5 system
    # roles carry `org_id IS NULL`, so a tenant resolver for it would need the
    # `is_global_catalog`/`global_read_fallback` path rather than a plain
    # `chain_resolver` — real design, not a copy of trace.py's template.
    # Consequence: `Role` has no "Permissions (linked)" tab.
    "role_permission": "RBAC grant graph: security-surface decision + system roles are org_id IS NULL",
    # A genuine junction whose relationship has **no implementation anywhere**:
    # zero references outside `app/models/taxonomy.py`, `app/models/__init__.py`
    # and the initial migration — no route, no query, no UI, no MCP tool writes
    # or reads it, so no row can ever exist. Registering it would ship a
    # permanently-empty "Test design techniques (linked)" tab advertising an
    # ADMIN-1-era feature that was never built. The right order is to build the
    # write path first; the tab then appears for free, which is the property
    # ADR-0074/ADR-0075 exist to buy.
    "test_case_test_design_technique": "relationship unimplemented (no route/query/UI); a config would ship an always-empty tab",
}


def _fk_targets(table: Table) -> dict[str, str]:
    """`{column_name: target_table_name}` for every FK column of `table`."""
    return {
        column.name: next(iter(column.foreign_keys)).column.table.name
        for column in table.columns
        if column.foreign_keys
    }


def _children_of_registered_entities(
    registered_tables: Mapping[str, str] | None = None,
) -> dict[str, dict[str, str]]:
    """Every table holding an FK into a registered entity's table.

    `registered_tables` defaults to the real registry. The parameter exists so
    the mutation test below can inject a *reduced* one and prove this partition
    actually fails when an entity goes missing — a completeness assertion that
    has never been observed to fail is exactly the artifact ADR-0075 exists to
    warn about (ADR-0074's own partition was green throughout the defect).
    """
    registered = REGISTERED_TABLES if registered_tables is None else registered_tables
    out: dict[str, dict[str, str]] = {}
    for table_name, table in Base.metadata.tables.items():
        inbound = {
            column: target for column, target in _fk_targets(table).items() if target in registered
        }
        if inbound:
            out[table_name] = inbound
    return out


def _unclassified(registered_tables: Mapping[str, str], declared: Mapping[str, str]) -> set[str]:
    """Tables that are neither registered nor declared — the partition's own gap set."""
    return {
        table_name
        for table_name in _children_of_registered_entities(registered_tables)
        if table_name not in registered_tables and table_name not in declared
    }


def _is_junction_shaped(table: Table) -> bool:
    """Exactly two FK columns and no payload of its own.

    The same structural test `crud_factory.is_link_entity` applies to a
    *config*, restated against a *table* — deliberately, because the config-level
    one can only see tables that already have a config, which is the blind spot
    this file exists to cover.
    """
    fks = set(_fk_targets(table))
    payload = {c.name for c in table.columns} - fks - _BOOKKEEPING_COLUMNS
    return len(fks) == 2 and not payload


class TestModelLayerCompleteness:
    """**TC-ADMIN-074.** The diff that `test_adr74_entity_relations.py`'s own partition cannot
    perform, because it runs against the registry rather than the schema."""

    def test_every_child_of_a_registered_entity_is_registered_or_declared(self) -> None:
        unclassified = {
            table_name: inbound
            for table_name, inbound in _children_of_registered_entities().items()
            if table_name not in REGISTERED_TABLES and table_name not in EXPECTED_UNREGISTERED_CHILDREN
        }
        assert unclassified == {}, (
            "These tables hold a foreign key into a registered entity but have no "
            "CrudEntityConfig, so ADR-0074's relationship derivation cannot see them "
            "and the parent entity silently renders no tab for them. Either register "
            "the entity in app/api/entity_registry.py, or add it to "
            f"EXPECTED_UNREGISTERED_CHILDREN with the reason: {sorted(unclassified)}"
        )

    def test_no_declared_exclusion_is_actually_registered(self) -> None:
        """The other direction: a stale row here is a comment claiming a gap
        that has since been closed."""
        stale = set(EXPECTED_UNREGISTERED_CHILDREN) & set(REGISTERED_TABLES)
        assert stale == set(), f"EXPECTED_UNREGISTERED_CHILDREN names registered entities: {sorted(stale)}"

    def test_every_declared_exclusion_names_a_real_child_table(self) -> None:
        unknown = set(EXPECTED_UNREGISTERED_CHILDREN) - set(_children_of_registered_entities())
        assert unknown == set(), (
            "EXPECTED_UNREGISTERED_CHILDREN names tables that either do not exist or hold "
            f"no FK into a registered entity: {sorted(unknown)}"
        )

    def test_every_declared_exclusion_gives_a_real_reason(self) -> None:
        """A bare `""` or a placeholder would make this table a rubber stamp."""
        for table_name, reason in EXPECTED_UNREGISTERED_CHILDREN.items():
            assert len(reason) > 30, f"{table_name}'s exclusion reason is too thin to audit: {reason!r}"

    def test_the_partition_actually_fails_when_an_entity_goes_missing(self) -> None:
        """**TC-ADMIN-074** (mutation half). The assertion this whole file rests on, applied to the file itself.

        ADR-0074's completeness test was green for the entire life of the
        defect, so "the completeness test passes" is demonstrably not evidence
        that a completeness test *works*. This reproduces the exact ADR-0075
        defect in-process — the registry with the two junction configs removed —
        and asserts the partition above reports precisely those two tables as
        unclassified.

        Injecting a reduced registry rather than monkeypatching the real one
        keeps this a pure function call: nothing global is mutated, so it cannot
        leak into another test the way a patched module-level dict could.
        """
        pre_adr75_registry = {
            table: key
            for table, key in REGISTERED_TABLES.items()
            if table not in {"test_suite_test_case", "test_plan_test_suite"}
        }
        # Sanity: the mutation actually removed something, so a future rename
        # cannot turn this test into a no-op against an unchanged registry.
        assert len(pre_adr75_registry) == len(REGISTERED_TABLES) - 2

        assert _unclassified(pre_adr75_registry, EXPECTED_UNREGISTERED_CHILDREN) == {
            "test_suite_test_case",
            "test_plan_test_suite",
        }
        # ...and the real registry leaves nothing unclassified, so the two
        # results differ for the right reason rather than both being empty.
        assert _unclassified(REGISTERED_TABLES, EXPECTED_UNREGISTERED_CHILDREN) == set()


class TestJunctionTablesSpecifically:
    """The narrower, sharper half: a *junction* table missing a config is always
    a missing many-to-many relationship on two entities at once, whereas an
    unregistered one-to-many child costs one tab on one entity."""

    @staticmethod
    def _junction_tables() -> set[str]:
        return {
            name for name, table in Base.metadata.tables.items() if _is_junction_shaped(table)
        }

    def test_the_schema_has_exactly_the_eight_junction_tables_we_think_it_does(self) -> None:
        """**TC-ADMIN-074** (anchor half). A literal anchor, so a *new* junction table added by a future
        story fails here loudly instead of joining the registry silently. Every
        other assertion in this file is a derived diff; this one catches the two
        derivations drifting together."""
        assert self._junction_tables() == {
            # ADR-0005's four traceability links — registered since ADR-0025.
            "requirement_test_case_link",
            "requirement_test_condition_link",
            "test_condition_test_case_link",
            "test_case_defect_link",
            # REQ-4 / PLAN-1 — registered by ADR-0075, the gap this story closed.
            "test_suite_test_case",
            "test_plan_test_suite",
            # Deliberately unregistered — see EXPECTED_UNREGISTERED_CHILDREN.
            "role_permission",
            "test_case_test_design_technique",
        }

    def test_every_registered_junction_table_is_classified_as_a_link_entity(self) -> None:
        """A junction table with a config but without `FieldMeta(ref_entity=...)`
        on *both* FKs has zero FK fields as far as `fk_fields_of` is concerned,
        so `is_link_entity` returns `False` and it produces no many-to-many
        relation — degrading silently, with nothing else failing. This is the
        assertion that catches that omission."""
        for table_name, key in REGISTERED_TABLES.items():
            if not _is_junction_shaped(Base.metadata.tables[table_name]):
                continue
            config = ALL_ENTITY_CONFIGS[key]
            assert len(fk_fields_of(config)) == 2, (
                f"{key} is a junction table but its config declares "
                f"{len(fk_fields_of(config))} FK field(s) — both FKs need "
                "FieldMeta(ref_entity=...) or no relationship tab is derived"
            )
            assert is_link_entity(config), f"{key} is a junction table but is not classified as one"

    @pytest.mark.parametrize(
        ("parent_key", "table_name"),
        [
            ("roles", "role_permission"),
            ("permissions", "role_permission"),
            ("test-design-techniques", "test_case_test_design_technique"),
            ("projects", "release"),
            ("test-plans", "approval"),
            ("org-memberships", "invite"),
        ],
    )
    def test_a_declared_exclusion_really_does_cost_its_parent_a_tab(
        self, parent_key: str, table_name: str
    ) -> None:
        """Makes the *consequence* of each exclusion explicit rather than
        implied. These parents genuinely have a related-record set a user might
        expect to see and genuinely do not get a tab for it — asserted so the
        cost is visible in the test suite instead of only in the ADR's prose,
        and so that closing one of these gaps forces this row to be removed
        deliberately."""
        from app.api.crud_factory import derive_entity_relations

        assert table_name in EXPECTED_UNREGISTERED_CHILDREN
        relations = derive_entity_relations(ALL_ENTITY_CONFIGS[parent_key], ALL_ENTITY_CONFIGS)
        assert all(relation["entity"] != table_name.replace("_", "-") for relation in relations)
