# ADR-0012: CoreUI for React as the project's design system

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0009](0009-frontend-stack.md) (frontend stack — partially superseded by this ADR), [CoreUI for React docs](https://coreui.io/react/docs/getting-started/introduction/)

## Context

ADR-0009 picked Tailwind CSS as the styling layer, on the "Tailwind is a fixed task requirement" premise at scaffold time. That premise no longer holds: the project has since been directed to standardize on [CoreUI](https://coreui.io/) as its design system — a component library purpose-built for admin/dashboard tools, which matches this product's actual shape (a CRUD-heavy, authenticated-throughout, no-public-pages admin tool over 28 entities, per ADR-0009's own problem framing).

Running Tailwind and CoreUI side by side is not a neutral choice: CoreUI's CSS (`@coreui/coreui`) is Bootstrap-family — it ships a `.container`/`.row`/grid system and its own reset, both of which collide with Tailwind's own `container` utility and Preflight base-reset. Keeping both active risks silent visual bugs from cascade/specificity fights, not just bundle bloat. AUTH-1's `Login`/`OrgPicker`/`OrgHome` screens (built before this decision) are Tailwind-authored and are now known migration debt — flagged here, not hidden.

## Decision

- **CoreUI for React** (`@coreui/react` + `@coreui/coreui`, open-source tier — not `-pro`) is the project's design system for all component-level UI: buttons, forms, cards, modals, tables, nav, alerts, tabs, tooltips, toasts.
- **Icons:** `@coreui/icons` + `@coreui/icons-react` (`CIcon` component) — not a second icon library.
- **CSS import:** `@coreui/coreui/dist/css/coreui.min.css`, imported once at the app entry point (`frontend/src/main.tsx`).
- **Tailwind is removed**, not kept alongside CoreUI — `tailwindcss`/`postcss`/`autoprefixer` dependencies and `tailwind.config.js` are dropped once the AUTH-1 screens are migrated (see Consequences). No new UI is written in Tailwind starting now, even before that migration lands.
- The rest of ADR-0009's stack (Vite, React Router, TanStack Query, React Hook Form + Zod) is unchanged — this ADR narrows ADR-0009 to its styling-layer decision only.

## Consequences

**Positive:** one design system instead of two competing CSS frameworks fighting over `.container` and reset rules; CoreUI's admin-template component set (sidebar/navbar layout, data tables, forms) is a closer fit to this product's actual UI shape than hand-styling everything in Tailwind utilities; React Hook Form + Zod still drive validation, CoreUI just supplies the input/form components they bind to.

**Negative / Trade-offs:** CoreUI's open-source tier doesn't include every component PRO does (e.g. some advanced data-grid/chart widgets) — if a later story needs one of those, that's a build-vs-PRO-license decision to make at that time, not assumed now.

**Migration executed same day (2026-09-03):** `Login.tsx`/`OrgPicker.tsx`/`OrgHome.tsx` and the root scaffold-verification page (all Tailwind-authored, predating this ADR) were rewritten onto CoreUI (`CCard`/`CForm`/`CFormInput`/`CButton`/`CAlert`/`CListGroup`); `tailwindcss`/`postcss`/`autoprefixer` and their config files were removed from `frontend/`. Verified via `tsc --noEmit`, the existing Vitest suite, and a full Playwright E2E re-run (login + org-picker + scaffold-smoke) against a live rebuilt isolated test environment — not just a clean compile.

## Alternatives considered

- **CoreUI + Tailwind together, Tailwind scoped to layout-only utilities** — rejected: the `.container` class collision alone makes this fragile, and it keeps two frameworks' mental models in play for every future contributor.
- **Keep Tailwind, build a custom component layer** — rejected: reinvents what CoreUI already ships for exactly this admin-tool shape, for no articulated benefit.
- **CoreUI PRO** — not chosen now: no story yet needs a PRO-only component; upgrade path stays open, revisit if/when one does.
