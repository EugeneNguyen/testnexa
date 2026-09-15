"""Unit tests for ADR-0073's RBAC-extension migration data
(`alembic/versions/3e6b08c5da71_seed_trace_link_create_permissions.py`).

Pure-Python, no DB/network — asserts the shape of the static tuples the
migration's `upgrade()` inserts and grants. The migration's *behavior*
(inserts, grants, idempotency under a real second invocation, symmetric
downgrade) lives in `tests/integration/test_adr73_link_create_permissions.py`.

Carries the **unit half of TC-ADMIN-072 and TC-ADMIN-073** — the static-shape
assertions those two rows name (the catalog delta, the backfilled reads, the
grants matching `build_role_bundles`, the revision chain); their live-database
halves are in that integration file. Stated explicitly rather than left
implicit in the sibling file's docstring, so a coverage audit grepping for
`TC-ADMIN-072` finds both files.

This is the same "pure-Python catalog shape here, real DB behavior there" split
`test_rbac_seed_catalog.py`/`test_rbac_seed.py` established for RBAC-4's own
seed and `test_admin5_seed_test_level_catalog.py` repeated for ADMIN-5's.

The load-bearing assertion is the **delta**: `_NEW_PERMISSIONS` must be exactly
what `build_permission_catalog()` gained, derived from
`rbac_seed_catalog.LINK_CREATE_RESOURCES` rather than re-typed. A migration
whose hardcoded tuple drifts from the catalog produces two databases that
disagree depending on whether they were seeded fresh or backfilled — the
failure mode `7d2c91af4e68` (ADR-0072) introduced this same assertion to
prevent, generalized here.

The migration file is loaded via `importlib` (not a normal `import`) since
alembic revision filenames aren't valid Python module identifiers.
"""

import importlib.util
from pathlib import Path

from app.db.rbac_seed_catalog import (
    LINK_CREATE_RESOURCES,
    build_permission_catalog,
    build_role_bundles,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "3e6b08c5da71_seed_trace_link_create_permissions.py"
)
_spec = importlib.util.spec_from_file_location("adr73_seed_migration_unit", _MIGRATION_PATH)
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)


def test_new_permissions_is_exactly_the_catalog_delta_this_adr_introduces() -> None:
    """Derived, never re-typed — see this module's docstring for why."""
    expected = {(f"{resource}.create", resource, "create") for resource in LINK_CREATE_RESOURCES}
    assert set(_migration._NEW_PERMISSIONS) == expected
    assert len(_migration._NEW_PERMISSIONS) == 4


def test_every_new_code_exists_in_the_catalog_the_fresh_seed_builds() -> None:
    """A fresh DB seeds from `build_permission_catalog()`; a pre-ADR-0073 DB
    seeds from this migration. Both paths must land on the same set, or the
    two kinds of database diverge permanently."""
    codes = {code for code, _, _ in build_permission_catalog()}
    for code in _migration._NEW_CODES:
        assert code in codes, code


def test_the_three_backfilled_reads_are_codes_test_manager_lacked_before_this_adr() -> None:
    """These are *pre-existing* codes, granted (not created) by this migration.

    They must (a) already be in the catalog — this migration never inserts
    them — and (b) be exactly the link `.read` codes `test_manager`'s bundle
    now holds minus the one it held before (`test_case_defect_link.read`,
    ADR-0044). Getting this wrong in either direction ships a role that can
    write a link it cannot see the tab for.
    """
    codes = {code for code, _, _ in build_permission_catalog()}
    for code in _migration._TEST_MANAGER_BACKFILL_READS:
        assert code in codes, code
        assert code.endswith(".read")
        assert code not in _migration._NEW_CODES, "a backfilled read must not also be inserted"

    all_link_reads = {f"{resource}.read" for resource in LINK_CREATE_RESOURCES}
    assert set(_migration._TEST_MANAGER_BACKFILL_READS) == all_link_reads - {"test_case_defect_link.read"}


def test_grants_match_the_static_bundle_definitions_exactly() -> None:
    """The whole point of a backfill migration: a database seeded *before* this
    ADR must end up holding exactly what `build_role_bundles` would have given
    a database seeded *after* it. Asserted per role against the real bundles,
    so an edit to either side alone fails here.
    """
    bundles = build_role_bundles({code for code, _, _ in build_permission_catalog()})
    for role_name, codes in _migration._GRANTS.items():
        assert set(codes) <= bundles[role_name], (role_name, sorted(set(codes) - bundles[role_name]))

    # ...and the reverse, for the codes this migration is responsible for: any
    # role whose *static* bundle contains a new code must appear in `_GRANTS`,
    # or that role silently never gets it on an existing database.
    granted_here = set(_migration._GRANTS)
    for role_name, bundle in bundles.items():
        if bundle & set(_migration._NEW_CODES):
            assert role_name in granted_here, f"{role_name} holds a new code statically but is never backfilled"


def test_auditor_and_ai_agent_scoped_are_deliberately_not_granted() -> None:
    """`auditor` is read-only by definition and ADR-0073 adds only writes;
    `ai_agent_scoped` reaches none of the linked entities. Pinned so that
    adding either one later is a deliberate test edit, not a silent widening.
    """
    assert "auditor" not in _migration._GRANTS
    assert "ai_agent_scoped" not in _migration._GRANTS

    bundles = build_role_bundles({code for code, _, _ in build_permission_catalog()})
    assert not (bundles["auditor"] & set(_migration._NEW_CODES))
    assert not (bundles["ai_agent_scoped"] & set(_migration._NEW_CODES))


def test_tester_gets_only_the_defect_link_create() -> None:
    """ADR-0073's one restraint decision, asserted rather than left in prose:
    `tester` already holds `test_case_defect_link.read` and full `defect`
    create/read/update, so that one write is a workflow it performs; the three
    requirement-level links belong to `test_manager`'s persona.
    """
    assert _migration._GRANTS["tester"] == ("test_case_defect_link.create",)


def test_revision_chain_points_at_the_head_this_migration_was_written_against() -> None:
    assert _migration.revision == "3e6b08c5da71"
    assert _migration.down_revision == "7d2c91af4e68"
