# Master Test Plan — Project Scaffold

**Identifier:** TP-SCAFFOLD-001
**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Format:** IEEE 829 Test Plan sections, applied to testing the scaffold itself — the tool tests its own build using the same document shape it's designed to produce for its users.
**Sources:** [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [Test Design](../test-design/2026-09-03-test-design.md), [Test Cases](../test-cases/2026-09-03-test-cases.md), [AUTH-1 scope plan](../superpowers/plans/2026-09-03-auth-1-local-password-login-plan.md), [AUTH-2 scope plan](../superpowers/plans/2026-09-03-auth-2-session-persistence-plan.md), [AUTH-3 scope plan](../superpowers/plans/2026-09-03-auth-3-logout-plan.md), [AUTH-4 scope plan](../superpowers/plans/2026-09-03-auth-4-agent-bearer-auth-plan.md), [RBAC-1 scope plan](../superpowers/plans/2026-09-03-rbac-1-create-org-plan.md), [PROJ-1 scope plan](../superpowers/plans/2026-09-03-proj-1-create-project-plan.md), [PROJ-2 scope plan](../superpowers/plans/2026-09-03-proj-2-create-release-plan.md), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md), [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md), [ADR-0017](../adr/0017-project-creation-flow.md), [ADR-0018](../adr/0018-release-creation-flow.md)

---

## 1. Introduction

This plan governs testing of the project scaffold: a full-stack ISTQB/IEEE829-aligned test management tool (backend API, frontend SPA, MCP server, Docker infra) implementing 36 physical tables across 28 business entities, JWT auth for human and AI-agent actors, multi-tenant RBAC, and login rate limiting. Purpose: verify every FR/NFR in the Requirements Document before any release is considered scaffold-complete.

## 2. Test items

- Backend REST API (FastAPI) — all routes in the [API Document](../api/2026-09-03-api-design.md)
- Frontend SPA (React/Vite) — generic CRUD surface + bespoke workflow screens
- MCP server stub — 5 tools per API Document §6
- Alembic migrations — schema migration + seed data migration
- Docker Compose stack — full-stack integration surface (`dev` and `prod` profiles)

## 3. Features to be tested

All FR-* items in the [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md) §2 (Auth, RBAC/Tenancy, Project/Release, Requirement/TestCase authoring, Planning, Execution/Defect, Governance, Taxonomy/Admin CRUD, Traceability, MCP), and all NFR-* items in §3 (tenant isolation, immutability, hashing, storage bounds, error-shape consistency, pagination, permission parity).

## 4. Features not to be tested

Out of scope per the design spec, and therefore out of scope here too: IEEE 829/29119-3 document-format export, SSO/OIDC/SAML/LDAP provider auth flows (schema exists, no working auth logic), AI test-case generation, billing/usage metering.

## 5. Approach

| Layer | Technique | Tooling |
|---|---|---|
| Backend unit | Isolated model/service logic, no DB/network | pytest + pytest-asyncio |
| Backend integration | Real dockerized Postgres (`postgres-test` service), HTTP-layer assertions, full RBAC allow/deny matrix per role | pytest + httpx |
| Frontend unit | Generic CRUD components (`EntityTable`/`EntityForm`) + bespoke workflow screens, mocked API layer | Vitest + React Testing Library |
| End-to-end | Full docker-compose stack via `localhost:8080`, real browser | Playwright |

Test-design techniques applied per feature area are detailed in the [Test Design](../test-design/2026-09-03-test-design.md) document (equivalence partitioning, boundary value analysis, decision tables for the RBAC matrix, state-transition testing for status-field lifecycles).

## 6. Item pass/fail criteria

- A route/feature **passes** when every acceptance criterion in its source user story (`docs/user-stories/`) has a corresponding green test at the appropriate layer (unit and/or integration and/or E2E per §5).
- A route/feature **fails** if any acceptance criterion lacks coverage, or any covered criterion's test is red.
- NFR-1 (tenant isolation) and NFR-9 (RBAC matrix) are release-blocking: no scaffold build is considered complete with a known cross-tenant leak or an unverified permission-denial path.
- NFR-11 (login rate limiting) is release-blocking for AUTH-1: `POST /auth/login` must not ship without the 429 throttle verified at the HTTP layer, not just unit-tested in isolation.
- NFR-12/NFR-13 (refresh rotation, org re-check) are release-blocking for AUTH-2: `POST /auth/refresh` must not ship without single-use rotation and the revoked/expired-token 401 path verified at the HTTP layer ([ADR-0013](../adr/0013-refresh-token-rotation-policy.md)) — a refresh endpoint that silently allows indefinite reuse of one token defeats the story's own revocability requirement.
- NFR-14 (logout idempotency/scoping) is release-blocking for AUTH-3: `POST /auth/logout` must not ship without (a) an integration test proving the revoked refresh token is actually rejected by a subsequent `POST /auth/refresh`, and (b) the idempotent-204 path verified for missing/foreign/already-revoked cookies ([ADR-0014](../adr/0014-logout-session-revocation-policy.md)) — a logout that silently no-ops on the happy path, or errors on the idempotent paths, defeats the story's "log out on a shared machine" premise either way.
- AUTH-4's AC2 (an `AIAgent` hitting a permission its role doesn't grant → 403, same RBAC path as a human `User`) is release-blocking for AUTH-4 specifically, even though AUTH-4 itself is a "Should"-priority story — the acceptance criterion exists precisely to prove the unified-Actor RBAC claim (07 principle #6), so it isn't optional polish. NFR-17/NFR-18/NFR-19 ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)) are verified at the same HTTP-integration layer as NFR-9's RBAC matrix, not unit-tested against mocked permission logic alone.
- NFR-21 (RBAC-1 bootstrap closure + concurrency guard) is release-blocking for RBAC-1: `POST /auth/signup` must not ship without (a) an integration test proving it 409s once an `Organization` already exists, and (b) the concurrent-first-signup race test (TC-RBAC-020) proving `pg_advisory_xact_lock` actually serializes the two calls, not just a happy-path single-caller test ([ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)) — a bootstrap guard that only works absent concurrency isn't a guard. **TC-RBAC-002** (cross-org isolation on Project/Requirement/TestCase) is explicitly **not** achievable within RBAC-1's own scope — no CRUD routes exist yet for those entities (§3 of the API Document is still design-only) — and is not treated as a blocking gap for this story; it becomes release-blocking once whichever story adds the first tenant-scoped CRUD route lands, and that route must reuse the `/orgs/{org_id}/agents*` 404-vs-403 pattern ADR-0015 established.
- PROJ-1 is that story: `Project` is the first tenant-scoped resource with a real create/read/update route, making **TC-RBAC-002** release-blocking as of this story (verified against `Project` specifically — `Requirement`/`TestCase` remain covered once their own CRUD routes exist). NFR-22 (no orphaned Requirement/TestSuite/TestPlan outside a Project) is release-blocking **at the schema level only** for PROJ-1 — the FK constraints must be proven non-nullable, but the live "attempt to create one without `project_id` → 422" path stays deferred (same posture RBAC-1 took for TC-RBAC-002) until the first create route for any of those three entities exists ([ADR-0017](../adr/0017-project-creation-flow.md)). NFR-23 (`standards_profile` inheritance) is release-blocking for PROJ-1: both the omitted-inherits and explicit-overrides branches must be integration-tested, not just the happy path of "a value was supplied."
- PROJ-2 extends TC-RBAC-002's cross-org coverage to `Release` (**TC-PROJ-016**) — release-blocking the same way PROJ-1 made it release-blocking for `Project`. NFR-24 (`target_date` sort, pinned `NULLS LAST`) is release-blocking for PROJ-2: both `asc` and `desc` must be integration-tested with a mixed dated/undated fixture set, not just one direction assumed symmetric with the other. NFR-25 (triple-permission gate on `GET /releases/{id}/test-cycles`) is release-blocking: an actor holding `release.read` but missing either `test_cycle.read` or `test_execution.read` must be integration-tested as a `403` (**TC-PROJ-015**), not just the all-three-granted happy path — a route that silently degrades to a partial response instead of `403`ing on a missing permission would defeat NFR-25's own purpose without a dedicated negative test catching it. The `test_manager` RBAC bundle extension ([ADR-0018](../adr/0018-release-creation-flow.md)) is release-blocking for PROJ-2: a `test_manager`-only actor (no `org_admin`) successfully calling `POST`/`GET /projects/{project_id}/releases` (**TC-PROJ-017**) is the only test that would catch the migration silently failing to apply or the bundle silently reverting to `org_admin`-only reachability.

## 7. Suspension criteria and resumption requirements

- **Suspend** integration/E2E testing if the `postgres-test` service or the docker-compose stack itself fails to start — a broken environment invalidates all downstream results.
- **Suspend** a feature area's testing if its Alembic migration fails to apply cleanly to a fresh DB — schema must be correct before behavior can be verified.
- **Resume** once the blocking infra/migration issue is fixed and the baseline (empty DB, fresh `docker compose up`) is confirmed green again.

## 8. Test deliverables

- This Master Test Plan
- [Test Design](../test-design/2026-09-03-test-design.md)
- [Test Cases](../test-cases/2026-09-03-test-cases.md)
- Test result reports (produced by CI/local runs once implementation exists — pytest/Vitest/Playwright output)
- RBAC allow/deny matrix coverage report (derived from §7.3 of Test Design)

## 9. Testing tasks

1. Write and green backend unit tests alongside each model/service (TDD, per task in the eventual [implementation plan](../superpowers/plans/2026-09-03-project-scaffold-plan.md)).
2. Write and green backend integration tests per route, including the full 5-role × permission-code allow/deny matrix.
3. Write and green frontend unit tests per component/screen.
4. Write and green E2E tests for the two flows named in the design spec: login→requirement→test case→execution, and the RBAC-denial flow (tester blocked from Approval-only routes).
5. Run the full suite against a fresh `docker compose up` before any scaffold-complete claim.

## 10. Environmental needs

- Docker + Docker Compose (local dev and CI-equivalent)
- PostgreSQL 15+ (via the `postgres` and `postgres-test` Compose services)
- Node.js (frontend/Playwright toolchain), Python 3.11+ (backend toolchain) — exact floors set when `pyproject.toml`/`package.json` are written
- No external network dependency — self-hosted stack, no third-party SaaS calls required to run the test suite (consistent with the self-hosting/data-sovereignty positioning)

## 11. Responsibilities

- **Test design & plan ownership:** CTO (xuanbinh91@gmail.com)
- **Test implementation:** whoever implements each task in the eventual implementation plan writes that task's tests (TDD — test before/with code, not after)
- **RBAC matrix verification:** owned jointly with the RBAC/auth implementer, reviewed against [Test Design](../test-design/2026-09-03-test-design.md) §7.3 before merge

## 12. Staffing and training

No specialized training required beyond the stack already named in [ADR-0002](../adr/0002-backend-framework-orm-migrations.md) and [ADR-0009](../adr/0009-frontend-stack.md) (FastAPI/SQLAlchemy/Alembic/pytest; Vite/React/TanStack Query/Vitest/Playwright). ISTQB CTFL v4.0.1 vocabulary familiarity is useful for reviewing Test Design's technique labels but not required to execute the test suite.

## 13. Schedule

Testing is not a separate phase — per the WBS, each backend/frontend deliverable task carries its own test cycle (unit tests written with the code; integration/E2E tests added once the relevant route/screen set is complete). No standalone "testing phase" is scheduled; §10.2/10.4 of the [WBS](../wbs/2026-09-03-project-scaffold-wbs.md) (integration and E2E suites) are the two tasks that depend on multiple earlier deliverables landing first.

## 14. Risks and contingencies

| Risk | Contingency |
|---|---|
| RBAC allow/deny matrix under-tested (5 roles × ~100 seeded permission codes is a large surface — `org_admin` alone is every code) | Generate the matrix mechanically from the seeded `Permission` catalog rather than hand-listing cases, per Test Design §3; skip generating `org_admin` denial cases (it has no denied codes by design) and assert its bundle count equals the full catalog count instead |
| E2E suite flakiness against a full docker-compose stack | Keep E2E scope to the two named flows (§9.4); push broader coverage to integration tests, which run faster and more deterministically against `postgres-test` directly |
| Multi-tenancy (unvalidated per ADR-0007) adds test surface with unclear ROI if the feature itself gets cut post-scaffold | Isolation tests (NFR-1) are cheap relative to the cost of a real leak — keep them regardless of multi-tenancy's eventual product fate |
| Login throttle test is timing-sensitive (15-minute window) and could be flaky/slow if tested literally | Test the throttle's counting/threshold logic against an injectable clock or a short-window test config, not a real 15-minute wall-clock wait |
| Refresh-token rotation's multi-tab race (two tabs refreshing near-simultaneously, [ADR-0013](../adr/0013-refresh-token-rotation-policy.md)) is a known, accepted gap, not a bug to chase in the test suite | Test single-tab rotation/revocation behavior deterministically (TC-AUTH-006/007/008); do not attempt to assert away the multi-tab race in automated tests — it's a documented trade-off, not a regression target |
| RBAC-4 seed migration re-run (redeploy, CI re-apply) silently duplicates system roles/permissions | Assert idempotency directly (TC-RBAC-016): apply the migration twice against the same DB, row counts for `role`/`permission`/`role_permission` are identical after both runs |
| AUTH-4 pulls a minimal `has_permission`/`require_permission` forward ahead of RBAC-3/4 ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)) — risk that its own tests only exercise the org-wide-grant branch, leaving the project-scoped branch untested until RBAC-3 lands | Explicitly scope AUTH-4's RBAC-matrix tests to org-wide grants only (TC-AUTH-033/034) and flag the project-scoped branch as RBAC-3's own coverage obligation in [Test Design](../test-design/2026-09-03-test-design.md) §3, not silently assumed covered |
| `AIAgent.key_prefix`-narrowed lookup ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)) could regress to an unindexed full-table argon2-verify scan without anyone noticing at scaffold scale (few agents per org) | Cover the wrong-key-same-prefix-family case explicitly (TC-AUTH-029) so a lookup-narrowing regression that accidentally matches on prefix alone (skipping the argon2 verify) fails a test, not just a future perf review |
| Two simultaneous first-ever `POST /auth/signup` calls both observe zero `Organization` rows and both succeed, silently violating the single-bootstrap invariant ([ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)) | Serialize via `pg_advisory_xact_lock` acquired before the exists-check, inside the same transaction as the insert; TC-RBAC-020 fires two parallel signup requests and asserts exactly one `Organization` row results, not just that both calls individually "succeeded" |
| `has_permission_in_any_org` (RBAC-1's bespoke any-org gate, [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)) is a second, subtly different permission-resolution function alongside AUTH-4's `has_permission` — a future story could call the wrong one and silently scope a check too broadly or too narrowly | Name and document the distinction explicitly in the ADR and RBAC-1 scope plan; TC-RBAC-021 asserts `has_permission_in_any_org` ignores project-scoped-only grants (`project_id` non-null) the same way `has_permission`'s own default does, so the two functions' semantics stay aligned outside the org-scoping difference |
| PROJ-1's unconditional creator→`test_manager` role assignment ([ADR-0017](../adr/0017-project-creation-flow.md)) is a known simplification (only `org_admin` can reach `project.create` today) — a future story granting `project.create` to a custom role could silently make this rule wrong without any test catching it, since no test today exercises a non-`org_admin` creator | Document the limitation in the ADR/requirements NFR (not just the scope plan) so it surfaces in any future RBAC-role-expansion review; TC-PROJ tests assert the rule as "creator gets `test_manager`," not "creator gets a role derived from their own role," so a future revision is a deliberate spec change, not a silent regression |
| `Project.standards_profile` inheritance from `Organization.default_standards_profile` ([ADR-0017](../adr/0017-project-creation-flow.md)) depends on correctly distinguishing "field omitted" from "field explicitly `null`" in the request body — an implementation using a plain `Optional[str] = None` default instead of `exclude_unset` would silently collapse both cases into "inherit," breaking the explicit-null-clears-it path | TC-PROJ tests cover both branches explicitly as distinct cases (omitted → inherits; explicit `null` → stays `null` even if the org has a default) so a `exclude_unset`-vs-default-value implementation mistake fails a test immediately |
| `GET /releases/{id}/test-cycles`'s triple-permission gate ([ADR-0018](../adr/0018-release-creation-flow.md)) is a first-of-its-kind check in this codebase (every other bespoke route gates on exactly one permission) — an implementation that reuses the single-`has_permission`-call pattern by habit would silently under-enforce, granting access to `TestExecution` data on `release.read` alone | TC-PROJ-015 asserts each of the three permissions independently withheld (not just all-three-withheld) still 403s, so a copy-pasted single-check implementation fails immediately rather than passing on an incomplete happy-path test |
| Pinning `NULLS LAST` for both `asc`/`desc` on Release's `target_date` sort ([ADR-0018](../adr/0018-release-creation-flow.md)) is easy to omit if the query is built with a plain `ORDER BY target_date DESC` and no explicit `NULLS LAST` clause — Postgres's own default flips to `NULLS FIRST` for `DESC`, silently putting undated releases first instead of last | TC-PROJ-014 asserts `NULLS LAST` explicitly for **both** sort directions, not just `asc` (where the engine default happens to already match intent, masking a `desc`-only regression) |

## 15. Approvals

This Master Test Plan is a scaffold-internal engineering artifact, not a customer-facing IEEE 829 deliverable — approved by the CTO role per the governance model this document itself is designed to support ([GOV-1](../user-stories/2026-09-03-governance-stories.md)).

**Approved by:** xuanbinh91@gmail.com (CTO) — 2026-09-03
