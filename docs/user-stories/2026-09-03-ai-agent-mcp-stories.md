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
