# Master Test Plan — Project Scaffold

**Identifier:** TP-SCAFFOLD-001
**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Format:** IEEE 829 Test Plan sections, applied to testing the scaffold itself — the tool tests its own build using the same document shape it's designed to produce for its users.
**Sources:** [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [Test Design](../test-design/2026-09-03-test-design.md), [Test Cases](../test-cases/2026-09-03-test-cases.md), [AUTH-1 scope plan](../superpowers/plans/2026-09-03-auth-1-local-password-login-plan.md), [AUTH-2 scope plan](../superpowers/plans/2026-09-03-auth-2-session-persistence-plan.md), [AUTH-3 scope plan](../superpowers/plans/2026-09-03-auth-3-logout-plan.md), [AUTH-4 scope plan](../superpowers/plans/2026-09-03-auth-4-agent-bearer-auth-plan.md), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)

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

## 15. Approvals

This Master Test Plan is a scaffold-internal engineering artifact, not a customer-facing IEEE 829 deliverable — approved by the CTO role per the governance model this document itself is designed to support ([GOV-1](../user-stories/2026-09-03-governance-stories.md)).

**Approved by:** xuanbinh91@gmail.com (CTO) — 2026-09-03
