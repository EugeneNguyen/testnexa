"""Unit tests for ADR-0077's RBAC-extension migration data
(`alembic/versions/8c1d5a7b93e2_seed_trace_link_delete_permissions.py`).

Pure-Python, no DB/network — asserts the shape of the static tuples the
migration's `upgrade()` inserts and grants. The migration's *behavior*
(inserts, grants, idempotency under a real second invocation, symmetric
downgrade) lives in `tests/integration/test_adr77_link_delete_permissions.py`.

Carries the **unit half of TC-ADMIN-103** — the static-shape assertions that
row names; its live-database half is in that integration file. Stated
explicitly rather than left implicit, so a coverage audit grepping for
`TC-ADMIN-103` finds both files.

The same "pure-Python catalog shape here, real DB behavior there" split
`test_rbac_seed_catalog.py`/`test_rbac_seed.py` established for RBAC-4's own
seed, and `test_adr76_seed_trace_link_create_permissions.py` repeated for the
sibling migration this one mirrors.

The load-bearing assertion is the **delta**: `_NEW_PERMISSIONS` must be exactly
what `build_permission_catalog()` gained, derived from
`rbac_seed_catalog.LINK_DELETE_RESOURCES` rather than re-typed. A migration
whose hardcoded tuple drifts from the catalog produces two databases that
disagree depending on whether they were seeded fresh or backfilled.

The migration file is loaded via `importlib` (not a normal `import`) since
alembic revision filenames aren't valid Python module identifiers.
"""

import importlib.util
from pathlib import Path

from app.db.rbac_seed_catalog import (
    LINK_DELETE_RESOURCES,
    build_permission_catalog,
    build_role_bundles,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "8c1d5a7b93e2_seed_trace_link_delete_permissions.py"
)
_spec = importlib.util.spec_from_file_location("adr77_seed_migration_unit", _MIGRATION_PATH)
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)


def test_new_permissions_is_exactly_the_catalog_delta_this_adr_introduces() -> None:  # TC-ADMIN-103
    """Derived, never re-typed — see this module's docstring for why."""
    expected = {(f"{resource}.delete", resource, "delete") for resource in LINK_DELETE_RESOURCES}
    assert set(_migration._NEW_PERMISSIONS) == expected
    assert len(_migration._NEW_PERMISSIONS) == 4


def test_every_new_code_exists_in_the_catalog_the_fresh_seed_builds() -> None:  # TC-ADMIN-103
    """A fresh DB seeds from `build_permission_catalog()`; a pre-ADR-0077 DB
    seeds from this migration. Both paths must land on the same set, or the two
    kinds of database diverge permanently."""
    codes = {code for code, _, _ in build_permission_catalog()}
    for code in _migration._NEW_CODES:
        assert code in codes, code


def test_this_migration_backfills_no_pre_existing_code() -> None:  # TC-ADMIN-103
    """The one structural difference from `3e6b08c5da71`, asserted rather than
    left in prose.

    Its sibling had to grant `test_manager` three **pre-existing** `.read`
    codes alongside its four new ones, which is why that migration's
    `downgrade()` is asymmetric (it revokes those grants but must not delete
    catalog rows that predate it). This one grants nothing it does not also
    create, which is exactly what licenses its own symmetric `downgrade()` — so
    if a future edit adds a backfill here, this test fails and the downgrade's
    asymmetry has to be reconsidered deliberately.
    """
    granted = {code for codes in _migration._GRANTS.values() for code in codes}
    assert granted <= set(_migration._NEW_CODES), sorted(granted - set(_migration._NEW_CODES))
    # And every code it creates is granted to somebody, so `_NEW_PERMISSIONS`
    # cannot quietly mint a permission no role can ever hold.
    assert granted == set(_migration._NEW_CODES)


def test_grants_match_the_static_bundle_definitions_exactly() -> None:  # TC-ADMIN-103
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


def test_auditor_and_ai_agent_scoped_are_deliberately_not_granted() -> None:  # TC-ADMIN-103
    """`auditor` is read-only by definition and ADR-0077 adds only writes;
    `ai_agent_scoped` reaches none of the linked entities. Pinned so that
    adding either one later is a deliberate test edit, not a silent widening.
    """
    assert "auditor" not in _migration._GRANTS
    assert "ai_agent_scoped" not in _migration._GRANTS

    bundles = build_role_bundles({code for code, _, _ in build_permission_catalog()})
    assert not (bundles["auditor"] & set(_migration._NEW_CODES))
    assert not (bundles["ai_agent_scoped"] & set(_migration._NEW_CODES))


def test_test_manager_gets_all_four_link_deletes() -> None:  # TC-ADMIN-103
    """ADR-0077 Decision §3, symmetric with ADR-0076's four creates: the role
    holding `requirement.export_rtm` is the one accountable for the matrix
    being correct, and a matrix it can only grow is one it can only make more
    wrong."""
    assert set(_migration._GRANTS["test_manager"]) == set(_migration._NEW_CODES)


def test_tester_gets_only_the_defect_link_delete() -> None:  # TC-ADMIN-103
    """ADR-0077's one restraint decision, asserted rather than left in prose —
    and it mirrors ADR-0076's exactly: the unlink `tester` gets is the literal
    undo of the one link it may create, and the three requirement-level links
    stay with `test_manager`'s persona.
    """
    assert _migration._GRANTS["tester"] == ("test_case_defect_link.delete",)


def test_revision_chain_points_at_the_head_this_migration_was_written_against() -> None:
    assert _migration.revision == "8c1d5a7b93e2"
    assert _migration.down_revision == "3e6b08c5da71"
