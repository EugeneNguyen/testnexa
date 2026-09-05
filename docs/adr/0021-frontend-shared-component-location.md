# ADR-0021: Frontend shared-component location & FormField error-display convention

**Date:** 2026-09-05
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0009](0009-frontend-stack.md) (React Hook Form + Zod, unchanged), [ADR-0012](0012-coreui-design-system.md) (CoreUI design system), [DS-1 user story](../user-stories/2026-09-04-design-system-component-stories.md#story-ds-1-reusable-form-field-component), [DS-1 scope plan](../superpowers/plans/2026-09-04-ds-1-form-field-plan.md)

## Context

The DS-1 business case and interviews found one narrow, evidenced duplication: `CFormLabel`+`CFormInput` hand-authored 7× across `Login.tsx` (2) and `Signup.tsx` (5), with zero shared component to reach for. The DS-1 user story itself flags that *where* a new shared component should live — `components/shared/` vs. `components/crud/` vs. page-local — is an architecture decision, not a story, and names it a prerequisite for DS-1's `FormField` component.

Separately, this codebase currently has two inconsistent field-error-display patterns already in use: `CFormFeedback`+`invalid` per-field (`OrgHome.tsx`'s "New Project" modal) vs. a single page-level `CAlert` per form (`AcceptInvite.tsx`, `OrgMembers.tsx`, and — pre-DS-1 — `Login.tsx`/`Signup.tsx`, which don't use React Hook Form at all yet). DS-1's `FormField` needs one convention to standardize on, not a third pattern.

## Decision

- **`frontend/src/components/shared/`** holds cross-screen UI-composition primitives with real duplication evidence behind them (≥2 existing call sites doing the same hand-authored thing) — `FormField` is the first and, per DS-1's explicit scope, only inhabitant for now. No `atoms`/`molecules`/`organisms` tiering; a flat directory is sufficient at this component count.
- **`frontend/src/components/crud/`** stays reserved for the generic entity-CRUD widgets (`EntityTable`, `EntityForm`) that FR-ADMIN-2's router-factory UI work ships — a different axis (generic-entity-shape-driven, not markup-duplication-driven) from `components/shared/`, so the two directories are not merged.
- **Page-local components** (anything used by exactly one screen) stay defined inline in that screen's file under `pages/<area>/`, as today — moving to `components/shared/` requires a second call site, not anticipated reuse.
- **`FormField`'s error-display convention is `CFormFeedback`+`invalid`** (matching `OrgHome.tsx`'s existing usage), not the page-level-`CAlert` pattern — this is the convention every future RHF+Zod-bound text/email/password field should use going forward. Page-level `CAlert` remains the pattern for non-field errors (API/network failures on submit), which `FormField` does not attempt to own.
- A component's own file-level doc comment states its location's reuse scope (per DS-1 AC4) — this ADR is the canonical reference such a comment points back to, not a substitute for it.

## Consequences

**Positive:** Contributors (human or AI agent) building a new CoreUI screen have one unambiguous place to look for a reusable form-field primitive, and one error-display convention to copy instead of picking between two existing ones. Directory boundaries (`shared/` vs. `crud/` vs. page-local) are drawn on an evidence basis, avoiding a speculative Atomic Design buildout the business case explicitly found unsupported.

**Negative / Trade-offs:** `AcceptInvite.tsx`/`OrgMembers.tsx`'s existing page-level-`CAlert`-for-field-errors pattern is not retroactively migrated by this ADR — only `Login.tsx`/`Signup.tsx` move to `FormField`+`CFormFeedback` as DS-1's own migration scope. The two conventions coexist until a future story touches those other screens, a known, accepted inconsistency rather than a silently-introduced one.

## Alternatives considered

- **Full Atomic Design tiering (`atoms/molecules/organisms/templates`) now** — rejected: the business case's own PIVOT finding says only one component has duplication evidence behind it; a four-tier directory structure for one component is speculative structure the story explicitly scopes out.
- **`components/ui/` instead of `components/shared/`** — rejected: no naming precedent either way in this codebase; `shared/` reads more precisely as "cross-screen, evidence-driven," matching the criterion this ADR sets, whereas `ui/` invites dumping any presentational component regardless of duplication evidence.
- **Leave `FormField` page-local, duplicated per screen with shared logic extracted later** — rejected: this is exactly the friction DS-1 was opened to close; deferring the location decision further would block the story it's a stated prerequisite for.
- **Standardize on page-level `CAlert` instead of `CFormFeedback`+`invalid`** — rejected: DS-1's own AC2 explicitly calls for `CFormFeedback`/invalid-state styling; `CAlert` also can't express per-field `invalid` input styling (red border/focus ring), only a text banner.
