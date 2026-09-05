# User Stories — Frontend Shared Component (Design System / CoreUI)

**Date:** 2026-09-04
**Feature area:** Frontend shared component layer, on top of CoreUI (ADR-0012)
**Context:** [Business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md), [Personas](../personas/2026-09-04-atomic-design-contributor-personas.md) (Persona 1, "The Agent" — validated), [Journeys](../user-journeys/2026-09-04-atomic-design-contributor-journeys.md) (Journey 1, steps 3-4)

**Scope note, carried from the business case's PIVOT finding:** this is the **only** validated opportunity from this discovery — one narrow, evidenced component extraction, not a full Atomic Design (atoms/molecules/organisms/templates) buildout. Full tiering stays explicitly out of scope until more screens show duplication beyond what's already evidenced here (business case's own re-trigger condition). Only one story below, deliberately — inventing additional stories the evidence doesn't support would violate this process's own no-fabrication principle.

**Not included here (belongs elsewhere, not as a user story):** the component-location naming convention (`components/shared/` vs `components/crud/` vs page-local) is an **ADR**, per CLAUDE.md's ADR-first rule for architecture choices — not a user story. That ADR is a prerequisite for DS-1 below and should be written before or alongside implementation, not as a separate backlog item competing for story-priority here.

---

## Story DS-1: Reusable form-field component

**As** The Agent (AI coding-agent contributor building CoreUI screens against this repo's stories — [Persona 1](../personas/2026-09-04-atomic-design-contributor-personas.md)),
**I want** a single reusable `FormField` component that composes CoreUI's `CFormLabel` + `CFormInput` + validation feedback,
**so that** I can compose a new form field by passing props instead of re-deriving the same 2-3 line label+input block from the nearest prior screen each time — the exact, evidenced friction point in this repo today ([interviews](../user-interviews/2026-09-04-atomic-design-contributor-interviews.md): `CFormLabel`+`CFormInput` hand-authored 7× across `Login.tsx` and `Signup.tsx` alone, zero shared component to reach for).

**Acceptance criteria:**

- Given a form needs a labeled text/email/password input bound to a React Hook Form field, when a contributor uses `FormField` (label, RHF register/control props, optional error message passthrough), then it renders CoreUI's `CFormLabel` + `CFormInput` with the same markup/accessibility attributes (`htmlFor`/`id` pairing) the hand-authored instances already produce today — no visual or behavioral regression versus the current per-screen implementations.
- Given a field has a validation error (Zod schema failure via RHF), when `FormField` renders, then it surfaces the error using CoreUI's `CFormFeedback`/invalid-state styling, consistent with existing RHF+Zod conventions (ADR-0009) — not a bespoke error-rendering pattern.
- Given `FormField` exists, when `Login.tsx`'s 2 hand-authored label+input instances and `Signup.tsx`'s 5 are migrated to use it, then all existing Vitest coverage for those screens and the existing Playwright login/signup E2E flows still pass unmodified in assertions (behavior-preserving refactor of the call sites, proving the component is a true drop-in — this is verification of DS-1's new component, not a separately-scoped refactor story).
- Given the component is added, when a contributor looks for where new shared components belong, then a short note (component's own file-level doc comment, or the ADR referenced above) states its intended location and reuse scope — so the next contributor building a new screen has something to find, closing the exact gap Journey 1 (steps 3-4) identified.
- Out of scope for this story (explicitly, per the business case's deferral): checkbox/select/radio field variants, a `molecules`/`organisms` directory structure, or any second component beyond `FormField` — none of these have duplication evidence behind them yet.

**Traceability:** this story is the sole implementation output of the [business case](../business-case/2026-09-04-atomic-design-system-coreui-business-case.md)'s narrow recommendation. No FR/NFR in `docs/requirements/2026-09-03-project-scaffold-requirements.md` currently covers this — flag for whoever picks this up: add a requirements entry if/when this graduates from "internal contributor tooling" to something requirements-tracked, consistent with how other ADR-driven changes have propagated across docs in this repo's history.
