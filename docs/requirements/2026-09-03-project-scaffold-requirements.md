# Requirements Document — Project Scaffold

**Date:** 2026-09-03
**Status:** Approved for planning
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [07 ERD](../product-discovery/07-erd-draft.md), [docs/user-stories/*](../user-stories/), [ADRs](../adr/README.md)

---

## 1. Purpose & scope

This document consolidates functional (FR) and non-functional (NFR) requirements for the scaffold: a full-stack ISTQB/IEEE829-aligned test management tool implementing the complete [07 ERD](../product-discovery/07-erd-draft.md) (28 entities), multi-tenant RBAC, JWT auth for human and AI-agent actors, and a first-party MCP server. Scope boundaries and the deliberate deviation from the validated MVP are recorded in [ADR-0001](../adr/0001-full-erd-scope-over-validated-mvp.md).

**Out of scope** (unchanged from the design spec): IEEE 829/29119-3 document-format export (RTM export is CSV only), SSO/OIDC/SAML/LDAP providers, AI test-case generation, billing/usage metering.

## 2. Functional requirements

Each FR ID maps 1:1 to the acceptance criteria already ratified in `docs/user-stories/`; this section is the canonical index, not a restatement — see the linked story for full Given/When/Then criteria. Priority: **Must** (blocks scaffold completion), **Should** (build now, lower polish priority), **Could** (exploratory, structural-only).

### 2.1 Authentication — [auth-stories.md](../user-stories/2026-09-03-auth-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-AUTH-1 | Local password login (email/username + password → access+refresh token) | Must | User, AuthIdentity |
| FR-AUTH-2 | Session persistence via revocable, DB-backed refresh token | Must | RefreshToken |
| FR-AUTH-3 | Explicit logout revokes refresh token server-side | Must | RefreshToken |
| FR-AUTH-4 | AI agent bearer authentication via long-lived scoped credential | Should | AIAgent, Actor |

### 2.2 Multi-tenancy & RBAC — [rbac-tenancy-stories.md](../user-stories/2026-09-03-rbac-tenancy-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-RBAC-1 | Create an Organization; first-ever signup auto-creates org + org_admin | Must | Organization |
| FR-RBAC-2 | Invite/suspend/reactivate org members | Must | OrgMembership |
| FR-RBAC-3 | Assign roles org-wide or project-scoped | Must | RoleAssignment |
| FR-RBAC-4 | Seeded system roles (org_admin, test_manager, tester, auditor, ai_agent_scoped) | Must | Role, Permission, RolePermission |
| FR-RBAC-5 | Structural human-only Approval enforcement (double-enforced) | Must | Permission, RoleAssignment |

### 2.3 Project & Release — [project-release-stories.md](../user-stories/2026-09-03-project-release-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-PROJ-1 | Create a Project scoped to an Organization, with standards_profile | Must | Project |
| FR-PROJ-2 | Create a Release; associate TestCycles with it | Must | Release, TestCycle |

### 2.4 Requirement & test case authoring — [requirement-testcase-authoring-stories.md](../user-stories/2026-09-03-requirement-testcase-authoring-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-REQ-1 | Capture a Requirement (title, description, source, external_ref) | Must | Requirement |
| FR-REQ-2 | Author a TestCase directly from a Requirement (lightweight path) | Must | TestCase, RequirementTestCaseLink |
| FR-REQ-3 | Author a TestCase via optional TestCondition (rigor path) | Must | TestCondition, RequirementTestConditionLink, TestConditionTestCaseLink |
| FR-REQ-4 | Organize TestCases into TestSuites (many-to-many) | Must | TestSuite |

### 2.5 Test planning — [test-planning-stories.md](../user-stories/2026-09-03-test-planning-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-PLAN-1 | Create a TestPlan (identifier/scope/approach/staffing/schedule) | Must | TestPlan |
| FR-PLAN-2 | Define entry/exit/suspension/resumption criteria | Must | EntryExitCriteria |
| FR-PLAN-3 | Run a TestCycle under a TestPlan, targeted at a Release, in an Environment | Must | TestCycle, Environment |

### 2.6 Test execution & defects — [test-execution-defect-stories.md](../user-stories/2026-09-03-test-execution-defect-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-EXEC-1 | Record a TestExecution result (pass/fail/blocked/skipped) | Must | TestExecution |
| FR-EXEC-2 | Append-only TestLog for every status change/comment/agent action | Must | TestLog |
| FR-EXEC-3 | Raise a Defect from a failed TestExecution | Must | Defect, TestCaseDefectLink |

### 2.7 Governance — [governance-stories.md](../user-stories/2026-09-03-governance-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-GOV-1 | Approve a TestPlan (human-only) | Must | Approval |
| FR-GOV-2 | Track RiskItems against a Requirement or TestPlan | Should | RiskItem |
| FR-GOV-3 | Attach files to a TestCase (operator-configured storage) | Should | Attachment |

### 2.8 Taxonomy & generic admin CRUD — [taxonomy-admin-crud-stories.md](../user-stories/2026-09-03-taxonomy-admin-crud-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-ADMIN-1 | Classify a TestCase by TestDesignTechnique/TestLevel/TestType | Should | TestDesignTechnique, TestLevel, TestType |
| FR-ADMIN-2 | Generic list/create/edit/delete CRUD for every entity without a bespoke screen | Must | all remaining entities |

### 2.9 Traceability matrix — [traceability-stories.md](../user-stories/2026-09-03-traceability-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-TRACE-1 | View a Requirement's full traceability chain (Requirement→[TestCondition]→TestCase→TestExecution→Defect) | Must | all 4 link tables |
| FR-TRACE-2 | Project-level RTM view with CSV export, auditor-role read-only access | Must | all 4 link tables |

### 2.10 AI agent / MCP — [ai-agent-mcp-stories.md](../user-stories/2026-09-03-ai-agent-mcp-stories.md)

| ID | Title | Priority | Entities |
|---|---|---|---|
| FR-MCP-1 | Agent creates/lists TestCases via MCP, same permission path as REST | Could | TestCase |
| FR-MCP-2 | Agent updates a TestCase via MCP | Could | TestCase |
| FR-MCP-3 | Agent creates a TestExecution and reads a Requirement via MCP (read-only on Requirement) | Could | TestExecution, Requirement |

## 3. Non-functional requirements

| ID | Requirement | Rationale / source |
|---|---|---|
| NFR-1 | Cross-tenant resource access returns 404, never 403 — existence is never confirmable across an `org_id` boundary. | Spec error-handling section; ADR-0007 |
| NFR-2 | `TestLog` is immutable — no update/delete endpoint exists at all, not merely hidden in UI. Approval records are never deleted. | EXEC-2, GOV-1 |
| NFR-3 | Passwords argon2-hashed at rest, never logged in plaintext. AI-agent API keys argon2-hashed at rest, shown once at creation. All primary keys are non-guessable UUIDv7. | AUTH-1, ADR-0003, ADR-0008 |
| NFR-4 | Attachments stored on operator-controlled storage (local filesystem by default, S3-compatible via `ATTACHMENT_STORAGE` config) — never routed through a third-party SaaS storage service by default. | GOV-3, business case (self-hosting/data sovereignty) |
| NFR-5 | `TestPlan`/`EntryExitCriteria`/`Approval` map directly to IEEE 829/ISO 29119-3 Test Plan sections; `TestCondition`/`TestLevel`/`TestType`/`TestDesignTechnique` are structured lookups matching ISTQB CTFL v4.0.1 vocabulary, not free text. | 07 ERD "compatibility question" table |
| NFR-6 | Generic CRUD list endpoints are paginated (page size 25, offset pagination) to bound response size across all 28 entities. | ADMIN-2, pre-implementation plan open question #5 |
| NFR-7 | Attachment file size/type limits are enforced server-side with configurable, sane defaults — no assumption of elastic storage on a self-hosted deployment. | GOV-3 |
| NFR-8 | Every API error uses a consistent JSON shape (`{code, message, field_errors?}`); 401 (unauthenticated) and 403 (permission-denied) are always distinguished. | Spec error-handling section |
| NFR-9 | RBAC allow/deny behavior is covered by integration tests at the HTTP layer against a real (dockerized) Postgres, per role — not unit-tested against mocked permission logic alone. | Spec Testing section |
| NFR-10 | The generic CRUD admin surface enforces permissions via the exact same `require_permission` dependency as bespoke routes — UI hiding of actions is a convenience, never the enforcement boundary. | ADMIN-2, ADR-0004 |

## 4. Traceability — requirements to architecture decisions

| FR/NFR group | Relevant ADR |
|---|---|
| FR-RBAC-*, NFR-1, NFR-10 | [ADR-0004](../adr/0004-rbac-design.md) RBAC design |
| FR-RBAC-5, FR-GOV-1 | [ADR-0004](../adr/0004-rbac-design.md) (human-only Approval, enforced twice) |
| FR-TRACE-* | [ADR-0005](../adr/0005-traceability-link-dedicated-join-tables.md) TraceabilityLink join tables |
| FR-REQ-2, FR-REQ-3 | [ADR-0006](../adr/0006-test-condition-optional.md) TestCondition optional |
| FR-RBAC-1, FR-RBAC-2 | [ADR-0007](../adr/0007-real-multi-tenancy.md) Real multi-tenancy |
| NFR-3 (UUID PKs) | [ADR-0008](../adr/0008-uuid-primary-keys.md) UUID primary keys |
| FR-AUTH-* | [ADR-0003](../adr/0003-auth-token-strategy.md) Auth & token strategy |
| FR-MCP-* | [ADR-0002](../adr/0002-backend-framework-orm-migrations.md) (async backend), [ADR-0003](../adr/0003-auth-token-strategy.md) (AIAgent credential) |

Full field-level traceability (Requirement → design technique → test case → execution → defect) is itself FR-TRACE-1/2 — this document is the requirements layer that feeds the [WBS](../wbs/2026-09-03-project-scaffold-wbs.md), [Database Document](../database/2026-09-03-database-design.md), [API Document](../api/2026-09-03-api-design.md), and [Test Plan](../test-plan/2026-09-03-master-test-plan.md).
