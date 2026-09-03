# User Stories — Authentication

**Date:** 2026-09-03
**Feature area:** Auth (local password, JWT access+refresh)
**Context:** [Business case](../business-case/2026-09-03-sovereign-ai-testing-business-case.md), [Personas](../personas/2026-09-03-target-personas.md), [Journeys](../user-journeys/2026-09-03-target-persona-journeys.md), [Scaffold design](../superpowers/specs/2026-09-03-project-scaffold-design.md)

---

## Story AUTH-1: Local password login

**As** Priya (self-hosted OSS QA lead), setting up the tool for her team,
**I want** to log in with a username/email and password,
**so that** I can access the tool without depending on an external identity provider — consistent with the self-hosted, data-control property that's the reason she'd adopt this at all (Journey 1, step 1–2; 03 #9).

**Acceptance criteria:**
- Given a registered user with valid credentials, when they submit the login form, then they receive an access token and a refresh token, and are redirected to their default org/project view.
- Given invalid credentials, when login is attempted, then the request is rejected with a 401 and a generic "invalid credentials" message (no user-enumeration leak — does not reveal whether the email exists).
- Given a user account that exists in one org only, when they log in, then that org is auto-selected; given a user in multiple orgs, they land on an org picker.
- Passwords are hashed (argon2) at rest; plaintext is never logged or stored.

---

## Story AUTH-2: Session persistence via refresh token

**As** Marcus (regulated compliance QA manager),
**I want** my session to stay valid across browser restarts without re-entering my password every time,
**so that** routine daily use isn't interrupted, while still allowing an admin to revoke my access immediately if needed (his compliance context makes revocability a real requirement, not a nice-to-have — 07's `AuthIdentity`/RBAC design).

**Acceptance criteria:**
- Given a valid refresh token stored in an httpOnly cookie, when the access token expires, then the frontend silently obtains a new access token without forcing re-login.
- Given a refresh token that has been revoked (e.g., an admin force-logged-out the user, or the user explicitly logged out), when it's used to request a new access token, then the request is rejected with 401 and the user is redirected to login.
- Refresh tokens are stored server-side (DB table) so they can be individually revoked — not purely stateless JWTs.

---

## Story AUTH-3: Logout

**As** any authenticated user,
**I want** to explicitly log out,
**so that** my session doesn't remain valid on a shared or public machine.

**Acceptance criteria:**
- Given an active session, when the user clicks "log out," then their current refresh token is revoked server-side and both tokens are cleared client-side.
- After logout, any API call with the old access token fails once it expires (access tokens are short-lived by design; immediate revocation only guaranteed for refresh, per AUTH-2).

---

## Story AUTH-4: AI agent bearer authentication

**As** an AI coding agent acting on behalf of an agent-primary team (Persona 3, exploratory),
**I want** to authenticate to the API using a long-lived, scoped credential rather than a human login flow,
**so that** an MCP client (Claude Code, Cursor) can drive test-case creation/execution without a human in the loop for every session (06's MCP finding; 07's `AIAgent` Actor design; Journey 3).

**Acceptance criteria:**
- Given an `AIAgent` record with an issued credential, when the MCP server authenticates using it, then requests are attributed to that `AIAgent` (not a human `User`) for all `created_by`/`executed_by` fields.
- Given an `AIAgent` credential, when it's used to call a route gated by a permission the agent's role doesn't grant (e.g., `test_plan.approve`), then the request is rejected with 403 — same RBAC path as a human `User`, per 07's unified `Actor` model.
- Credential issuance/revocation for an `AIAgent` is an action available to an org admin, auditable via `AuthIdentity`-equivalent tracking (`last_login_at`-style field for agent sessions).

**Note:** This story is exploratory-persona-facing (Persona 3, no validated WTP — personas doc). Build the mechanism since 07's Actor model requires it structurally either way, but do not prioritize UX polish for this flow ahead of AUTH-1/2/3.
