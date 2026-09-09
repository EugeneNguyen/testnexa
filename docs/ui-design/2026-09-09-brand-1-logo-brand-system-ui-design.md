# UI Design Document — BRAND-1: Logo/brand system

**Date:** 2026-09-09
**Story:** BRAND-1 (folded into [design-system-component-stories.md](../user-stories/2026-09-04-design-system-component-stories.md) — see Requirements §2.12/FR-BRAND-1, no new stories file)
**ADR:** [ADR-0048](../adr/0048-brand-1-logo-brand-system.md)

## 1. Scope

Give TestNexa a real, simple, icon-based visual identity — one checkmark-in-shield mark + "**Test**Nexa" wordmark, one `currentColor` SVG pair (full lockup + small mark), applied consistently across login, header, sidebar, and the browser tab (favicon). No new component library, no vendored JS — reuses AdminLTE's own `.brand-image-xl`/`.brand-image-xs`+`.logo-xl`/`.logo-xs` sidebar mechanism (already active since SHELL-7's `sidebar-mini`).

## 2. Assets

### 2.1 `frontend/src/assets/brand/logo-mark.svg` — small mark

Checkmark inside a shield outline, `viewBox="0 0 32 32"`, `fill="currentColor"` throughout, no `<style>`/hardcoded hex anywhere in the file. Legible down to 16px (favicon-adjacent contexts) and up to header/sidebar sizes (24-32px).

### 2.2 `frontend/src/assets/brand/logo-full.svg` — full lockup

Same mark, left-aligned, followed by the wordmark as real `<text>` (or `<path>`-outlined glyphs, implementer's choice — either way `currentColor` fill, system font stack if `<text>`) reading "**Test**Nexa" — "Test" bold weight, "Nexa" regular weight, mirroring the bold-prefix convention the retired `<b>Admin</b>LTE` markup already established. `viewBox` wide enough for the full lockup at the login screen's `h1`-equivalent size.

### 2.3 `frontend/public/favicon.svg`

Independent asset, own fixed two-tone palette (not `currentColor` — browser chrome has no app theme to inherit), same checkmark-in-shield concept, verified legible against both a light and dark OS/browser tab bar.

## 3. Screens / components touched

### 3.1 `BrandLogo` atom (`components/atoms/brand-logo/`)

```tsx
export interface BrandLogoProps {
  href: string;
  size?: "full" | "small"; // default "full"
  className?: string;
}
```

- `size="full"` (default, used by login/signup via `AuthBoxLayout`): renders `logo-full.svg` — fixes the current hardcoded "AdminLTE" text bug.
- `size="small"` (used by `AppHeader`): renders `logo-mark.svg` only.
- Both variants: real `<a href={href}>`, `aria-label="TestNexa home"`.

### 3.2 `AppHeader` (`components/organisms/app-header/`)

`navbar-brand` (currently plain text `"TestNexa"`, `app-header.tsx:323`) becomes `<BrandLogo href="/dashboard" size="small" className="navbar-brand" />` — icon only, no wordmark (the header is a fixed single row, not a widening rail; see ADR-0048 Decision §7 for why no full/small state toggle is needed here).

### 3.3 `AppSidebar` (`components/organisms/app-sidebar/`)

`.sidebar-brand` (currently plain text `"TestNexa"` inside `.brand-link`/`.brand-text`, `app-sidebar.tsx:289-291`) gains both logo variants, unconditionally in the markup — no React state:

```html
<div class="sidebar-brand">
  <a class="brand-link" href="/dashboard" aria-label="TestNexa home">
    <img src="/src/assets/brand/logo-full.svg" class="brand-image-xl logo-xl" alt="" />
    <img src="/src/assets/brand/logo-mark.svg" class="brand-image-xs logo-xs" alt="" />
    <span class="brand-text fw-light">TestNexa</span>
  </a>
</div>
```

AdminLTE's own shipped CSS (`.sidebar-mini.sidebar-collapse`'s `.logo-xl`/`.logo-xs` visibility rules) cross-fades which image shows based on the existing `sidebar-mini`/`sidebar-collapse` body classes (SHELL-7, ADR-0046) — no new JS, no new state. `.brand-text` keeps its existing collapse/hover behavior (SHELL-7's own `.sidebar-mini.sidebar-collapse .brand-text` rule, unchanged).

### 3.4 `index.html`

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

## 4. Data / API

None. Every asset is static; no `apiFetch` call anywhere in this story.

## 5. Light/dark verification plan

`logo-mark.svg`/`logo-full.svg` inherit `currentColor` — verify by toggling `data-bs-theme` (ADR-0042's existing color-mode toggle) against a live instance and confirming the rendered mark's computed color tracks the surrounding text color in both modes, same "verify empirically against a live instance" discipline root `CLAUDE.md`'s Testing section already establishes for this class of claim (a CSS-inheritance question, not something to trust from reading the SVG source alone). The favicon is checked separately, against actual light and dark OS/browser chrome — it does not participate in `data-bs-theme` at all.

## 6. Open points resolved

1. **Does the header get the full lockup or just the mark?** Resolved: mark only (ADR-0048 Decision §7) — the header is a fixed-height row, and the sidebar already carries the wordmark whenever it's not mini-collapsed.
2. **One asset per theme, or `currentColor`?** Resolved: `currentColor`, single asset (ADR-0048 Decision §2) — avoids a duplicate-file drift risk for no behavioral gain over CSS inheritance.
3. **New brand accent color?** Resolved: no — reuses `--bs-primary` (ADR-0048 Decision §4).
