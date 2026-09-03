# Work Breakdown Structure — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [Pre-implementation plan](../superpowers/plans/2026-09-03-project-scaffold-plan.md)

Sizing: **S** ≤ 0.5 day, **M** ≈ 1–2 days, **L** ≈ 3–5 days, for one engineer working with an AI pair — indicative for sequencing, not a committed estimate.

---

## 1. Backend foundation

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 1.1 | DB models — all 28 business entities (36 physical tables incl. `RefreshToken`/`LoginAttempt` and junction tables — see Database Document §1) across 11 cluster modules (`tenancy`, `auth`, `rbac`, `actor`, `project`, `assets`, `planning`, `execution`, `trace`, `taxonomy`, `governance`) | — | L | [Database Document](../database/2026-09-03-database-design.md) |
| 1.2 | Alembic initial migration (all 36 physical tables, UUIDv7 PKs) | 1.1 | M | ADR-0008 |
| 1.3 | Alembic seed migration — partial unique index on `role.name WHERE org_id IS NULL`; ~100-row `Permission` catalog (29 resources); 5 system `Role` rows + bundles (`org_admin` = full catalog); existence-checked inserts for idempotent re-run; taxonomy lookups — excludes `ai_agent.create`/`.update`, seeded separately by 2.3c ahead of this task | 1.2 | M | FR-RBAC-4, NFR-20, FR-ADMIN-1, [RBAC-4 plan](../superpowers/plans/2026-09-03-rbac-4-seeded-system-roles-plan.md) |
| 1.4 | Core infra: DB session management, settings/config, Actor-resolution helper | 1.1 | S | ADR-0002 |

## 2. Auth & RBAC

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 2.1 | `security.py` — JWT issue/verify, argon2 password hashing | 1.4 | S | FR-AUTH-1 |
| 2.2 | Local login route, org auto-select/picker/403-zero-org resolution | 2.1, 1.2 | M | FR-AUTH-1 |
| 2.2b | `POST /auth/refresh` (rotate-on-use, org re-check), `GET /auth/me`, minimal `get_current_actor` (bearer JWT verify only, no permission codes) | 2.2 | M | FR-AUTH-2, NFR-12, NFR-13, [ADR-0013](../adr/0013-refresh-token-rotation-policy.md) |
| 2.2c | `POST /auth/logout` — authenticated, idempotent revoke-current-session (CAS scoped to `user_id`, `revoked_reason="logout"`), `204`, clears refresh cookie | 2.2b | S | FR-AUTH-3, NFR-14, [ADR-0014](../adr/0014-logout-session-revocation-policy.md) |
| 2.3a | `security.py` — `generate_api_key`/`hash_api_key`/`verify_api_key` (`tnx_agent_<prefix>_<secret>` format, argon2) | 2.1 | S | FR-AUTH-4, [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md) |
| 2.3b | `get_current_actor` agent-key branch (prefix-narrowed lookup + argon2 verify, `AIAgent.last_used_at` update) + `AIAgent.last_used_at` migration | 2.3a | M | FR-AUTH-4, NFR-18 |
| 2.3c | `rbac.py` — minimal generic `has_permission`/`require_permission` (org-wide `RoleAssignment` resolution only; pulled forward from 2.4, project-scoped branch left for RBAC-3) + `ai_agent.create`/`ai_agent.update` permission-seed data migration | 1.3, 2.3b | M | FR-AUTH-4 AC2, [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md) |
| 2.3d | `POST /orgs/{org_id}/agents` + `.../revoke` routes (human-only gate, org_admin-permission-gated, 404-vs-403 org-membership boundary) | 2.3c | M | FR-AUTH-4, NFR-17, NFR-19 |
| 2.4 | `rbac.py` — `require_permission(code)` project-scoped branch + permission-code registry generated from model registry (extends 2.3c's org-wide-only implementation) | 1.3, 2.3c | M | FR-RBAC-3, NFR-10 |
| 2.5 | Org/OrgMembership routes — create org (first-user bootstrap), invite/suspend/reactivate members | 2.4 | M | FR-RBAC-1, FR-RBAC-2 |
| 2.6 | RoleAssignment routes — org-wide/project-scoped grants | 2.4 | S | FR-RBAC-3 |
| 2.7 | Human-only Approval defense-in-depth check | 2.4 | S | FR-RBAC-5 |
| 2.8 | Login throttle: `LoginAttempt` table + per-(IP, email) failed-attempt counter, 429 above threshold | 2.2 | S | NFR-11, [ADR-0011](../adr/0011-login-rate-limiting.md) |

## 3. Generic CRUD API

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 3.1 | Pydantic v2 schemas — 1:1 mirror of `app/models/` | 1.1 | M | [API Document](../api/2026-09-03-api-design.md) |
| 3.2 | CRUD router factory (list/get/create/update/delete, pagination, exact-match filters, `require_permission` baked in) | 2.4, 3.1 | M | FR-ADMIN-2, NFR-6 |
| 3.3 | Apply factory to all non-bespoke entities (~20 of 28) | 3.2 | M | FR-ADMIN-2 |

## 4. Bespoke API routes

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 4.1 | Requirement/TestCondition/TestCase/TestStep authoring routes (both link paths) | 3.2 | M | FR-REQ-1..4 |
| 4.2 | TestPlan/EntryExitCriteria/TestCycle/Environment routes, execution-scope-check (execution only against TestCase in a suite included in the plan) | 3.2 | M | FR-PLAN-1..3 |
| 4.3 | TestExecution + append-only TestLog routes | 4.2 | M | FR-EXEC-1..2 |
| 4.4 | Defect routes, raise-from-execution | 4.3 | S | FR-EXEC-3 |
| 4.5 | Approval route (human-only, GOV-1) | 2.7 | S | FR-GOV-1 |
| 4.6 | RiskItem, Attachment routes (incl. server-side size/type limits, storage backend switch) | 3.2 | M | FR-GOV-2..3, NFR-4, NFR-7 |
| 4.7 | RTM traversal route + CSV export | 4.1, 4.3, 4.4 | M | FR-TRACE-1..2 |

## 5. MCP server stub

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 5.1 | MCP server scaffolding, thin client over the same service layer as REST (no separate weaker code path) | 2.3 | M | FR-MCP-1..3 |
| 5.2 | Tools: create/list/update TestCase | 5.1, 4.1 | S | FR-MCP-1, FR-MCP-2 |
| 5.3 | Tools: create TestExecution, read Requirement (read-only) | 5.1, 4.3 | S | FR-MCP-3 |

## 6. Frontend foundation

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 6.1 | Vite + React Router + TanStack Query + Tailwind scaffold | — | S | ADR-0009 |
| 6.2 | Typed API client + TanStack Query hooks (`useEntityList`, `useEntity`, `useCreateEntity`, `useUpdateEntity`, `useDeleteEntity`) | 6.1, 3.2 | M | [API Document](../api/2026-09-03-api-design.md) |
| 6.3a | Token store module (`apiFetch` reads/attaches `Authorization`, 401→refresh→retry-once with concurrent-refresh dedup) | 6.2, 2.2b | M | FR-AUTH-2 |
| 6.3b | `AuthContext` boot-time silent refresh (`isInitializing`), `ProtectedRoute` guard | 6.3a | S | FR-AUTH-2 |
| 6.3c | Logout action (calls `/auth/logout`, unconditionally clears token store + org state and redirects to `/login` regardless of the call's success/failure) | 6.3a, 2.2c | S | FR-AUTH-3, NFR-14 |
| 6.3d | `AppHeader` navbar (CoreUI `CHeader`, brand + "Log out" button wired to 6.3c) mounted inside `ProtectedRoute`, replacing the bare unwrapped `children` render | 6.3c, 6.3b | S | FR-AUTH-3, ADR-0012 |

## 7. Generic CRUD UI

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 7.1 | `<EntityTable>`, `<EntityForm>` (react-hook-form + zod) generic components | 6.2 | M | FR-ADMIN-2 |
| 7.2 | `entityConfigs/` — one field-config object per entity (28) | 7.1 | L | FR-ADMIN-2 |
| 7.3 | Admin pages routed from an entity registry, permission-gated action buttons | 7.2, 6.3b | M | FR-ADMIN-2, NFR-10 |

## 8. Bespoke workflow screens

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 8.1 | Login, OrgSwitcher/ProjectSwitcher | 6.3b | M | FR-AUTH-1, FR-RBAC-1 |
| 8.2 | RequirementDetail (Requirement → optional TestCondition → TestCase, both paths) | 7.1, 4.1 | M | FR-REQ-1..3 |
| 8.3 | TestSuiteBuilder | 7.1, 4.1 | S | FR-REQ-4 |
| 8.4 | TestExecutionRunner (pass/fail/blocked + notes, raises Defect) | 7.1, 4.3, 4.4 | M | FR-EXEC-1..3 |
| 8.5 | TraceabilityMatrix (view + CSV export) | 7.1, 4.7 | M | FR-TRACE-1..2 |

## 9. Infra

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 9.1 | `docker-compose.yml` — postgres, backend, frontend, nginx, dev+prod profiles | 1.1, 6.1 | M | ADR-0010 |
| 9.2 | `nginx.conf` — `/api/*` → backend, `/*` → frontend | 9.1 | S | ADR-0010 |
| 9.3 | `postgres-test` service for integration tests | 9.1 | S | NFR-9 |

## 10. Testing

| # | Deliverable | Depends on | Size | Maps to |
|---|---|---|---|---|
| 10.1 | Backend unit tests (isolated model/service logic) | per-task | ongoing | [Test Plan](../test-plan/2026-09-03-master-test-plan.md) |
| 10.2 | Backend integration tests — RBAC allow/deny matrix at HTTP layer, real Postgres; includes login throttle (429) and zero-active-org (403) cases | 9.3, all §2–5 | L | NFR-9, NFR-11, [Test Design](../test-design/2026-09-03-test-design.md) |
| 10.3 | Frontend unit tests (Vitest + RTL) — generic CRUD components + bespoke screens | per-task | ongoing | [Test Plan](../test-plan/2026-09-03-master-test-plan.md) |
| 10.4 | E2E tests (Playwright) — login→requirement→test case→execution; RBAC-denial flow | 9.1, all §6–8 | L | [Test Case doc](../test-cases/2026-09-03-test-cases.md) |

## 11. Documentation (this batch)

| # | Deliverable | Status |
|---|---|---|
| 11.1 | Requirement Document | Done |
| 11.2 | WBS (this document) | Done |
| 11.3 | ADRs (0001–0015 + index) | Done |
| 11.4 | Database Document | Done |
| 11.5 | API Document | Done |
| 11.6 | Master Test Plan | Done |
| 11.7 | Test Design | Done |
| 11.8 | Test Cases | Done |

## Critical path

1 → 2 → 3 → (4 and 5 in parallel) → 6 → 7 → 8 → 9 → 10. Documentation (§11) has no code dependency and is delivered ahead of implementation per user instruction ("don't write code" for this pass).
