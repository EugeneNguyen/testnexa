# Project Scaffold — Design Spec

**Date:** 2026-09-03
**Status:** Approved by user, pending implementation plan
**Owner:** xuanbinh91@gmail.com

## Context

Task: scaffold a full-stack project — React frontend, Python backend, Docker Compose infra, Tailwind CSS UI — implementing Auth, RBAC, and CRUD for all models in the full conceptual ERD ([docs/product-discovery/07-erd-draft.md](../../product-discovery/07-erd-draft.md)), plus basic user workflows.

**PM flag carried forward from discovery review:** the product-discovery set ([docs/product-discovery/](../../product-discovery/)) contains a validated, narrower MVP scope (26-mvp.md: single-org, no RBAC, 5 entities) and a Go decision (32-final-decision.md) explicitly bounded to that MVP + the still-unrun 27-experiment.md, not a full build. The user was informed of this conflict and explicitly chose to scaffold the full 07 ERD (all 28 entities, full RBAC/multi-tenancy) rather than the validated MVP subset. This is a deliberate, informed deviation from the discovery-stage recommendation, not an oversight — logged here for traceability. No `docs/requirements/` or `docs/adr/` directories existed prior to this spec; this is the first requirements artifact for the "scaffold" area.

## Stack decisions

| Layer | Choice | Why |
|---|---|---|
| Backend framework | FastAPI | Async-native, fits future first-party MCP server (06/26), auto OpenAPI docs |
| DB / ORM / migrations | PostgreSQL + SQLAlchemy 2.0 + Alembic | Mature joined-table inheritance (needed for `Actor`→`User`/`AIAgent`), real FK integrity for 20+ entity graph |
| Auth | JWT (access + refresh), refresh tokens stored in DB table (revocable) | Stateless, works uniformly for human `User` and machine `AIAgent` bearer auth; DB-backed refresh allows revocation without adding Redis |
| RBAC enforcement | FastAPI dependency-injected permission checks (`Depends(require_permission("code"))`) | Idiomatic FastAPI, explicit per-route, works identically for `User`- and `AIAgent`-backed `Actor` |
| Frontend build | Vite + React Router + TanStack Query + React Hook Form + Zod | Standard modern SPA stack, TanStack Query fits CRUD-heavy API |
| UI | Tailwind CSS | Per task requirement |
| Backend tests | pytest + pytest-asyncio (unit), pytest + httpx against real test Postgres (API/integration) | Real RBAC allow/deny coverage at HTTP layer |
| Frontend tests | Vitest + React Testing Library | Standard Vite pairing |
| E2E tests | Playwright, against the full docker-compose stack via `localhost:8080` | Full-stack workflow coverage |
| Infra | Docker Compose: `postgres`, `backend`, `frontend` (dev profile), `nginx` | Single external port `8080`; nginx routes `/api/*` → backend, `/*` → frontend (dev-server proxy in dev, static build in prod profile) |

## ERD resolution decisions (07's own open questions, resolved for this scaffold)

1. **Entity scope: all 28** (20 core + 8 extended) — user explicitly confirmed, not staged.
2. **`TraceabilityLink`: dedicated join tables**, not the generic polymorphic table drafted in 07 — `RequirementTestCaseLink`, `RequirementTestConditionLink`, `TestConditionTestCaseLink`, `TestCaseDefectLink`. Trades one unified RTM query for real DB-enforced FK integrity.
3. **`TestCondition`: optional**, not mandatory — `TestCase.test_condition_id` nullable; a direct `RequirementTestCaseLink` join table provides the lightweight path bypassing `TestCondition` entirely.
4. **Multi-tenancy**: `Organization`/`OrgMembership` implemented as real, functioning multi-org (not collapsed to a single row) since full-ERD scope was chosen.

## Architecture

```
┌─────────────┐     :8080      ┌───────────┐
│   Browser   │───────────────▶│   nginx   │
└─────────────┘                └─────┬─────┘
                          /*  ┌───────┴────────┐  /api/*
                              ▼                 ▼
                     ┌────────────────┐  ┌─────────────┐
                     │ frontend (Vite  │  │   backend   │
                     │ dev / static   │  │  (FastAPI)  │
                     │ build in prod) │  │             │
                     └────────────────┘  └──────┬──────┘
                                                 ▼
                                          ┌─────────────┐
                                          │  postgres   │
                                          └─────────────┘
```

## Backend components

- `app/models/` — SQLAlchemy 2.0 ORM, grouped by ERD cluster:
  - `tenancy.py` — Organization, OrgMembership
  - `auth.py` — AuthIdentity, RefreshToken
  - `rbac.py` — Role, Permission, RolePermission, RoleAssignment
  - `actor.py` — Actor, User, AIAgent (joined-table inheritance)
  - `project.py` — Project, Release
  - `assets.py` — Requirement, TestCondition, TestCase, TestStep, TestSuite
  - `planning.py` — TestPlan, EntryExitCriteria, TestCycle, Environment
  - `execution.py` — TestExecution, TestLog, Defect
  - `trace.py` — RequirementTestCaseLink, RequirementTestConditionLink, TestConditionTestCaseLink, TestCaseDefectLink
  - `taxonomy.py` — TestDesignTechnique, TestLevel, TestType
  - `governance.py` — Approval, RiskItem, Attachment
- `app/schemas/` — Pydantic v2 request/response models, mirrors `models/` 1:1
- `app/api/routes/` — generic CRUD router factory (list/get/create/update/delete), parametrized per model+schema, applied to all 28 entities; bespoke routes for auth (login/refresh/logout), RTM traversal, execution-run
- `app/core/security.py` — JWT issue/verify, password hashing (argon2 via passlib)
- `app/core/rbac.py` — `require_permission(code: str)` dependency: resolves `Actor` from bearer token → `RoleAssignment` (org-wide or project-scoped) → checks `Permission.code`
- `app/db/` — session management, Alembic env
- `alembic/versions/` — initial migration (all 28 tables) + seed migration (system roles per 07: `org_admin`, `test_manager`, `tester`, `auditor`, `ai_agent_scoped`, with their permission bundles)
- `mcp_server/` — stub first-party MCP server (per 06/26), thin client over the same service layer: create/list/update TestCase, create TestExecution, read Requirement

## Frontend components

- `src/lib/api/` — typed REST client + TanStack Query hooks (`useEntityList`, `useEntity`, `useCreateEntity`, `useUpdateEntity`, `useDeleteEntity`)
- `src/components/crud/` — generic `<EntityTable>` and `<EntityForm>` (react-hook-form + zod), driven by per-entity field-config objects in `src/entityConfigs/`
- `src/pages/workflows/` — bespoke screens: `Login`, `OrgSwitcher`/`ProjectSwitcher`, `RequirementDetail` (Requirement → optional TestCondition → TestCase), `TestSuiteBuilder`, `TestExecutionRunner` (pass/fail/blocked + notes, raises Defect), `TraceabilityMatrix`
- `src/pages/admin/` — generic CRUD pages for all other entities, routed from an entity registry
- `src/auth/` — JWT handling (access token in memory, refresh token in httpOnly cookie), route guards on permission codes from `/api/me`

## Data flow (representative workflow)

Login → pick Org/Project → create Requirement → optional TestCondition → create TestCase(+TestSteps) → link via join table → add to TestSuite → TestSuite included in TestPlan → TestCycle runs it in an Environment → TestExecution recorded → failure raises Defect → all linked entities traceable via `TraceabilityMatrix`.

## Error handling

- Backend: consistent JSON error shape (`{code, message, field_errors?}`); 401 (unauthenticated) vs 403 (permission-denied) distinguished; 404 for missing/cross-tenant resources (never leak existence across `org_id` boundary)
- Frontend: TanStack Query error boundaries per page; 422 field errors mapped to react-hook-form

## Testing

- Backend unit: pytest, isolated model/service logic
- Backend API/integration: pytest + httpx against real dockerized test Postgres — RBAC allow/deny matrix per role
- Frontend unit: Vitest + RTL — generic CRUD components + bespoke workflow screens
- E2E: Playwright — login→requirement→test case→execution flow; RBAC-denial flow (tester blocked from Approval-only routes)

## Out of scope for this scaffold

- Traceability/reporting exports (IEEE 829/29119-3 document generation) — schema supports it, export UI/logic not built
- SSO/OIDC/SAML/LDAP `AuthIdentity` providers — schema supports multiple providers, only local-password provider implemented
- BYO-LLM AI test-case generation (26's core hypothesis) — not part of this scaffold task; scaffold provides the data model/API the generation feature would plug into later
- Billing/usage-metering (25's business model) — not part of scaffold
