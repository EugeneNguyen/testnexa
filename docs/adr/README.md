# Architecture Decision Records

Index of ADRs for the Project Scaffold. Format: [MADR](https://adr.github.io/madr/)-style (Context / Decision / Consequences / Alternatives). First ADRs for this repo — no prior `docs/adr/` existed (noted in the [scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md)).

| # | Title | Status |
|---|---|---|
| [0001](0001-full-erd-scope-over-validated-mvp.md) | Full 07 ERD scope over validated MVP | Accepted |
| [0002](0002-backend-framework-orm-migrations.md) | Backend framework/ORM/migrations: FastAPI + PostgreSQL + SQLAlchemy 2.0 + Alembic | Accepted |
| [0003](0003-auth-token-strategy.md) | Auth & token strategy: JWT + DB-revocable refresh + AIAgent API key | Accepted |
| [0004](0004-rbac-design.md) | RBAC: dependency-injected permission checks over shared Actor | Accepted |
| [0005](0005-traceability-link-dedicated-join-tables.md) | TraceabilityLink as dedicated join tables, not a generic polymorphic table | Accepted |
| [0006](0006-test-condition-optional.md) | TestCondition is optional, not mandatory | Accepted |
| [0007](0007-real-multi-tenancy.md) | Real multi-org multi-tenancy (not collapsed to one row) | Accepted |
| [0008](0008-uuid-primary-keys.md) | All primary keys are UUIDs, no auto-increment | Accepted |
| [0009](0009-frontend-stack.md) | Frontend stack: Vite + React Router + TanStack Query + RHF + Zod + ~~Tailwind~~ | Partially superseded by 0012 |
| [0010](0010-single-port-docker-compose-topology.md) | Single-port Docker Compose topology, dev+prod profiles | Accepted |
| [0011](0011-login-rate-limiting.md) | Login rate limiting: DB-backed per-(IP, email) throttle, no Redis | Accepted |
| [0012](0012-coreui-design-system.md) | CoreUI for React as the project's design system (replaces Tailwind) | Accepted |
| [0013](0013-refresh-token-rotation-policy.md) | Refresh token rotation & session-persistence policy: rotate-on-use, absolute-expiry-inherited, org re-check on refresh | Accepted |
| [0014](0014-logout-session-revocation-policy.md) | Logout: idempotent single-session revocation, client-side-clear-always | Accepted |
| [0015](0015-ai-agent-credential-mechanics.md) | AI agent credential mechanics: key format, key_prefix lookup, minimal-RBAC-now, 404-vs-403 org-scoped precedent | Accepted |
| [0016](0016-organization-bootstrap-creation-flow.md) | Organization bootstrap & creation flow: signup vs. `POST /orgs` split, bootstrap-closes-after-first-org, advisory-lock concurrency guard, any-org permission gate | Accepted |
| [0017](0017-project-creation-flow.md) | Project creation flow: bespoke org-path-scoped create vs. row-resolved read/update, unconditional creator `test_manager` role auto-assignment, `standards_profile` inheritance from `Organization.default_standards_profile` | Accepted |
| [0018](0018-admin-shell-sidebar-layout.md) | Admin shell layout: CoreUI `CSidebar`/`CSidebarNav` + `CHeader` persistent shell, single nav-item list, CoreUI's own responsive collapse (no custom logic) | Partially superseded by 0020 |
| [0019](0019-release-creation-flow.md) | Release creation flow: project-path-scoped bespoke create/list vs. row-resolved single-fetch/audit-query, `test_manager` RBAC bundle extension, triple-permission gate + nested-executions shape for the release→cycles audit query, pinned `NULLS LAST` sort | Accepted |
| [0020](0020-admin-shell-full-template-parity.md) | Full CoreUI free-admin-template parity: breadcrumb, footer, dashboard widgets, dark/light mode toggle, UI-element reference pages (template scaffolding, no FR/NFR backing) | Accepted |
| [0021](0021-frontend-shared-component-location.md) | Frontend shared-component location (`components/shared/` vs. `components/crud/` vs. page-local) & `FormField`'s `CFormFeedback`+`invalid` error-display convention | Accepted |

**Deciders on all ADRs below:** xuanbinh91@gmail.com (CTO), unless noted otherwise.
**Date:** 2026-09-03 (0001–0017), 2026-09-04 (0018–0020), 2026-09-05 (0021)
