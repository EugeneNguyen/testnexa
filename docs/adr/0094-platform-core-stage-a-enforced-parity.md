# ADR-0094: Stage A — enforced parity with `platform-core`, not a file-for-file swap

- **Status:** Proposed — awaiting CTO review (the Decision deliberately does *not* execute the swap Stage A's brief asked for; see Context for why, and Alternatives for what was rejected)
- **Date:** 2026-09-19
- **Deciders:** xuanbinh91@gmail.com (CTO) — pending
- **Related:** [ADR-0022](0022-generic-crud-router-factory.md) (the CRUD factory Stage A targets), [ADR-0029](0029-testcase-resolver-direct-link-fallback.md) (the resolver-completeness case whose branch Stage A's own round trip re-proves), [ADR-0091](0091-actor-membership-gate-fix-bespoke-routes.md)/[ADR-0040](0040-role-assignment-project-cascade-delete.md)/[ADR-0087](0087-fk-select-for-bounded-catalogs.md) (the three fixes Stage A was told to check platform-core for — all three are already present upstream, see Context), [ADR-0075](0075-junction-table-registry-completeness.md) (the completeness-oracle discipline the new parity test is built to)

## Context

Stage A's brief: *"replace TestNexa's own backend auth/org/RBAC/CRUD-factory code
with platform-core's, without regressing or losing data-model compatibility,"*
with five confirmed decisions — keep TestNexa's Postgres schema and Alembic
history as-is; keep TestNexa's RBAC seed catalog; keep TestNexa's `tnx_agent_`
API-key prefix; port forward any fix TestNexa's `main` has that the extraction
missed; and layer TestNexa's bespoke resolvers on top of platform-core's generic
engine rather than dropping them.

Step four of that brief — diff before swapping — is what changed the answer.
Measured against submodule commit `7c78351`, normalizing each file through
`ast.parse` → strip docstrings → `ast.unparse` so that prose differences don't
register:

- **38 files are shared** between `backend/app/` and
  `platform-core/backend/app/` (computed as the intersection of the two trees).
- **28 of the 38 are code-identical.** platform-core's copies are TestNexa's own
  files with product-specific references stripped out of comments and
  docstrings — the submodule's own recent commits say as much
  (`chore: strip internal citation codes and TestNexa-specific naming`).
- **All 10 that differ, differ in TestNexa's favour or by confirmed decision:**
  `crud_factory.py` (TestNexa's 4 domain resolvers), `entity_registry.py`
  (29 entity configs vs 6), `rbac_seed_catalog.py` (the real 23-resource /
  5-role catalog vs a generic 6/3 starter), `main.py` (22 routers + the MCP
  mount vs 10), `models/__init__.py` and `models/project.py` (domain models),
  `core/rbac.py` + `core/security.py` (the `tnx_agent_` prefix, decision 3),
  `routes/projects.py` (creator auto-grant `test_manager` vs `project_owner`,
  decision 2), and `core/config.py` (deployment defaults + `ATTACHMENT_*`).
- **platform-core is ahead on nothing.** Every one of the three fixes the brief
  named is already upstream: ADR-0091's `_actor_membership_exists` sweep (all 5
  call sites platform-core shares are already converted; the 3 remaining
  `_org_membership_exists` uses in `agents.py` are the ones ADR-0091 audited and
  deliberately left), ADR-0040's `ON DELETE CASCADE` on
  `role_assignment.project_id` (present in both the model and the migration),
  and ADR-0087 Amendment 2's `FieldMeta.select=True` sweep. Amendment 3 is
  frontend-only (`EntityRelationTab.tsx`) and outside Stage A's backend scope.
- On the **seeding mechanism** specifically (decision 2's "only adopt it if
  genuinely cleaner"): `_code`/`build_permission_catalog`/`build_role_bundles`
  are the *same functions* in both repos. platform-core's version is not
  cleaner, only smaller. Nothing to adopt.

So a file-for-file copy would have been a **no-op on 28 files and a regression
on 10**. There is no non-regressing swap available at the file level.

The other reading of the brief — have TestNexa *import* the generic layer from
the submodule, one canonical copy — is blocked outright: **both repos root their
package at the literal name `app`** (`platform-core/backend/pyproject.toml` has
`include = ["app*"]`). Installing both makes `import app.models.actor` resolve
to whichever is first on `sys.path`; they cannot coexist. Confirmed directly —
the same import resolves to either tree depending only on `PYTHONPATH` ordering.
Renaming platform-core's root package is a change to a public repo that goes
through the CTO, not through this branch.

Two genuine defects in platform-core did surface from the diff, neither of them
a missing TestNexa fix:

1. `crud_factory.__all__` exports three names the module never defines
   (`resolve_risk_note_org_id`, `resolve_item_org_id`, `resolve_via_item`) —
   generified placeholders left behind when the domain resolvers were removed.
   `from app.api.crud_factory import *` raises `AttributeError`.
2. `0001_initial_schema.py` **drifts from platform-core's own models.**
   `RefreshToken.token_hash`/`Invite.token_hash` are declared
   `unique=True, index=True` (one unique index), but the migration emits a
   separate `UniqueConstraint` plus a *non-unique* index. Uniqueness is still
   enforced, so this is not a security hole — but it costs a redundant second
   index on the auth hot path, and `alembic check` **fails on a brand-new
   platform-core install**, reporting 6 spurious operations to any downstream
   consumer before they have written any code of their own.

## Decision

1. **Do not perform the file-for-file swap.** It cannot satisfy the brief's own
   primary constraint ("without regressing"), for the reasons measured above.
   TestNexa's backend is left byte-for-byte as it was: this branch's entire diff
   against `main` is `.gitmodules` plus the submodule pointer, one new test
   file, and one new documentation directory. Zero lines of `backend/app/` or
   `backend/alembic/` change.

2. **Enforce the parity the swap was reaching for, as a test.**
   `backend/tests/unit/test_platform_core_parity.py` compares every shared file's
   normalized code and fails unless each divergence is declared with a reason in
   `DECLARED_DIVERGENCES` — and fails equally if a declared divergence has
   silently been resolved upstream, so the list can't rot into stale exemptions.
   This is what actually delivers "one canonical generic layer": if platform-core
   ever gains a real fix, or TestNexa drifts further, the suite says so instead
   of the two copies quietly diverging forever.

   Built to [ADR-0075](0075-junction-table-registry-completeness.md)'s rules, because a
   completeness test is exactly what this is: the file set is **computed as the
   intersection of the two trees**, never hand-listed (a file added to
   platform-core that TestNexa also has is covered automatically — no separate
   step to forget), and the checker is parameterized so
   `test_parity_checker_is_not_vacuous` can inject a deliberately-diverged pair
   and assert the exact expected gap, while the real run reports none. Without
   that mutation case a green run would be indistinguishable from a checker that
   cannot see divergence at all.

   The test never imports platform-core's `app` package — it reads files as
   text — precisely because of the name collision above.

3. **Write the two platform-core defects (plus three formatting regressions) as
   reviewable patches, apply none of them.** `platform-core-backport/` holds five
   `.patch` files and a README. All five were verified with `git apply --check`
   against the real submodule (5/5 clean) and generated against scratch copies;
   the submodule working tree is untouched. Patch `0002` was verified
   *empirically*, not by inspection: applied to a scratch copy, migrated into a
   fresh Postgres database, `alembic check` goes from `FAILED: New upgrade
   operations detected: [6 operations]` to `No new upgrade operations detected`.

4. **Name the Stage B prerequisite explicitly:** consuming platform-core as a
   library requires renaming its root package (e.g. `app` → `platform_core`) so
   the two can be installed together. Until that happens, Stage B is not
   blocked on anything in TestNexa — it is blocked on a change to the public
   repo, which belongs to the CTO.

## Consequences

- **Data-model compatibility is now verified, not assumed.** platform-core's own
  migrations were run into a scratch database on the isolated stack and its
  schema diffed against TestNexa's live schema (cloned from `main`) for all 14
  shared tables: **columns 94 vs 94, identical.** Constraints and indexes were
  41/41 vs 39/39 before backport `0002` — the two redundant `token_hash` objects
  — and **39/39, byte-identical, after it.** So once `0002` lands upstream, the
  two schemas agree exactly on every shared table, and a future Stage B is a
  schema no-op. This is the concrete answer to "without losing data-model
  compatibility," and it was not knowable from reading either repo.
- **TestNexa's schema is unchanged and needs no migration**, confirmed with the
  strongest available oracle rather than by assumption: against a clone of
  `main`'s DB, `alembic current` was already at head `a1c4e8f92b3d`,
  `alembic upgrade head` was a clean no-op, `alembic heads` showed exactly one
  head, `git diff main...HEAD -- backend/alembic/versions/` is empty, and
  `alembic check` reports **"No new upgrade operations detected"** — i.e. the
  models and the live schema agree with zero drift.
- **All four TestNexa-bespoke resolvers remain present and reachable**, proven
  live rather than by grep: a create-then-**immediate-read** round trip against
  the isolated stack passed 4/4 —
  `resolve_test_case_org_id` via its `project_id` branch and via its
  `RequirementTestCaseLink` branch (the ADR-0029 case), `resolve_via_test_case`,
  and `resolve_risk_item_org_id` via its `requirement_id` branch. Create-only
  assertions cannot catch a resolver gap, which is why each case reads the row
  back through the route. The 9 resolver builders in `crud_factory.py` and all
  29 `resolve_org_id=` wiring sites across 14 route modules are unchanged.
- **Verification:** backend unit **919/919** (915 baseline + 4 new parity tests),
  frontend Vitest **806/806** with `tsc --noEmit` clean, `ruff` clean on the one
  added file. Backend integration: 412 passed / 14 failed, of which **6 were
  host-contention flakes** (host had 62 containers running, `immich-server-1` at
  178% CPU; all 6 passed on a solo rerun) and **8 are pre-existing failures on
  `main`**, root-caused rather than waved away — see the next bullet. None are
  attributable to this branch, which changes zero application code.
- **Two pre-existing `main` failures found, neither in Stage A's scope to fix,
  both flagged rather than absorbed:**
  1. **ADR-0087 Amendment 2 broke 5 integration tests on `main` and they are
     still broken.** Commit `395deed` (2026-09-18) added `select=True` to the
     `FieldMeta` declarations swept in that amendment; `select: true` therefore
     now appears in `GET /entities/{resource}/schema` responses, and
     `test_adr53_entity_schema.py` (3 tests), `test_adr78_compound_create.py`
     and `test_req5_standalone_test_case.py` all assert the exact field dict
     **without** it. That test file was last touched `c67cd5f` (2026-09-16),
     two days *before* the change. This is precisely the failure class
     `backend/CLAUDE.md` already documents for response-shape changes ("grep
     for existing callers first") — here the callers were the suite's own
     exact-equality assertions, which no `tsc` or mock could have caught.
  2. **`test_admin_testtype_seed.py`'s 3 tests are data-dependent and fail
     against any clone of `main`'s DB.** They assert `test_type` contains
     exactly the 5 seeded ISTQB names; `main`'s own table has 4 of them (no
     "Confirmation Testing") plus 2 leftover `Custom Regression Suite <hex>`
     rows from earlier test runs. The tests pass on a fresh DB only — which
     makes them incompatible with this repo's own standard "clone `main`'s DB"
     isolated-stack recipe.
- **The parity test adds a soft coupling to the submodule.** It skips cleanly
  (`pytest.mark.skipif`) when `platform-core/` isn't checked out, so a clone
  without `git submodule update --init` is unaffected rather than red.
- **Accepted cost of not swapping:** the generic layer still physically exists
  twice. The parity test converts that from silent drift into a failing test,
  which is a real improvement, but it is not the single canonical copy Stage B
  is meant to produce. That remains outstanding and now has one named blocker.

## Alternatives considered

- **Copy platform-core's files over TestNexa's, then re-apply the confirmed
  decisions and the domain code on top.** Rejected: the end state is
  byte-identical to today's code for the 28 identical files, and for the other
  10 the "re-apply on top" step is just re-typing what TestNexa already has —
  with a real chance of dropping one of the four resolvers, the `tnx_agent_`
  prefix, or a `rbac_seed_catalog.py` bundle in the process. Pure downside risk
  for zero gain, and it would have imported platform-core's broken `__all__`.
- **Import the generic layer from the submodule (the real Stage B).** Rejected as
  currently impossible, not merely undesirable — the `app` root-package
  collision above. Recorded as Decision 4's prerequisite rather than attempted.
- **Adopt platform-core's `rbac_seed_catalog.py` mechanism.** Rejected on
  inspection: it is the same three functions with fewer table entries. Decision
  2's "only if genuinely cleaner" test simply isn't met.
- **Apply the backport patches to the submodule directly.** Rejected outright —
  `platform-core` is public and changes to it go through the CTO. The patches
  are staged for review instead, and the submodule was confirmed clean before
  and after generating them.
- **Fix the 8 pre-existing `main` failures in this branch.** Rejected per this
  repo's own "flag drift, don't silently absorb into unrelated work" convention.
  Both root causes are documented above with the exact commits; the ADR-0087
  one in particular wants its own decision (update the assertions, or stop
  asserting whole dicts) rather than a drive-by edit inside a Stage A branch.
