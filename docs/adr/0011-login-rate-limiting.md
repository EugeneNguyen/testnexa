# ADR-0011: Login rate limiting

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0003](0003-auth-token-strategy.md) (auth & token strategy), [AUTH-1 story](../user-stories/2026-09-03-auth-stories.md), [AUTH-1 scope plan](../superpowers/plans/2026-09-03-auth-1-local-password-login-plan.md)

## Context

`POST /auth/login` is a public, unauthenticated route by design (ADR-0003) — anyone can call it. Neither the AUTH-1 acceptance criteria nor ADR-0003 specified any defense against repeated failed attempts. A login endpoint shipping with zero throttle is a real, known gap (credential stuffing, password guessing), not an acceptable silent omission.

Full lockout policy (account lockout duration, admin notification, unlock flow) is a separate product decision with its own UX surface and is not blocking AUTH-1. A minimal, always-on guard is not.

## Decision

- Track failed login attempts keyed by `(client_ip, email)`.
- Threshold: 5 failed attempts within a 15-minute sliding window → reject further attempts for that key with `429 Too Many Requests` until the window clears.
- Successful login for a key clears its failed-attempt count.
- Storage: DB-backed (a `LoginAttempt` table — see [Database Document §3.2](../database/2026-09-03-database-design.md)), consistent with ADR-0003's existing no-Redis stance. Not in-process memory, since the backend may run multiple worker processes/replicas and in-process counters wouldn't be shared across them.
- Scope: this ADR covers only the minimal throttle. Full lockout (permanent-until-admin-unlock, email notification, CAPTCHA) is explicitly out of scope and tracked as a follow-up story.

## Consequences

**Positive:** closes an obvious gap with a small, self-contained mechanism; DB-backed counter works correctly across multiple backend replicas without adding infrastructure; clearing on success means a legitimate user who mistypes a password a few times is never meaningfully inconvenienced.

**Negative / Trade-offs:** one extra table and one extra write per failed login attempt (acceptable at scaffold scale, same trade-off already accepted for `RefreshToken` in ADR-0003); does not prevent a distributed attack spread across many IPs against one email (mitigated by the per-email dimension, not eliminated — full mitigation is the deferred lockout-policy story); a shared corporate NAT/IP could see legitimate users throttled together (accepted risk at this threshold — 5/15min is generous for real usage, tight for scripted guessing).

## Alternatives considered

- **No throttle at all** — rejected: ships a known, avoidable gap on the most attacked route in the system.
- **In-process/in-memory counter** — rejected: doesn't work correctly once the backend runs more than one process/replica; a counter that resets on restart or diverges across workers gives a false sense of protection.
- **Full lockout policy now (permanent lock, admin unlock, notifications)** — deferred, not rejected: real scope, real UX surface, doesn't belong bundled into AUTH-1's login route; tracked as a follow-up story so it isn't lost.
- **Redis-backed counter** — rejected for the same reason ADR-0003 rejected Redis for refresh tokens: avoids adding a stateful dependency the self-hosted deployment story doesn't otherwise need.
