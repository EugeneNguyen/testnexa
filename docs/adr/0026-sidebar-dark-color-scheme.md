# ADR-0026: Sidebar dark color scheme (`CSidebar colorScheme="dark"`)

**Date:** 2026-09-05
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0018](0018-admin-shell-sidebar-layout.md) (admin shell sidebar+navbar — this ADR only adds a visual prop to that shell, no structural change), [ADR-0020](0020-admin-shell-full-template-parity.md) (full CoreUI free-template parity, including FR-SHELL-4's app-wide light/dark mode toggle — see Decision below for why the two are independent), [ADR-0012](0012-coreui-design-system.md) (CoreUI design system)

## Context

Direction: match [CoreUI's free Bootstrap admin template demo](https://coreui.io/demos/bootstrap/latest/free/index.html) look, whose sidebar renders in CoreUI's dark color scheme by default. `AppSidebar.tsx`'s `<CSidebar>` (ADR-0018) had no `colorScheme` prop set, so it rendered CoreUI's default (light) scheme — a visible mismatch against the reference demo.

This is easy to conflate with FR-SHELL-4 (ADR-0020), the app-wide light/dark mode toggle (`useColorModes`, `localStorage`-persisted): FR-SHELL-4 controls the *page/body* theme; the reference demo's sidebar stays dark regardless of that toggle. The two are separate CoreUI mechanisms — `colorScheme` is a static prop on `CSidebar` itself, `useColorModes` is a global mode context. Recorded explicitly so a future contributor doesn't "fix" the sidebar to flip with the app-wide toggle, assuming the two were meant to be linked.

## Decision

- `AppSidebar.tsx`'s `<CSidebar>` sets `colorScheme="dark"` — CoreUI's own documented prop (`CSidebar` supports `'dark' | 'light'`), which applies the shipped `sidebar-dark` class from the already-imported `coreui.min.css`. No bespoke CSS, no new dependency, per ADR-0012's "adopt CoreUI's own components/props, don't hand-roll" stance.
- The dark scheme is **static**, not wired to FR-SHELL-4's `useColorModes` state — the sidebar renders dark whether the app-wide mode is light, dark, or auto, matching the reference demo's own default behavior.
- No other shell element (`CHeader`, `CFooter`, `CBreadcrumb`) changes scheme — only `CSidebar` per the reference demo.

## Consequences

**Positive:** Visual parity with the reference demo achieved via one existing, documented CoreUI prop — zero new CSS, zero new dependency, consistent with every prior CoreUI-adoption ADR in this repo.

**Negative / Trade-offs:** Introduces a second "dark" concept in the shell (static sidebar scheme vs. FR-SHELL-4's toggleable app mode) that reads as redundant at a glance — mitigated by this ADR's explicit record of the distinction, and by NFR-36 below. If a future story wants a light-sidebar option or wants the sidebar scheme to follow the app-wide toggle, that is a new, explicit decision — not implied or blocked by this one.

## Alternatives considered

- **Tie `colorScheme` to FR-SHELL-4's `useColorModes` state** (dark app mode → dark sidebar, light app mode → light sidebar) — rejected: no story or reference-demo behavior asks for this; the reference demo's own sidebar stays dark independent of its mode toggle, so linking them would be a deviation, not parity.
- **Bespoke CSS override on `CSidebar`** — rejected: violates ADR-0012; the built-in `colorScheme` prop already produces the exact shipped styling with no override needed.
