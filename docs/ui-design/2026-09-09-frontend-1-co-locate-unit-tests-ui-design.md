# UI Design Document — FRONTEND-1 co-locate Vitest unit tests next to source

**Date:** 2026-09-09
**Related:** [ADR-0049](../adr/0049-frontend-co-locate-unit-tests.md) (FRONTEND-1, Vitest unit-test layout convention)

## 1. Scope

This document exists to satisfy [ADR-0049](../adr/0049-frontend-co-locate-unit-tests.md)'s doc-propagation scope (every new ADR in this repo propagates across the same set of docs: Requirements/WBS/ADR/Database/API/UI-Design/Sitemap/Test-Plan/Test-Design/Test-Case — see root `CLAUDE.md`'s "Architecture decisions are ADR-first" section and `docs/CLAUDE.md`'s own "Not every task is a doc-propagation trigger" note for the applicability judgment).

**FRONTEND-1 has no UI surface change.** Vitest unit-test files (`*.test.{ts,tsx}`) move from `frontend/tests/**` to live co-located next to their source under `frontend/src/`; the single non-test file (`setup.ts`, jsdom polyfills) moves to a renamed folder of the same level (`frontend/test-setup/`); `frontend/vite.config.ts`'s `setupFiles` path updates to match; `frontend/CLAUDE.md`'s pre-existing "tests live in `frontend/tests/`" paragraph rewrites in place to state the new convention. No route change, no component prop change, no markup change, no CSS change, no chrome change, no AdminLTE class contract change, no `data-testid` change, no accessible-name change, no `frontend/src/index.css` change.

Per the standing "Not every task is a doc-propagation trigger" applicability judgment, opening a substantive UI Design Document for a change with zero UI surface would be padding rather than propagation — this document exists *only* to keep the doc-propagation pattern explicit and complete, so future readers grepping for "FRONTEND-1 UI Design" find this scope note rather than concluding one was never written.

## 2. UI Design Document sections that *would* apply, and why each is empty for this ADR

- **§1 Screen inventory:** no new screen, no removed screen, no changed screen. Every route in the [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md)'s existing tables is reached identically before and after the move; every component is mounted identically before and after the move. Same posture the Sitemap's own FRONTEND-1 "no new route" annotation takes.
- **§2 Component/atom inventory:** no new component, no removed component, no changed component API. Every component under `frontend/src/components/`, `frontend/src/pages/`, `frontend/src/auth/`, `frontend/src/container/`, and `frontend/src/lib/` exists and exports identically after the move — only files named `*.test.{ts,tsx}` change physical path, and those are not exported.
- **§3 Layout / markup / chrome change:** none. No `App.tsx` route change, no `AppShell`/`AppHeader`/`AppSidebar`/`AppFooter`/`AppBreadcrumb` change, no AdminLTE class contract change, no `data-testid` rename, no CSS class addition. The chrome on every screen renders identically before and after — what changes is the on-disk path of test files, not anything a user (or a real-browser e2e spec) sees.
- **§4 Interaction change:** none. Every component's existing event handlers, refs, focus traps, transitions, and AdminLTE-class toggles (`sidebar-collapse`/`sidebar-open`/`menu-open`/etc.) are unaffected.
- **§5 Accessibility change:** none. No `aria-*` attribute, no `role` attribute, no accessible name change. The AdminLTE v4 raw-HTML markup the screens already render (ADR-0042) is unchanged.
- **§6 Responsive/breakpoint change:** none. The `matchMedia("(max-width: 991.98px)")` breakpoint AdminLTE's `push-menu.ts` already publishes is unchanged.
- **§7 Color-mode/theming change:** none. The `data-bs-theme`/`lte-theme` localStorage-key light/dark toggle (ADR-0042) is unchanged.
- **§8 Icon change:** none. The `Icon` atom, Font Awesome class contract, and every `<i className="fa-*">` usage is unchanged.

## 3. Test-coverage-as-UI-Design proxy

The Vitest suite re-running green against the post-move layout (per the [Test Plan §14 FRONTEND-1 risk row](../test-plan/2026-09-03-master-test-plan.md) and [Test Design §40's `Vitest-rerun-green` equivalence class](../test-design/2026-09-03-test-design.md)) is the substitute for §3's "visual diff before/after" — by definition, identical DOM output before and after means no UI surface changed. This is the same posture every prior frontend refactor (DS-1's `FormField`, DS-2's `Table` container, DS-3's `InfoBox`, SHELL-7's sidebar-mini restructure, PROJ-4's `ProjectsPage` extraction, BRAND-1's logo system) has taken: the existing per-screen Vitest suite re-running green is the proof that no UI surface drifted.
