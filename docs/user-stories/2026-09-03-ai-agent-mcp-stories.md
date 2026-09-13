# User Stories — AI Agent / MCP Server Operations

**Date:** 2026-09-03
**Feature area:** AIAgent Actor, first-party MCP server surface
**Context:** [Personas](../personas/2026-09-03-target-personas.md) (Persona 3, agent-primary team — exploratory), [Journeys](../user-journeys/2026-09-03-target-persona-journeys.md) (Journey 3), [06-ai-mcp-landscape.md](../product-discovery/06-ai-mcp-landscape.md), [26-mvp.md](../product-discovery/26-mvp.md)

**Note:** Per the personas/journeys docs, this persona has zero validated willingness-to-pay evidence and isn't currently in 27-experiment's recruitment plan. These stories build the structural capability (07's Actor model already requires it either way) but should not be prioritized ahead of the human-facing stories in other files.

---

## Story MCP-1: Agent creates and lists test cases via MCP

**As** an AI coding agent (Claude Code, Cursor) operating on behalf of an agent-primary team,
**I want** to create and list TestCases through the MCP server using the same underlying service/permission layer a human uses through the REST API,
**so that** an agent can drive the test-authoring workflow end to end without a human filling in a web form for each one (06's finding: several competitors already ship agentic generation/execution; no self-hosted competitor ships first-party MCP).

**Acceptance criteria:**
- Given an authenticated `AIAgent` actor (AUTH-4) with `test_case.create`/`test_case.read` permission via its `RoleAssignment`, when the MCP server receives a create-TestCase or list-TestCases tool call, then it performs the same validation and permission check as the REST endpoint (no separate, weaker code path for MCP).
- Every TestCase created via MCP records `created_by_actor_id` pointing at the `AIAgent`, and `AIAgent.acting_on_behalf_of_user_id` preserves which human is accountable for that agent's actions (07: "accountability link, not a real approver").
- MCP tool responses return the same shape/fields as the REST API's TestCase schema — no divergent data contract between the two access paths.

---

## Story MCP-2: Agent updates a test case

**As** an AI coding agent,
**I want** to update an existing TestCase's fields (status, steps, expected results) via MCP,
**so that** it can refine a test case based on new information (e.g., a code change) without a human relaying the edit manually.

**Acceptance criteria:**
- Given an `AIAgent` with `test_case.update` permission, when it calls the update-TestCase tool, then the change is applied and a TestLog-equivalent record captures it as an `agent_action` event type (EXEC-2's append-only log applies here too, for TestCase edit history if the entity has one, or at minimum the action is attributable via `created_by_actor_id`/audit fields).
- Given an `AIAgent` without `test_case.update` permission (e.g., scoped only to Project X, attempting Project Y), then the request is rejected with 403.

---

## Story MCP-3: Agent creates a test execution and reads a requirement

**As** an AI coding agent,
**I want** to create a TestExecution result and read Requirement content via MCP,
**so that** it can run a test case's steps (e.g., driving a browser or CLI) and record what happened, grounded in what the requirement actually asked for.

**Acceptance criteria:**
- Given an `AIAgent` with `test_execution.create` permission, when it calls the create-TestExecution tool with a result and actual_result notes, then a TestExecution row is created exactly as in EXEC-1, with `executed_by_actor_id` pointing at the agent.
- Given an `AIAgent` with `requirement.read` permission, when it calls the read-Requirement tool, then it receives the same Requirement data a human would see via the REST API — read-only, no ability to create/edit Requirements via MCP in this scaffold (matches 26's MVP-scoped MCP surface: "create/list/update TestCase, create TestExecution, read Requirement" — no requirement-write, no approval, no membership/role management via MCP).

---

## Story MCP-4: Human sets up and manages MCP client access

**As** an org member configuring the human side of the agent-primary workflow MCP-1..3 build the mechanism for,
**I want** an in-app screen that explains what the MCP server is, gives me copy-pasteable client-connection instructions, and lets me issue/list/revoke an `AIAgent` bearer credential without touching the API directly,
**so that** connecting Claude Code, Codex, or any other MCP-HTTP client to this org's TestNexa instance doesn't require reading the backend's own implementation notes or crafting raw HTTP requests.

**Acceptance criteria:**
- Given an authenticated human org member, when they navigate to the org's MCP Integration screen (org-scoped, since `AIAgent` credentials are org-scoped, ADR-0015), then they see the server URL, a plain-language explanation of MCP, and connection instructions for at least Claude Code, Codex, and Cursor.
- Given the same screen, when they submit the issue-key form (agent name + optional model/provider + an active org member to hold accountability via `acting_on_behalf_of_user_id`), then a new `AIAgent` credential is created via the existing `POST /orgs/{org_id}/agents` route (ADR-0015) and the raw key is shown exactly once, never persisted or re-fetchable client-side.
- Given one or more previously-issued credentials, when the screen loads, then it lists them (name, model/provider, key prefix, issued/last-used timestamps, active/revoked status) via a new `GET /orgs/{org_id}/agents` route, including already-revoked ones — management needs the history, not just the active set.
- Given an active credential's row, when the member clicks Revoke, then `POST /orgs/{org_id}/agents/{agent_id}/revoke` (ADR-0015, already-shipped) is called and the row updates to Revoked without a page reload.
- Given a project-scoped route (`/projects/:projectId/mcp`), when a member visits it, then they see the same connection docs plus a link back to the org-scoped screen for key management — no separate per-project credential exists (agents are org-scoped only).

---

## Story MCP-5: Agent performs full CRUD on every entity via MCP

**As** an AI coding agent operating on behalf of an agent-primary team,
**I want** list/get/create/update/delete access to every entity this product manages via MCP — not just the `TestCase`/`TestExecution`/`Requirement` slice MCP-1..3 opened — restricted to exactly the methods a human REST caller already has for that entity,
**so that** an agent can drive the full test-management workflow (plan, author, execute, triage, administer) without a human relaying every other entity's changes through the web UI on its behalf.

**Acceptance criteria:**
- Given an `AIAgent` actor with the relevant permission code, when it calls a generic entity tool (`list_entities`/`get_entity`/`create_entity`/`update_entity`/`delete_entity`) against any entity the generic CRUD factory serves (ADR-0022), then it performs the same validation/permission/tenant-boundary check the REST route for that entity performs — no separate, weaker code path for MCP (same AC1 posture MCP-1 established, now generalized to every entity instead of just `TestCase`).
- Given an entity whose `CrudEntityConfig.methods` excludes a given operation on REST (e.g. `TestCase` has no factory `create`, the 4 link tables have no `create`/`update`/`delete` at all), when the matching MCP tool is called for that operation, then it is rejected with the same error shape a REST client hitting the unregistered method would see — the MCP surface never grants an entity a capability its REST surface doesn't have.
- Given an entity whose create path is bespoke rather than factory-registered (e.g. `TestCase`'s two create routes, `TestCondition`, `TestExecution`, `Defect`, `Project`, `RoleAssignment`, `OrgMembership`), when the matching MCP create tool is called, then it dispatches to that same bespoke route handler, preserving every business-rule rejection (PLAN-3's scope check, `TestSuite`/`TestPlan` cross-project rejection, etc.) the REST path enforces.
- Given an `AIAgent` actor calling any generic-factory entity's tool, when the underlying tenant-boundary check runs, then it resolves the calling agent's accountable human via `acting_on_behalf_of_user_id` (the same `_actor_membership_exists` mechanism NFR-43 already requires of the bespoke `TestCase` routes) rather than the actor's own `actor_id` — closing a gap where the generic factory's own gate never adopted that mechanism, so no `AIAgent` could reach any of the 27 factory-served entities via MCP before this story, regardless of its granted permissions.
- Given a future new bespoke mutating route or a `CrudEntityConfig.methods` change on `main`, the MCP tool surface reflects it without a parallel, hand-maintained MCP-side edit — both surfaces read from one registry, not two independently-kept lists.

> **MCP-6 ([ADR-0067](../adr/0067-mcp-6-per-entity-mcp-tools.md), 2026-09-13) re-advertises MCP-5's surface, it does not change it.** MCP-5's ACs above stay true word-for-word about *what* an agent can do and *how* it is dispatched; only the tool names and argument placement change — see Story MCP-6 below. The one AC that needed correcting is the second one: "rejected with the same error shape a REST client hitting the unregistered method would see" became "never advertised in the first place," which is strictly stronger.

## Story MCP-6: Agent finds the right tool without guessing an entity name

**As** an AI coding agent driving this product through MCP,
**I want** each entity/action capability to be its own named tool with its own argument schema, rather than a handful of generic tools that take the entity name as a string,
**so that** I can see from the tool list alone what is possible for each entity, and cannot spend a call discovering that a slug was wrong or that an operation was never supported.

**Acceptance criteria:**
- Given the MCP server, when a client lists tools, then it sees one tool per entity per supported action, named `tn_<entity>_<action>` using the entity's own `resource` slug verbatim (`tn_organization_get`, `tn_project_create`, `tn_requirement_list`, `tn_test_case_update`), with a description naming the entity, the REST route it mirrors, and any required scope key or parent id.
- Given an entity/action pair REST does not support (`test_log` update, `permission` delete, a link table's create, `release`'s anything-but-create), when a client lists tools, then no tool for that pair exists at all — the capability is never advertised, not refused on call. This supersedes MCP-5's own "rejected with the same error shape" AC for this case.
- Given any tool, when a client reads its input schema, then it sees only that action's real parameters (`id`, `fields`, `scope`/`filters`/`search`/`sort`/`page`/`page_size`) and **no `resource` parameter** — the entity is the tool's identity, not one of its inputs.
- Given an entity whose create or list is a bespoke REST route, when its tool is called, then the parent id that route takes as a URL path parameter is supplied inside `fields` (create) or `scope` (list), uniformly with how every generic entity's own scope field is already passed, and the tool's own description says so.
- Given MCP-1's `create_test_case`/`list_test_cases`, then they no longer exist under those names: the capabilities are `tn_test_case_create` (which additionally supports REQ-3's rigor path, which the hand-wired tool never did) and `tn_test_case_list`. One capability, one name — no alias, no deprecation window.
- Given a future entity, bespoke route, or `CrudEntityConfig.methods` change, then its tools appear or disappear without any hand-edited tool list — the surface is generated from the registry, and a diff-based test fails if the generated set ever stops matching each entity's own `full_methods` plus declared bespoke extras.

