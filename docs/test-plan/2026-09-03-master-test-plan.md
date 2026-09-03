# Master Test Plan — Project Scaffold

**Identifier:** TP-SCAFFOLD-001
**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Format:** IEEE 829 Test Plan sections, applied to testing the scaffold itself — the tool tests its own build using the same document shape it's designed to produce for its users.
**Sources:** [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [Test Design](../test-design/2026-09-03-test-design.md), [Test Cases](../test-cases/2026-09-03-test-cases.md)

---

## 1. Introduction

This plan governs testing of the project scaffold: a full-stack ISTQB/IEEE829-aligned test management tool (backend API, frontend SPA, MCP server, Docker infra) implementing 35 physical tables across 28 business entities, JWT auth for human and AI-agent actors, and multi-tenant RBAC. Purpose: verify every FR/NFR in the Requirements Document before any release is considered scaffold-complete.

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
| RBAC allow/deny matrix under-tested (5 roles × ~40 permission codes is a large surface) | Generate the matrix mechanically from the seeded `Permission` catalog rather than hand-listing cases, per Test Design §7.3 |
| E2E suite flakiness against a full docker-compose stack | Keep E2E scope to the two named flows (§9.4); push broader coverage to integration tests, which run faster and more deterministically against `postgres-test` directly |
| Multi-tenancy (unvalidated per ADR-0007) adds test surface with unclear ROI if the feature itself gets cut post-scaffold | Isolation tests (NFR-1) are cheap relative to the cost of a real leak — keep them regardless of multi-tenancy's eventual product fate |

## 15. Approvals

This Master Test Plan is a scaffold-internal engineering artifact, not a customer-facing IEEE 829 deliverable — approved by the CTO role per the governance model this document itself is designed to support ([GOV-1](../user-stories/2026-09-03-governance-stories.md)).

**Approved by:** xuanbinh91@gmail.com (CTO) — 2026-09-03
