# Test Cases — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [Test Design](../test-design/2026-09-03-test-design.md), [Master Test Plan](../test-plan/2026-09-03-master-test-plan.md), [docs/user-stories/*](../user-stories/), [AUTH-1 scope plan](../superpowers/plans/2026-09-03-auth-1-local-password-login-plan.md), [AUTH-2 scope plan](../superpowers/plans/2026-09-03-auth-2-session-persistence-plan.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md)

Concrete test cases derived from each user story's acceptance criteria. IDs group by feature area; **Story** column links back to the source acceptance criterion. Priority: **P1** = release-blocking, **P2** = should-have, **P3** = exploratory/structural-only (per FR priority in the Requirements Document).

---

## Auth

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-AUTH-001 | Login with valid credentials | Registered user exists | POST `/auth/login` with correct email+password | 200; access+refresh token issued; redirected to default org/project view | P1 | AUTH-1 |
| TC-AUTH-002 | Login with invalid credentials | — | POST `/auth/login` with wrong password | 401; generic "invalid credentials" message; body identical to unknown-email case (no enumeration) | P1 | AUTH-1 |
| TC-AUTH-003 | Login, single-org user | User has exactly 1 OrgMembership | Login | That org auto-selected, no picker shown | P1 | AUTH-1 |
| TC-AUTH-004 | Login, multi-org user | User has 2+ OrgMemberships | Login | Org picker shown | P1 | AUTH-1 |
| TC-AUTH-005 | Password never logged/stored plaintext | — | Inspect DB row and application logs after signup/login | `password_hash` is argon2, no plaintext anywhere | P1 | AUTH-1 |
| TC-AUTH-006 | Silent refresh on access-token expiry | Valid refresh cookie present, access token expired | Call `GET /auth/me` (401), frontend interceptor calls `POST /auth/refresh`, retries original request once | New access token obtained transparently; retried `GET /auth/me` succeeds; no forced re-login | P1 | AUTH-2 |
| TC-AUTH-007 | Refresh with revoked token | Refresh token revoked directly via DB fixture (`revoked_at` set — no logout/admin-revoke route exists yet, see AUTH-2 scope plan) | POST `/auth/refresh` | 401 `invalid_refresh_token`; no new token issued; frontend redirects to `/login` | P1 | AUTH-2 |
| TC-AUTH-008 | Refresh tokens are individually revocable | 2 active sessions (2 `RefreshToken` rows) for same user | Revoke session A's refresh token via DB fixture | Session A's next refresh 401s; session B's refresh still succeeds normally | P2 | AUTH-2 |
| TC-AUTH-018 | Refresh token is single-use (rotation) | Valid, unused refresh token | Call `POST /auth/refresh` once (succeeds, new cookie set), then present the *original* (now rotated-out) token again | First call 200s with a new token; second call 401s even though the original token had not otherwise expired or been explicitly revoked | P1 | AUTH-2 |
| TC-AUTH-019 | Refresh rejected once token itself expires | Refresh token with `expires_at` in the past (fixture-seeded) | POST `/auth/refresh` | 401 `invalid_refresh_token`; no new token issued | P1 | AUTH-2 |
| TC-AUTH-020 | Refresh rejected with no cookie at all | No `refresh_token` cookie sent | POST `/auth/refresh` | 401 `invalid_refresh_token` (same generic body as revoked/expired — no distinct code) | P2 | AUTH-2 |
| TC-AUTH-021 | Refresh rejected once org access is lost | User's only `OrgMembership` transitions from `active` to `suspended` after login, refresh token itself still valid | POST `/auth/refresh` | 403 `no_active_organization`; refresh token **not** revoked by this rejection (a later refresh succeeds again if membership is reactivated before the token's `expires_at`) | P1 | AUTH-2 |
| TC-AUTH-022 | Rotation inherits original session's absolute expiry | Token refreshed 3 times in a row (3 rotations) | Inspect the 4th-generation token's `expires_at` | Equal to the 1st-generation token's `expires_at` (copied forward each rotation), not `now + 30d` from the most recent rotation | P2 | AUTH-2 |
| TC-AUTH-023 | `GET /auth/me` returns current actor identity | Valid access token | GET `/auth/me` | 200; `{actor_id, email, actor_type}` matches the authenticated `User` | P2 | AUTH-2 |
| TC-AUTH-009 | Logout revokes current session | Active session | POST `/auth/logout` | Refresh token revoked server-side; both tokens cleared client-side | P1 | AUTH-3 |
| TC-AUTH-010 | AIAgent bearer auth attributes actor correctly | AIAgent with issued API key | MCP call using the key creates a TestCase | `created_by_actor_id` resolves to the AIAgent, not any User | P2 | AUTH-4 |
| TC-AUTH-011 | AIAgent blocked from Approval-permission route | AIAgent authenticated | Call `/test-plans/{id}/approve` | 403, regardless of role bundle | P1 | AUTH-4 / RBAC-5 |
| TC-AUTH-012 | org_admin issues/revokes AIAgent credential | org_admin authenticated | POST create agent, then POST revoke | Key shown once at creation; after revoke, further calls with that key 401 | P2 | AUTH-4 |
| TC-AUTH-013 | Login rejected, zero org memberships | User exists, no OrgMembership rows at all | POST `/auth/login` with correct credentials | 403 `no_active_organization`; no token issued | P1 | AUTH-1 |
| TC-AUTH-014 | Login rejected, only suspended/invited memberships | User has 1 `suspended` + 1 `invited` OrgMembership, none `active` | POST `/auth/login` with correct credentials | 403 `no_active_organization` | P1 | AUTH-1 |
| TC-AUTH-015 | Suspended/invited memberships excluded from org list | User has 1 `active` + 1 `suspended` OrgMembership | Login | `org_context: "auto"`; `orgs` contains only the active org, suspended org absent | P1 | AUTH-1 |
| TC-AUTH-016 | Login throttled after 5 failed attempts | 5 prior failed logins for same `(client_ip, email)` within 15 min | 6th login attempt for that pair | 429 `rate_limited`, regardless of whether attempt 6's credentials are correct | P1 | AUTH-1 / NFR-11 |
| TC-AUTH-017 | Successful login resets throttle counter | 3 failed attempts, then 1 successful login, same pair | 5 further failed attempts after the success | 429 triggers only after 5 new post-reset failures, not immediately on the next one | P2 | AUTH-1 / NFR-11 |

## RBAC & Multi-Tenancy

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-RBAC-001 | First-ever signup bootstraps org | Fresh instance, zero orgs | Complete first signup | Organization created; user granted org_admin automatically | P1 | RBAC-1 |
| TC-RBAC-002 | Cross-org data isolation | 2 orgs exist, each with a Project/Requirement/TestCase | org_admin of Org A requests a resource id belonging to Org B | 404 (not 403, not data) | P1 | RBAC-1 / NFR-1 |
| TC-RBAC-003 | Org slug uniqueness | Org "acme" exists | Create second org with slug "acme" | Rejected, 422 unique-constraint violation | P2 | RBAC-1 |
| TC-RBAC-004 | Invite member by email | org_admin authenticated | POST invite with email | OrgMembership created, status `invited` | P1 | RBAC-2 |
| TC-RBAC-005 | Invited user completes signup | Pending invite exists | User signs up via invite link | OrgMembership status becomes `active` | P1 | RBAC-2 |
| TC-RBAC-006 | Suspend member blocks access, keeps RoleAssignment | Active member with RoleAssignment | org_admin suspends member; suspended user calls any API | 403/401 on all calls; RoleAssignment rows still present in DB | P1 | RBAC-2 |
| TC-RBAC-007 | Multi-org membership | — | Same user gets OrgMembership in 2 orgs | Both memberships valid independently | P2 | RBAC-2 |
| TC-RBAC-008 | Org-wide role grant | RoleAssignment with `project_id = null` | Grantee calls any project's route with that role's permission | Access granted across every project in the org | P1 | RBAC-3 |
| TC-RBAC-009 | Project-scoped role grant | RoleAssignment scoped to Project A | Grantee calls same permission on Project B | 403 (no implicit access outside the scoped project) | P1 | RBAC-3 |
| TC-RBAC-010 | No RoleAssignment → no implicit access | User has OrgMembership but no RoleAssignment in Project X | User attempts any action in Project X | 403 | P1 | RBAC-3 |
| TC-RBAC-011 | AIAgent RoleAssignment | AIAgent actor | Assign AIAgent a bounded Role | AIAgent's permission set reflects the role exactly like a human's would | P2 | RBAC-3 |
| TC-RBAC-012 | System roles seeded on org creation | New org just created | Query available roles | `org_admin`, `test_manager`, `tester`, `auditor`, `ai_agent_scoped` all present, `is_system_role=true` | P1 | RBAC-4 |
| TC-RBAC-013 | Custom role creation | org_admin authenticated | Create a custom Role scoped to the org | Role created with `org_id` set, usable in RoleAssignment | P2 | RBAC-4 |
| TC-RBAC-014 | ai_agent_scoped never has approval permission | Seed migration applied | Inspect `ai_agent_scoped`'s RolePermission rows | `test_plan.approve` absent | P1 | RBAC-5 |
| TC-RBAC-015 | Reject adding approval permission to an AIAgent-targeted role | Custom role assigned to an AIAgent | Attempt to add `test_plan.approve` to that role via admin UI/API | Rejected | P1 | RBAC-5 |

## Project & Release

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-PROJ-001 | Create project | User has `project.create` in org | POST `/projects` with name | Project created, scoped to org | P1 | PROJ-1 |
| TC-PROJ-002 | No orphaned assets outside a project | — | Attempt to create Requirement/TestSuite/TestPlan without `project_id` | Rejected, 422 | P1 | PROJ-1 |
| TC-PROJ-003 | Set/edit standards_profile | Project exists | Set on create, update later via `project.update` | Field persists both times | P2 | PROJ-1 |
| TC-PROJ-004 | Create release | Project exists, `release.create` held | POST `/releases` with version_label/target_date | Release created, scoped to project | P1 | PROJ-2 |
| TC-PROJ-005 | Query cycles for a release | Release has 2 linked TestCycles, each with executions | Query "cycles for release X" | Returns both cycles and, transitively, all their TestExecutions | P1 | PROJ-2 |

## Requirement & Test Case Authoring

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-REQ-001 | Capture a requirement | Project exists, `requirement.create` held | POST with title/description/source/external_ref | Requirement created, scoped to project | P1 | REQ-1 |
| TC-REQ-002 | Search requirements | Multiple requirements exist | Search by title substring and by external_ref | Correct subset returned | P2 | REQ-1 |
| TC-REQ-003 | Direct TestCase authoring (no TestCondition) | Requirement exists | POST test-case with `test_condition_id=null`, linked via RequirementTestCaseLink | TestCase traceable to Requirement without any TestCondition existing | P1 | REQ-2 |
| TC-REQ-004 | Add and reorder TestSteps | TestCase exists | Add 3 steps, reorder | Steps independently editable, sequence persists | P1 | REQ-2 |
| TC-REQ-005 | TestCondition authoring | Requirement exists | POST test-condition (description, priority) | Linked via RequirementTestConditionLink | P1 | REQ-3 |
| TC-REQ-006 | TestCase via TestCondition | TestCondition exists | POST test-case with `test_condition_id` set | Linked via TestConditionTestCaseLink; transitively traceable to Requirement | P1 | REQ-3 |
| TC-REQ-007 | Both authoring paths coexist | Same project | Create one TestCase via each path | Both valid, both visible, distinguished in the traceability view | P1 | REQ-3 |
| TC-REQ-008 | Suite membership many-to-many | TestSuite + TestCase exist | Add same TestCase to 2 suites | Both memberships persist independently | P1 | REQ-4 |
| TC-REQ-009 | Suite membership stays live pre-execution | TestSuite has 2 TestCases | Remove one, then list suite membership | Reflects current (updated) membership, not a stale snapshot | P2 | REQ-4 |

## Test Planning

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-PLAN-001 | Create test plan | Project exists, `test_plan.create` held | POST with identifier/scope/approach/staffing/schedule | Created with status `draft` | P1 | PLAN-1 |
| TC-PLAN-002 | Include suites in plan | TestPlan + TestSuite exist | Add suite to plan | "Which test cases does this plan cover" query returns the suite's cases | P1 | PLAN-1 |
| TC-PLAN-003 | Status transitions | TestPlan in `draft` | Approve, then supersede | draft→approved→superseded succeeds; draft→superseded directly rejected | P1 | PLAN-1 |
| TC-PLAN-004 | Add entry/exit criteria | TestPlan exists | POST criteria rows of each type | All 4 types (entry/exit/suspension/resumption) listed against the plan | P1 | PLAN-2 |
| TC-PLAN-005 | Exit criteria visible with execution progress | TestCycle running under a plan with exit criteria | Open cycle view | Exit criteria shown alongside live execution progress, one view | P2 | PLAN-2 |
| TC-PLAN-006 | Create test cycle | TestPlan + Release exist | POST cycle with environment_id | Linked to both plan and release | P1 | PLAN-3 |
| TC-PLAN-007 | Create environment inline | Setting up a cycle, no environment yet | Create environment inline during cycle creation | Environment created and cycle linked in one flow | P2 | PLAN-3 |
| TC-PLAN-008 | Execution scope enforcement | TestCase NOT a member of any suite included in the plan | Attempt to record an execution for that TestCase under the plan's cycle | Rejected (422) | P1 | PLAN-3 |

## Test Execution & Defects

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-EXEC-001 | Record execution result | TestCase in scope for active cycle | POST execution with result=pass, actual_result notes | Row created with `executed_by_actor_id`, `executed_at` | P1 | EXEC-1 |
| TC-EXEC-002 | Live dashboard aggregation | Cycle has mixed pass/fail/blocked/skipped executions | Open cycle dashboard | Counts match underlying rows exactly, no manual/stale summary | P1 | EXEC-1 |
| TC-EXEC-003 | Re-execution preserves history | TestCase already executed once in this cycle | Record a second execution for same TestCase+cycle | New row inserted, old row untouched, both visible in history | P1 | EXEC-1 |
| TC-EXEC-004 | Status change appends log, doesn't overwrite | Execution exists with result=pass | Correct to fail | New TestLog row appended (`status_change`), TestExecution's prior state not silently overwritten without a trace | P1 | EXEC-2 |
| TC-EXEC-005 | TestLog has no update/delete route | TestLog row exists | Attempt PATCH/DELETE on it | No such route exists (404 from router) | P1 | EXEC-2 |
| TC-EXEC-006 | Ordered log timeline | Execution has 3+ log entries | View execution history | Entries shown in chronological order, separate from current-state fields | P2 | EXEC-2 |
| TC-EXEC-007 | Raise defect from failed execution | Execution with result=fail | POST defect (external_ref, severity, status) | Defect linked to execution and, via TestCaseDefectLink, to the TestCase | P1 | EXEC-3 |
| TC-EXEC-008 | Defect external_ref without live integration | — | Create defect with a plain external_ref string/URL | Accepted, no external API call required | P2 | EXEC-3 |
| TC-EXEC-009 | TestCase shows all defects, most recent first | TestCase has defects across multiple executions | Open TestCase detail | All defects listed, most recent first | P2 | EXEC-3 |

## Governance

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-GOV-001 | Approve a test plan | TestPlan in `draft`, actor has `test_plan.approve` | POST approve | Approval row created; TestPlan → `approved` | P1 | GOV-1 |
| TC-GOV-002 | AIAgent cannot approve | AIAgent actor, any role | POST approve | 403, independent of RoleAssignment | P1 | GOV-1 / RBAC-5 |
| TC-GOV-003 | Approval record survives supersession | TestPlan approved, later superseded by a new version | Query original Approval row | Still present, unchanged, never deleted | P1 | GOV-1 |
| TC-GOV-004 | RiskItem linked to Requirement and/or TestPlan | `risk_item.create` held | POST RiskItem against a Requirement, another against a TestPlan | Each listed on its respective detail view | P2 | GOV-2 |
| TC-GOV-005 | RiskItem structured fields | RiskItem exists | Filter/sort by likelihood/impact | Structured enum values, filterable | P2 | GOV-2 |
| TC-GOV-006 | Attach file to test case | `test_case.update` held | Upload file to TestCase | Attachment row created (url_or_path, mime_type, size_bytes) | P2 | GOV-3 |
| TC-GOV-007 | Attachment size/type limits enforced | Configured max size/allowed types | Upload file over limit; upload disallowed mime type | Both rejected server-side, not just hidden client-side | P2 | GOV-3 |
| TC-GOV-008 | Attachment storage never defaults to third-party SaaS | `ATTACHMENT_STORAGE=local` (default) | Inspect stored file location | Local filesystem/volume, no outbound third-party call | P2 | GOV-3 |

## Taxonomy & Generic Admin CRUD

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-ADMIN-001 | Classify test case by taxonomy | Seeded TestLevel/TestType/TestDesignTechnique | Edit TestCase, select 1 level, 1 type, 2+ techniques | Selections persist via dropdowns/multi-select, not free text | P2 | ADMIN-1 |
| TC-ADMIN-002 | Design-technique coverage report | Project has TestCases, some with techniques assigned, some without | Open coverage report, filter by suite | Correct percentage, filterable | P3 | ADMIN-1 |
| TC-ADMIN-003 | Generic CRUD list renders from config | Any entity with a registered `entityConfigs` entry, user has `<entity>.read` | Navigate to its admin page | Paginated, filterable list renders with no entity-specific component code | P1 | ADMIN-2 |
| TC-ADMIN-004 | Field-type-driven form rendering | Entity config declares string/enum/FK/date fields | Open create/edit form | Each field type renders the matching input (text/select/FK-autocomplete/date picker) | P2 | ADMIN-2 |
| TC-ADMIN-005 | Generic CRUD permission parity | User lacks `<entity>.create` | Open that entity's admin page | Create button hidden/disabled; direct API POST still rejected (403) | P1 | ADMIN-2 |

## Traceability Matrix

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-TRACE-001 | Full traceability chain view | Requirement has both direct and TestCondition-mediated TestCases, with executions and defects | Open Requirement detail | Both link classes shown, distinguished; latest execution result + linked defects shown per TestCase | P1 | TRACE-1 |
| TC-TRACE-002 | Zero-coverage requirement | Requirement has no linked TestCases at all | Open Requirement detail | Explicit "0 test cases cover this requirement" state, not an empty/ambiguous view | P1 | TRACE-1 |
| TC-TRACE-003 | Project-level RTM table | Project has multiple Requirements at varying coverage levels | Request traceability matrix | One row per Requirement: linked TestCase count, most recent execution status, open Defect count | P1 | TRACE-2 |
| TC-TRACE-004 | Auditor role read+export only | User with `auditor` role | Attempt any write action anywhere in the app | All rejected; RTM view + CSV export both accessible | P1 | TRACE-2 / RBAC-4 |
| TC-TRACE-005 | CSV export | RTM view open, `requirement.export_rtm` held | Trigger CSV export | Valid CSV file matching the table's rows/columns | P2 | TRACE-2 |

## AI Agent / MCP

| ID | Title | Preconditions | Steps | Expected result | Priority | Story |
|---|---|---|---|---|---|---|
| TC-MCP-001 | Create/list TestCases via MCP | AIAgent with `test_case.create`/`.read` | Call `create_test_case`, then `list_test_cases` | Same validation/permission path as REST; both tools succeed | P3 | MCP-1 |
| TC-MCP-002 | MCP write attributes AIAgent correctly | AIAgent has `acting_on_behalf_of_user_id` set | Create a TestCase via MCP | `created_by_actor_id` = the AIAgent; accountable human preserved via `acting_on_behalf_of_user_id` | P3 | MCP-1 |
| TC-MCP-003 | MCP/REST schema parity | TestCase created via MCP | Fetch same TestCase via REST | Identical field shape, no divergent contract | P3 | MCP-1 |
| TC-MCP-004 | Update TestCase via MCP | AIAgent with `test_case.update` | Call `update_test_case` | Change applied; attributable via audit fields | P3 | MCP-2 |
| TC-MCP-005 | MCP permission enforcement | AIAgent scoped to Project X only | Call `update_test_case` against a Project Y TestCase | 403 | P2 | MCP-2 |
| TC-MCP-006 | Create execution via MCP | AIAgent with `test_execution.create` | Call `create_test_execution` | Row created exactly as EXEC-1, `executed_by_actor_id` = agent | P3 | MCP-3 |
| TC-MCP-007 | Read-only Requirement via MCP | AIAgent with `requirement.read` | Call `read_requirement` | Same data a human sees via REST; no create/update tool exists for Requirement via MCP | P3 | MCP-3 |

---

## Coverage summary

| Feature area | Test case count | P1 count |
|---|---|---|
| Auth | 23 | 16 |
| RBAC & Multi-Tenancy | 15 | 11 |
| Project & Release | 5 | 3 |
| Requirement & Test Case Authoring | 9 | 7 |
| Test Planning | 8 | 6 |
| Test Execution & Defects | 9 | 6 |
| Governance | 8 | 3 |
| Taxonomy & Generic Admin CRUD | 5 | 2 |
| Traceability Matrix | 5 | 4 |
| AI Agent / MCP | 7 | 0 |
| **Total** | **94** | **59** |

MCP's P3-only weighting matches its exploratory, no-validated-WTP status per the personas doc — structural coverage exists, but nothing here blocks a release.
