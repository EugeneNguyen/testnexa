# Project Scaffold — Pre-Implementation Plan

**Date:** 2026-09-03
**Status:** Draft — scope/files/edge-cases/open-questions only, per explicit instruction not to write code yet.
**Spec:** [docs/superpowers/specs/2026-09-03-project-scaffold-design.md](../specs/2026-09-03-project-scaffold-design.md)
**Requirement sources:** [07 ERD](../../product-discovery/07-erd-draft.md), [docs/user-stories/*](../../user-stories/)

> This is a pre-plan (scope/files/edge cases/open questions), not the bite-sized
> TDD task breakdown. Full task-by-task implementation plan (per
> `superpowers:writing-plans`) to be written once these open questions are
> resolved and the user authorizes development.

---

## Scope

Full-stack scaffold implementing the approved design spec: all 28 ERD entities
(20 core + 8 extended), multi-tenant RBAC, JWT auth for both human `User` and
`AIAgent` actors, generic schema-driven CRUD + a handful of bespoke workflow
screens, a stub first-party MCP server, and Docker Compose infra behind a
single `:8080` port.

**In scope** (mirrors spec's component list, driven by the 11 user-story files):
- Auth: local password login, JWT access+refresh, DB-revocable refresh tokens, AI-agent bearer auth (AUTH-1..4)
- Multi-tenancy + RBAC: Organization, OrgMembership, Role/Permission/RoleAssignment, seeded system roles, human-only Approval enforcement (RBAC-1..5)
- Project/Release management (PROJ-1, PROJ-2)
- Requirement/TestCondition(optional)/TestCase/TestStep authoring, both direct and TestCondition-mediated traceability paths (REQ-1..4)
- Test planning: TestPlan, EntryExitCriteria, TestCycle, Environment (PLAN-1..3)
- Test execution: TestExecution, append-only TestLog, Defect raising (EXEC-1..3)
- Governance: Approval (human-only), RiskItem, Attachment (GOV-1..3)
- Taxonomy + generic admin CRUD for all entities without a bespoke screen (ADMIN-1..2)
- Traceability matrix view + CSV export (TRACE-1..2)
- MCP server stub: create/list/update TestCase, create TestExecution, read Requirement — read-only elsewhere (MCP-1..3)
- Backend/frontend/E2E test suites per spec's Testing section
- Docker Compose: postgres, backend, frontend, nginx, single `:8080` entrypoint

**Explicitly out of scope** (carried from design spec, unchanged):
- IEEE 829/29119-3 document-format export (RTM export is CSV only)
- SSO/OIDC/SAML/LDAP — local-password `AuthIdentity` provider only
- AI test-case generation (26's hypothesis) — schema/API only, no generation logic
- Billing/usage metering

## Affected files (new, greenfield repo — nothing modified, everything created)

```
backend/
  app/models/            tenancy.py, auth.py, rbac.py, actor.py, project.py,
                          assets.py, planning.py, execution.py, trace.py,
                          taxonomy.py, governance.py
  app/schemas/            1:1 mirror of app/models/
  app/api/routes/          crud_factory.py (generic list/get/create/update/delete),
                          auth.py, rtm.py, execution.py (bespoke)
  app/core/               security.py (JWT + argon2), rbac.py (require_permission)
  app/db/                 session.py, base.py, alembic env.py
  alembic/versions/       0001_initial_schema.py, 0002_seed_roles_and_taxonomy.py
  mcp_server/             stub server, thin client over service layer
  tests/unit/             per-model/service tests
  tests/integration/      httpx + real test Postgres, RBAC allow/deny matrix
  Dockerfile, pyproject.toml (or requirements.txt)

frontend/
  src/lib/api/             typed REST client + TanStack Query hooks
  src/components/crud/     <EntityTable>, <EntityForm>
  src/entityConfigs/       one field-config object per entity (28)
  src/pages/workflows/     Login, OrgSwitcher/ProjectSwitcher, RequirementDetail,
                          TestSuiteBuilder, TestExecutionRunner, TraceabilityMatrix
  src/pages/admin/         generic CRUD pages, entity-registry-routed
  src/auth/                token handling, permission-code route guards
  tests/                  Vitest + RTL
  Dockerfile, package.json, vite.config.ts, tailwind.config.js

e2e/                      Playwright specs against docker-compose stack (localhost:8080)
docker-compose.yml         postgres, backend, frontend (dev profile), nginx
nginx/nginx.conf           /api/* -> backend, /* -> frontend
.env.example
README.md                  update with local dev instructions
```

## Edge cases to design for

- **Cross-tenant leak:** cross-org resource access must return 404, not 403 (never confirm existence across `org_id` boundary — spec's error-handling section).
- **AIAgent approval bypass attempt:** RBAC-5 requires the block enforced twice — never seeded into `ai_agent_scoped` permission bundle, AND a hardcoded 403 at the Approval-creation endpoint regardless of `RoleAssignment` contents.
- **Suspended org member:** `RoleAssignment` rows stay recorded but all API access denied until reactivated (RBAC-2) — must not be a soft/UI-only block.
- **Refresh token revocation:** used-after-revoke must 401 and force re-login (AUTH-2); revocation must be checked server-side per request, not cached.
- **First-user bootstrap:** first signup on a fresh instance auto-creates an Organization and grants `org_admin` (RBAC-1) — needs an explicit "is this the first org ever" check, not per-org.
- **TestCondition optional path:** REQ-2 (direct `RequirementTestCaseLink`) and REQ-3 (TestCondition-mediated) must coexist per-TestCase within the same project — no project-wide toggle to build.
- **TestSuite membership vs frozen execution:** suite membership is live until included in a TestPlan/TestCycle; once a TestCycle runs, past TestExecution rows must reflect what was actually in scope at run time, not current suite membership (REQ-4).
- **TestCycle execution scoping:** an execution can only be recorded for a TestCase that's a member of a TestSuite included in the TestCycle's parent TestPlan (PLAN-3) — needs a join-path check at execution-create time, not just a UI filter.
- **TestLog immutability:** no update/delete endpoint may exist for TestLog at all, not just hidden in UI (EXEC-2).
- **Re-execution history:** re-running a TestCase in the same TestCycle inserts a new TestExecution row, never overwrites (EXEC-1).
- **Org slug uniqueness:** `Organization.slug` unique across the whole deployment, not per-org (RBAC-1).
- **Generic CRUD permission parity:** the generic admin surface must call the exact same `require_permission` dependency as bespoke routes — UI hiding of buttons is cosmetic only, backend is the real gate (ADMIN-2).
- **Attachment storage bounds:** file size/type limits enforced server-side with configurable-but-sane defaults — no elastic storage guarantee on self-hosted deployments (GOV-3).
- **Auditor role:** read + RTM-export only, zero write permissions anywhere, including generic CRUD surface (TRACE-2, RBAC-4).
- **Actor joined-table inheritance:** every `created_by`/`executed_by`/`reported_by` FK points at `Actor`, resolved to `User` or `AIAgent` — query/serialization layer needs one consistent resolution helper, not ad hoc joins per route.
- **Multi-org user login:** single-org user auto-selects that org; multi-org user lands on an org picker (AUTH-1).
- **Seed migration idempotency:** `0002_seed_roles_and_taxonomy.py` must be safe to reason about on fresh DB only — confirm Alembic migration, not a script that could double-insert if rerun.

## Open questions — resolved (confirmed by user 2026-09-03)

1. **Permission code scheme:** `<resource>.<action>` pattern, resource = snake_case entity name. Writable entities get `create/read/update/delete`; system-appended-only entities (`TestLog`, the 4 `TraceabilityLink` join tables) get `read` only. Special verbs beyond CRUD: `test_plan.approve`, `requirement.export_rtm`. Full list generated mechanically from the model registry, not hand-typed per route.
2. **Attachment storage backend:** local filesystem volume by default; `ATTACHMENT_STORAGE=local|s3` env var switches to S3-compatible with creds via env when set. No admin-UI toggle in this scaffold.
3. **Frontend token refresh on page load:** app boot always attempts silent refresh via the httpOnly refresh-token cookie before rendering any protected route; failure redirects to login.
4. **AIAgent credential format/lifecycle:** opaque random API key (GitHub-PAT-style), shown once at creation, stored hashed at rest (argon2, same scheme as passwords). No rotation UI in scaffold — revoke-and-reissue only.
5. **Generic CRUD list defaults:** page size 25, offset pagination; filters are exact-match only on indexed/enum/FK fields (no free-text contains) for v1.
6. **Docker Compose prod profile:** **both `dev` and `prod` Compose profiles defined now**, not deferred. `dev` = Vite dev server proxied by nginx; `prod` = static frontend build served by nginx. Single `docker-compose.yml`, profile-gated services.
7. **Seed/demo data:** none beyond system roles + taxonomy lookups (Alembic seed migration `0002`). No demo Org/Project/sample records.
8. **Integration-test Postgres:** separate `postgres-test` Compose service (own DB name), used by the `tests/integration` suite; recreated per test run.
9. **CI pipeline:** **out of scope** for this scaffold task. Not built now; a future follow-up.
10. **TraceabilityLink join-table schemas:** each of the 4 tables (`RequirementTestCaseLink`, `RequirementTestConditionLink`, `TestConditionTestCaseLink`, `TestCaseDefectLink`) gets its own two FK columns (e.g. `requirement_id`, `test_case_id`), `link_kind` dropped (redundant — table name already encodes the relationship), unique constraint on the FK pair to block duplicate links.

## Global constraint — all primary keys are UUIDs

User correction: **no auto-increment integer PKs anywhere.** Every table's `id`
(and every other table already spec'd as `uuid id PK` in the 07 ERD) is a
UUID generated at insert time (`uuid4`, or `uuid7` if the team wants
time-sortable IDs — pick one and apply uniformly). This was already the ERD's
stated design (`uuid id PK` on every entity) — recorded here explicitly as a
hard constraint so no task substitutes a `Serial`/`Identity` column for
convenience during implementation. Applies to the 4 TraceabilityLink join
tables above too (surrogate `uuid id PK`, not a composite PK of the two FKs).

## Next step

All open questions resolved and confirmed. Ready to run
`superpowers:writing-plans` to produce the bite-sized, TDD task-by-task
implementation plan. No code until user explicitly authorizes development.
