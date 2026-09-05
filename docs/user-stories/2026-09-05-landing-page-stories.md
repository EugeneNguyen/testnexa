# User Stories — Landing Page

**Date:** 2026-09-05
**Feature area:** Landing (public, unauthenticated entry point)
**Context:** [Business case](../business-case/2026-09-03-sovereign-ai-testing-business-case.md), [Auth stories](2026-09-03-auth-stories.md), [ADR-0024](../adr/0024-public-landing-page.md)

---

## Story LANDING-1: Public landing page for logged-out visitors

**As** a prospective user or teammate arriving at the deployment's root URL with no active session,
**I want** a public landing page that identifies the product and gives me a clear way to log in,
**so that** I land on a real, presentable entry point instead of the internal scaffold-verification health-check screen that currently sits at `/`.

**Acceptance criteria:**
- Given a visitor with no valid session (no access token, no restorable refresh session), when they load `/`, then they see a public landing page — product name, a one-line pitch, a "Log in" primary call-to-action, a "Sign up" secondary link — not the scaffold health-check widget.
- Given the landing page is showing, when the visitor clicks "Log in" (or "Sign up"), then they land on `/login` (or `/signup`).
- Given an already-authenticated visitor (valid session, `orgContext` resolved) hits `/`, when the page would otherwise render, then they are redirected to their org context instead — `/orgs/{orgId}` on auto-select, `/orgs/pick` on picker — reusing the same redirect targets `Login.tsx`'s own post-login effect already uses, not a second bespoke redirect.
- Given the page is public, when it renders, then it makes no authenticated API call — nothing about viewing it requires a token.

**Note:** This story replaces the root scaffold-verification page (`ScaffoldVerificationPage`, a dev-only health-check probe added to prove frontend↔backend wiring during initial scaffolding). That page's job is done; its content is not preserved or relocated to another route — see [ADR-0024](../adr/0024-public-landing-page.md) for the deletion rationale. Content stays bare-bones (name, pitch, CTA) — no features grid, testimonials, or persona-targeted marketing copy in this pass; that's explicit scope deferral, not an oversight.
