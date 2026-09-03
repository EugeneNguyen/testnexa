# API Document — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [Database Document](../database/2026-09-03-database-design.md), [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md)

REST over HTTPS, JSON bodies, base path `/api/v1`. FastAPI auto-generates the OpenAPI schema from the implementation — this document is the design-level contract new routes must match, not a substitute for the generated spec once code exists.

---

## 1. Conventions

- **Base path:** `/api/v1`.
- **Auth header:** `Authorization: Bearer <access_token>` on every route except `POST /auth/login` and `POST /auth/refresh`.
- **Pagination:** offset-based, `?page=1&page_size=25` (default/max page_size = 25 per NFR-6). List responses shape: `{items: [...], total: int, page: int, page_size: int}`.
- **Filtering:** exact-match query params on indexed/enum/FK fields only for v1 (e.g. `?status=draft&project_id=<uuid>`), no free-text `contains` operator in this scaffold.
- **Error shape** (NFR-8), on every non-2xx response:
  ```
  {"code": "string", "message": "human-readable string", "field_errors": {"field_name": ["msg"]} | null}
  ```
- **Status codes:** `401` = unauthenticated (missing/expired/invalid token); `403` = authenticated but permission-denied; `404` = not found **or** cross-tenant (NFR-1 — never distinguishes the two); `422` = validation error (`field_errors` populated).
- **Permission codes:** `<resource>.<action>`. Resource = snake_case entity name. Default actions `create/read/update/delete` for writable entities; `read`-only for `TestLog` and the 4 traceability link tables (system-appended, no direct write API). Special verbs beyond CRUD: `test_plan.approve`, `requirement.export_rtm`. The full code list is generated mechanically from the model registry at startup (one Alembic-seeded `Permission` row per `resource.action` pair) — not hand-maintained.

## 2. Auth routes (bespoke)

| Method | Path | Permission | Maps to |
|---|---|---|---|
| POST | `/auth/login` | none (public) | FR-AUTH-1 |
| POST | `/auth/refresh` | none (valid refresh cookie required) | FR-AUTH-2 |
| POST | `/auth/logout` | authenticated | FR-AUTH-3 |
| GET | `/auth/me` | authenticated | returns current Actor + resolved permission codes, drives frontend route guards |
| POST | `/orgs/{org_id}/agents` | `ai_agent.create` (org_admin only) | FR-AUTH-4 — issues AIAgent + one-time API key |
| POST | `/orgs/{org_id}/agents/{agent_id}/revoke` | `ai_agent.update` | FR-AUTH-4 |

`POST /auth/login` request: `{email, password}`. Response: `{access_token, org_context: "auto" | "picker", orgs: [...] }` per AUTH-1's single-org-vs-multi-org branch; refresh token is set as an httpOnly cookie, never in the JSON body.

## 3. Generic CRUD routes (router factory, applied to ~24 of 35 tables)

One factory, parametrized per entity+schema, producing 5 routes. Example shown for `requirement`; the same shape applies to every entity listed in the [Database Document](../database/2026-09-03-database-design.md) except the bespoke ones in §4 and the read-only ones in §5.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/requirements` | `requirement.read` | paginated, filterable |
| GET | `/requirements/{id}` | `requirement.read` | 404 if cross-tenant |
| POST | `/requirements` | `requirement.create` | 422 on validation error |
| PATCH | `/requirements/{id}` | `requirement.update` | partial update |
| DELETE | `/requirements/{id}` | `requirement.delete` | hard delete for lookups; RESTRICT-blocked (409) if referenced, for core assets |

Entities served by the generic factory: `Organization`\*, `Project`, `Release`, `Requirement`, `TestCondition`, `TestCase`, `TestStep`, `TestSuite`, `TestPlan`, `EntryExitCriteria`, `TestCycle`, `Environment`, `Defect`, `RiskItem`, `Attachment`, `Role`, `Permission`\*\*, `TestDesignTechnique`, `TestLevel`, `TestType`, `OrgMembership`, `RoleAssignment`.

\* `Organization` create is only reachable via the signup/bootstrap flow (RBAC-1), not a bare `POST /organizations`.
\*\* `Permission` is read-only via the generic factory — the catalog is seeded, not user-editable, so only `GET` routes are registered for it.

## 4. Bespoke routes

| Method | Path | Permission | Maps to |
|---|---|---|---|
| POST | `/requirements/{id}/test-cases` | `test_case.create` | FR-REQ-2 — direct link path, creates TestCase + RequirementTestCaseLink atomically |
| POST | `/requirements/{id}/test-conditions` | `test_condition.create` | FR-REQ-3 — creates TestCondition + RequirementTestConditionLink |
| POST | `/test-conditions/{id}/test-cases` | `test_case.create` | FR-REQ-3 — creates TestCase + TestConditionTestCaseLink |
| POST | `/test-suites/{id}/test-cases/{case_id}` | `test_suite.update` | FR-REQ-4 — add to suite (join row) |
| DELETE | `/test-suites/{id}/test-cases/{case_id}` | `test_suite.update` | FR-REQ-4 — remove from suite |
| POST | `/test-plans/{id}/test-suites/{suite_id}` | `test_plan.update` | PLAN-1 — include suite in plan |
| POST | `/test-cycles/{id}/executions` | `test_execution.create` | FR-EXEC-1 — rejects (422) if `test_case_id` not in a suite included in the cycle's parent plan (PLAN-3 scope check) |
| GET | `/executions/{id}/logs` | `test_execution.read` | FR-EXEC-2 — ordered TestLog timeline, read-only |
| POST | `/executions/{id}/defects` | `defect.create` | FR-EXEC-3 — creates Defect + TestCaseDefectLink, only when execution `result = fail` |
| POST | `/test-plans/{id}/approve` | `test_plan.approve` | FR-GOV-1 — 403 hardcoded if caller resolves to AIAgent, independent of RoleAssignment (RBAC-5) |
| GET | `/requirements/{id}/traceability` | `requirement.read` | FR-TRACE-1 — full chain view |
| GET | `/projects/{id}/traceability-matrix` | `requirement.export_rtm` | FR-TRACE-2 — tabular RTM |
| GET | `/projects/{id}/traceability-matrix.csv` | `requirement.export_rtm` | FR-TRACE-2 — CSV export |
| GET | `/projects/{id}/reports/design-technique-coverage` | `test_case.read` | ADMIN-1 — "% test cases with ≥1 TestDesignTechnique" |

## 5. Read-only routes (system-appended entities, no create/update/delete API)

| Method | Path | Permission |
|---|---|---|
| GET | `/executions/{id}/logs` | `test_log.read` (see §4 — same route, listed here for the read-only contract) |
| GET | `/requirements/{id}/traceability` etc. | resource-specific `.read` — the 4 link tables are never directly POSTed/PATCHed/DELETEd; they're written only as a side effect of the bespoke routes in §4 |

## 6. MCP server tool surface

Thin client over the **same service layer** as the REST routes above — no separate, weaker validation/permission path (MCP-1's explicit requirement).

| Tool | Backing route/permission | Maps to |
|---|---|---|
| `create_test_case` | `POST /requirements/{id}/test-cases` or `/test-conditions/{id}/test-cases`, `test_case.create` | FR-MCP-1 |
| `list_test_cases` | `GET /requirements/{id}/test-cases` (filtered list), `test_case.read` | FR-MCP-1 |
| `update_test_case` | `PATCH /test-cases/{id}`, `test_case.update` | FR-MCP-2 |
| `create_test_execution` | `POST /test-cycles/{id}/executions`, `test_execution.create` | FR-MCP-3 |
| `read_requirement` | `GET /requirements/{id}`, `requirement.read` | FR-MCP-3 — read-only, no requirement-write/approval/membership tools in this scaffold, matching 26's MVP-scoped MCP surface |

Every MCP-originated write records `created_by_actor_id`/`executed_by_actor_id` pointing at the calling `AIAgent`, with `AIAgent.acting_on_behalf_of_user_id` carried through for accountability (MCP-1).

## 7. Cross-cutting error examples

**401, expired access token:**
```
{"code": "token_expired", "message": "Access token has expired.", "field_errors": null}
```

**403, AIAgent attempting Approval:**
```
{"code": "actor_forbidden", "message": "This action is restricted to human users.", "field_errors": null}
```

**404, cross-tenant Requirement fetch (never reveals existence):**
```
{"code": "not_found", "message": "Requirement not found.", "field_errors": null}
```

**422, TestCase create with bad `test_level_id`:**
```
{"code": "validation_error", "message": "Request failed validation.", "field_errors": {"test_level_id": ["must reference an existing TestLevel"]}}
```
