# ADR-0003: Auth & token strategy

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [AUTH-1..4 user stories](../user-stories/2026-09-03-auth-stories.md), [ADR-0011](0011-login-rate-limiting.md) (login throttle, decided separately)

## Context

Auth must work uniformly for a human `User` (interactive login) and a machine `AIAgent` (bearer auth from an MCP client, no human in the loop per session). The regulated-compliance persona (Marcus) requires session revocability as a real requirement, not a nice-to-have.

## Decision

- Human login: JWT access token (short-lived) + refresh token (long-lived), refresh token stored server-side in a DB table (revocable) and delivered to the browser via an httpOnly cookie.
- AI agent auth: a long-lived opaque API key (GitHub-PAT-style), shown once at creation, stored argon2-hashed at rest — not the human login flow. No rotation UI in this scaffold; revoke-and-reissue only.
- Password hashing: argon2 via passlib for human passwords.

## Consequences

**Positive:** refresh-token revocability without adding Redis or another stateful store; a single `Actor`-shaped identity underlies both flows so every `created_by`/`executed_by` field works uniformly; an admin can force-logout a human user or revoke an agent's key with one action.

**Negative / Trade-offs:** refresh-token DB table adds one write per token refresh cycle (acceptable at scaffold scale, would need review at very high concurrency); no key-rotation UI for AI agents in this scaffold means rotating a compromised key requires revoke+reissue (acceptable trade-off, flagged as a known gap, not silently omitted).

## Alternatives considered

- **Pure stateless JWT (no DB-backed refresh)** — rejected: not revocable, fails AUTH-2's compliance-context requirement.
- **Session cookies only, no bearer tokens** — rejected: doesn't fit the AIAgent/MCP bearer-auth use case (AUTH-4), which needs a credential usable outside a browser session.
