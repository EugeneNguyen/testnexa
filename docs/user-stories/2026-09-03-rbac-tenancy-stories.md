# User Stories — Multi-Tenancy & RBAC

**Date:** 2026-09-03
**Feature area:** Organization, OrgMembership, Role, Permission, RoleAssignment
**Context:** [Business case](../business-case/2026-09-03-sovereign-ai-testing-business-case.md), [Personas](../personas/2026-09-03-target-personas.md), [Journeys](../user-journeys/2026-09-03-target-persona-journeys.md), [07-erd-draft.md](../product-discovery/07-erd-draft.md)

**Note:** This feature area is explicitly out of the validated 26-MVP scope (26 cuts multi-tenancy/RBAC entirely) — these stories exist because the user made an informed decision to scaffold the full 07 ERD instead. See [scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md) for that logged deviation.

---

## Story RBAC-1: Create an organization

**As** Marcus (regulated compliance QA manager), standing up the tool for his company,
**I want** to create an Organization as the top-level tenant boundary,
**so that** all of his org's projects, test assets, and users are isolated from any other org on the same deployment — a real requirement if his company later runs this for multiple business units or a consultancy manages several clients on one instance (07's tenancy rationale).

**Acceptance criteria:**
- Given a freshly deployed instance with no orgs, when the first user completes signup, then an Organization is created and that user is automatically granted `org_admin`.
- Given an existing org, when an `org_admin` creates a second Organization, then it is fully isolated — no Project, Requirement, TestCase, etc. from one org is visible or queryable from the other, enforced at the query layer via `org_id`.
- Organization has `name` and `slug` (unique across the deployment).

---

## Story RBAC-2: Invite and manage org members

**As** Marcus, as `org_admin`,
**I want** to invite users by email to join my Organization and manage their membership status,
**so that** I can onboard my QA team without them self-registering into the wrong org (07's `OrgMembership.status`: invited/active/suspended).

**Acceptance criteria:**
- Given an `org_admin`, when they invite a user by email, then an `OrgMembership` record is created with status `invited`.
- Given an invited user, when they complete signup via the invite, then their `OrgMembership.status` becomes `active`.
- Given an `org_admin`, when they suspend a member, then that member's `RoleAssignment`s remain recorded but all API access for that org is denied until reactivated.
- A `User` can hold `OrgMembership` in more than one Organization (07: consultant/multi-client pattern).

---

## Story RBAC-3: Assign roles, org-wide or project-scoped

**As** Marcus, as `org_admin`,
**I want** to assign a Role to a member either org-wide or scoped to a specific Project,
**so that** a user can be `org_admin` at the org level but only `tester` on Project A with no access to Project B in the same org (07's `RoleAssignment.project_id` nullable design).

**Acceptance criteria:**
- Given an `org_admin`, when they create a `RoleAssignment` with `project_id = null`, then the grantee has that role's permissions across every project in the org.
- Given an `org_admin`, when they create a `RoleAssignment` scoped to a specific `project_id`, then the grantee's permissions from that role apply only within that project.
- Given a user with no `RoleAssignment` in a given project, when they attempt any action in that project, then they receive 403 — no implicit access from org membership alone.
- `RoleAssignment.actor_id` accepts either a `User` or an `AIAgent` (via the shared `Actor` supertype) — an MCP-connected agent can be assigned a bounded role the same way a human is (07 principle #6).

---

## Story RBAC-4: Seeded system roles

**As** Marcus, as `org_admin`, immediately after creating an Organization,
**I want** a standard set of system roles already available (not built from scratch),
**so that** I can assign sensible permissions to my team on day one without designing an RBAC scheme myself (07's recommended seed roles).

**Acceptance criteria:**
- Given a newly created Organization, then the following system roles (org-scoped, `is_system_role = true`) are available for assignment without further setup: `org_admin` (org settings, billing, membership), `test_manager` (test plans, approvals, RTM/reporting), `tester` (test case authoring/execution, no approvals), `auditor` (read-only + RTM export, no write access at all), `ai_agent_scoped` (create/edit test cases and executions only, no approvals, no membership/role management — default bound for any MCP-connected agent).
- System roles' permission bundles are seeded via an Alembic data migration, not created through the UI.
- An `org_admin` can additionally define custom `Role`s scoped to their own org (`Role.org_id` non-null) — system roles are a floor, not a ceiling.

---

## Story RBAC-5: Human-only Approval enforcement

**As** Marcus, needing to answer an auditor's question "can an AI agent approve a test plan?",
**I want** the system to structurally prevent any `AIAgent` actor from ever holding an approval-granting permission,
**so that** the answer is a verifiable "no" baked into the access-control model, not a policy document he has to trust (07 principle #2 and #6 — this is the specific trust signal that makes 07's Actor model defensible to a regulated buyer).

**Acceptance criteria:**
- Given the seeded `Permission` set, then no permission of the form `test_plan.approve` (or equivalent Approval-granting action) is ever included in the `ai_agent_scoped` role's bundle, and the system rejects any attempt (via admin UI or API) to add such a permission to a role whose assignments target an `AIAgent`.
- Given an `AIAgent` actor attempting to call the Approval-creation endpoint regardless of role, then the request is rejected with 403 at the application layer as a defense-in-depth check, independent of whatever the `RoleAssignment` says (07: "policy: human User only, never AIAgent" — enforced twice, not once).
