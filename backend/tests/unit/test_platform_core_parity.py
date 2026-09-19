"""ADR-0094 (Stage A): enforced parity between TestNexa's generic layer and the
`platform-core` submodule, in place of a destructive file-for-file copy.

Why this file exists instead of a swap
-------------------------------------
Stage A's brief was "replace TestNexa's own backend auth/org/RBAC/CRUD-factory
code with platform-core's, without regressing." Measured empirically (ADR-0094's
Context), platform-core's copies of those files are TestNexa's own files with
product-specific references stripped from comments — 28 of the 38 shared files
are *code-identical* once docstrings and comments are normalized away, and every
one of the remaining 10 diverges only in a direction where TestNexa is ahead or
where a confirmed product decision says TestNexa's version wins. A copy would
therefore have been a no-op on 28 files and a regression on 10, so there was no
non-regressing swap to perform.

What actually protects the "one canonical generic layer" intent is a *guard*:
if platform-core ever gains a real fix, or TestNexa drifts further, this test
fails and the divergence has to be either adopted or declared. That is the
durable mechanism the swap was reaching for.

Design notes (both from `backend/CLAUDE.md`'s own completeness-test rules)
-------------------------------------------------------------------------
* **The oracle is not a hand-typed file list.** The set under test is computed
  as the *intersection of the two source trees* (`_shared_relpaths`), so a file
  added to platform-core that TestNexa also has is covered automatically — there
  is no separate step to forget, the property ADR-0075 requires of a
  completeness check.
* **The checker is parameterizable, so the suite can mutation-check it.**
  `test_parity_checker_is_not_vacuous` injects a deliberately-diverged pair and
  asserts the exact expected gap is reported, while the real run reports none —
  the two results differ for a reason rather than both being trivially empty.

This module deliberately **never imports** platform-core's `app` package. Both
repos root their package at the literal name `app`, so importing one shadows the
other depending on `sys.path` order — the concrete blocker that keeps Stage B
(consuming platform-core as a library) from being possible today. Everything
here reads files as text.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

_BACKEND = pathlib.Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND.parent
_TN_APP = _BACKEND / "app"
_PC_APP = _REPO_ROOT / "platform-core" / "backend" / "app"


# Every file whose *code* legitimately differs, with the reason. A file that
# diverges without an entry here fails; an entry that no longer diverges also
# fails, so a divergence resolved upstream can't leave a stale exemption behind.
DECLARED_DIVERGENCES: dict[str, str] = {
    "api/crud_factory.py": (
        "TestNexa adds 4 domain resolvers (resolve_test_case_org_id, "
        "resolve_test_case_project_id, resolve_via_test_case, "
        "resolve_risk_item_org_id) plus the domain model imports they need. "
        "platform-core's generic engine is otherwise byte-identical. Its own "
        "__all__ still names 3 placeholder resolvers it does not define "
        "(resolve_risk_note_org_id/resolve_item_org_id/resolve_via_item) — "
        "see platform-core-backport/0001-*.patch."
    ),
    "api/entity_registry.py": (
        "TestNexa registers 29 entity configs; platform-core registers the 6 "
        "generic ones. Same derivation mechanism, different domain inventory."
    ),
    "api/routes/projects.py": (
        "Creator auto-grant role name: TestNexa grants 'test_manager' (its own "
        "seeded catalog), platform-core grants its generic 'project_owner'. "
        "Stage A confirmed decision 2 — keep TestNexa's catalog."
    ),
    "core/config.py": (
        "Deployment defaults (DATABASE_URL database name, APP_BASE_URL port) "
        "plus TestNexa's 3 ATTACHMENT_* settings, which have no generic "
        "equivalent."
    ),
    "core/rbac.py": (
        "_AGENT_KEY_LITERAL_PREFIX: TestNexa 'tnx_agent_' vs platform-core "
        "'pcore_agent_'. Stage A confirmed decision 3 — renaming would "
        "invalidate every already-issued real key."
    ),
    "core/security.py": (
        "generate_api_key's raw-key prefix, the write side of the same "
        "'tnx_agent_' constant as core/rbac.py. Stage A confirmed decision 3."
    ),
    "db/rbac_seed_catalog.py": (
        "TestNexa's real catalog (23 CRUD resources, 5 system roles, link-table "
        "create/delete codes, test_plan.approve / requirement.export_rtm) vs "
        "platform-core's generic 6-resource, 3-role starter. The seeding "
        "*mechanism* (_code/build_permission_catalog/build_role_bundles) is the "
        "same functions in both — platform-core's is not cleaner, only smaller, "
        "so Stage A confirmed decision 2 keeps TestNexa's outright."
    ),
    "main.py": (
        "TestNexa mounts 22 routers plus the MCP sub-app; platform-core mounts "
        "the 10 generic ones. App title differs."
    ),
    "models/__init__.py": "TestNexa re-exports its domain models alongside the generic ones.",
    "models/project.py": "TestNexa adds the Release model to the same module.",
}


def _normalize(source: str) -> str:
    """Code-only form: parse, drop every docstring, unparse.

    Comments vanish at parse time and docstrings are dropped explicitly, so two
    files that differ *only* in prose normalize to the same string. This is what
    makes the comparison meaningful at all — platform-core's extraction rewrote
    essentially every docstring in the shared set.
    """
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                node.body = body[1:] or [ast.Pass()]
    ast.fix_missing_locations(tree)
    return ast.unparse(tree)


def _shared_relpaths(tn_app: pathlib.Path, pc_app: pathlib.Path) -> list[str]:
    """The intersection of the two trees — computed, never hand-listed."""
    tn = {str(p.relative_to(tn_app)) for p in tn_app.rglob("*.py")}
    pc = {str(p.relative_to(pc_app)) for p in pc_app.rglob("*.py")}
    return sorted(tn & pc)


def compare_trees(
    tn_app: pathlib.Path = _TN_APP,
    pc_app: pathlib.Path = _PC_APP,
) -> tuple[list[str], list[str]]:
    """Return (identical, diverging) shared relpaths, by normalized code."""
    identical: list[str] = []
    diverging: list[str] = []
    for rel in _shared_relpaths(tn_app, pc_app):
        tn_src = _normalize((tn_app / rel).read_text())
        pc_src = _normalize((pc_app / rel).read_text())
        (identical if tn_src == pc_src else diverging).append(rel)
    return identical, diverging


pytestmark = pytest.mark.skipif(
    not _PC_APP.is_dir(),
    reason=(
        "platform-core submodule not checked out "
        "(`git submodule update --init platform-core`) — parity cannot be checked"
    ),
)


def test_every_code_divergence_from_platform_core_is_declared() -> None:
    """No shared file may diverge in code without a reasoned entry above."""
    _, diverging = compare_trees()
    undeclared = sorted(set(diverging) - set(DECLARED_DIVERGENCES))
    assert not undeclared, (
        "These shared files now differ from platform-core in CODE (not just "
        "comments) with no declared reason. Either adopt platform-core's "
        "version, write it as a backport patch under platform-core-backport/, "
        "or add a DECLARED_DIVERGENCES entry explaining why TestNexa's differs: "
        f"{undeclared}"
    )


def test_no_declared_divergence_has_silently_been_resolved() -> None:
    """A declared exemption that no longer diverges must be deleted, not kept."""
    _, diverging = compare_trees()
    stale = sorted(set(DECLARED_DIVERGENCES) - set(diverging))
    assert not stale, (
        "These files are declared as diverging from platform-core but now match "
        "it exactly — remove their DECLARED_DIVERGENCES entries so the list "
        f"stays an accurate record: {stale}"
    )


def test_the_generic_layer_is_still_overwhelmingly_shared() -> None:
    """A floor, not an exact count: most of the shared set must stay identical.

    Asserted as a floor so ordinary domain growth doesn't fail the suite, while
    a wholesale rewrite of the generic layer on either side still would.
    """
    identical, diverging = compare_trees()
    total = len(identical) + len(diverging)
    assert total >= 36, f"expected ~38 shared files, found {total}"
    assert len(identical) >= 26, (
        f"only {len(identical)}/{total} shared files are still code-identical to "
        "platform-core — the generic layer has diverged far more than Stage A "
        "measured (28/38). Re-run the Stage A audit before assuming this is fine."
    )


def test_parity_checker_is_not_vacuous(tmp_path: pathlib.Path) -> None:
    """Mutation check: the comparison must actually report an injected gap.

    Without this, a green run above is indistinguishable from a checker that
    can't see divergence at all (`backend/CLAUDE.md`: "a verification the
    framework can silently skip is not a verification").
    """
    tn = tmp_path / "tn"
    pc = tmp_path / "pc"
    for d in (tn, pc):
        (d / "sub").mkdir(parents=True)

    # same code, wildly different prose -> must be reported IDENTICAL
    (tn / "same.py").write_text('"""TestNexa wording, ADR-0042."""\nX = 1\n')
    (pc / "same.py").write_text('""": stripped wording."""\n# a comment\nX = 1\n')

    # genuinely different code -> must be reported DIVERGING
    (tn / "sub" / "diff.py").write_text('PREFIX = "tnx_agent_"\n')
    (pc / "sub" / "diff.py").write_text('PREFIX = "pcore_agent_"\n')

    # present on one side only -> must be excluded from the shared set entirely
    (tn / "tn_only.py").write_text("Y = 2\n")

    identical, diverging = compare_trees(tn, pc)
    assert identical == ["same.py"], identical
    assert diverging == ["sub/diff.py"], diverging
    assert "tn_only.py" not in identical + diverging
