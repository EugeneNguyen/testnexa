# ADR-0053: Tabler v1.5.1 installed via CDN — Phase 1 of a planned AdminLTE→Tabler design-system swap, install only

**Date:** 2026-09-10
**Status:** Accepted (Phase 1 only — see Consequences for what is deliberately not yet true)
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0042](0042-adminlte-design-system.md) (AdminLTE v4 — current, still-live design system; **not superseded by this ADR**, see Consequences), [Tabler](https://tabler.io/), [Tabler install docs](https://docs.tabler.io/ui/getting-started/installation)

## Context

CTO directive: install Tabler, following only its own documented installation instructions, and do nothing else in the same pass. Confirmed scope during planning:

- **Intent:** eventual full design-system swap, AdminLTE → Tabler (same shape as ADR-0042's own CoreUI → AdminLTE cutover) — but this pass is explicitly Phase 1 (install) only. No component migration, no AdminLTE removal, in this change.
- **Method:** CDN (`<link>`/`<script>` tags), not the npm package — Tabler's own installation doc (fetched 2026-09-10) covers CDN-only ("one HTML file, two tags from the CDN... There's no build step involved"); framework/npm integration is referenced but not covered on that page, and was explicitly declined for this pass.

**Real conflict this ADR has to name, not silently absorb:** ADR-0042 itself documents "do not run two Bootstrap-family stylesheets together" — both AdminLTE and Tabler are Bootstrap-5-based, both ship global, unscoped `.card`/`.btn`/`.table`/grid/reset rules, and loading both stylesheets on the same page makes the *later* one in DOM order win conflicting selectors, independent of which markup is actually in use. This is true the moment both are loaded, even before a single Tabler class appears in any component.

## Decision

- **`@tabler/core@1.5.1` loaded via CDN** (jsDelivr), added to `frontend/index.html`:
  - `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/core@1.5.1/dist/css/tabler.min.css">` — placed **before** `bootstrap`/`admin-lte`/Font Awesome's own `<link>` tags (which live in `frontend/src/main.tsx`, injected at runtime after `index.html`'s static tags parse) so that, at this phase, **AdminLTE's rules continue to win every conflicting selector** — zero visible change to any existing screen today. This is the opposite cascade position from ADR-0042's own AdminLTE-over-Bootstrap ordering, chosen deliberately here for the opposite reason: ADR-0042 wanted the newer system to win everywhere; this phase wants the *established* system to keep winning everywhere, since nothing consumes Tabler classes yet.
  - `<script src="https://cdn.jsdelivr.net/npm/@tabler/core@1.5.1/dist/js/tabler.min.js"></script>` — end of `<body>`, after the app's own bundled script tag.
- **No other change.** `admin-lte`, `bootstrap`, `@fortawesome/fontawesome-free` packages and their imports in `frontend/src/main.tsx` are untouched. No component migrated. No route, page, or shared component references any Tabler class.
- npm package (`@tabler/core` via `npm install`) explicitly **not** used this pass, per CTO instruction — CDN only.

## Consequences

- **AdminLTE (ADR-0042) remains the project's live, authoritative design system in full.** This ADR does **not** mark ADR-0042 superseded or partially superseded — every existing screen's markup, classes, and behavior are unchanged. Only a stack decision ("what will eventually replace AdminLTE, and which specific version") is recorded here ahead of the actual migration.
- Tabler's JS bundle (Popper-based, drives dropdowns/modals via `data-bs-*` attributes) now loads on every page alongside AdminLTE's React-driven, JS-plugin-free behaviors (root `CLAUDE.md`: "we don't vendor AdminLTE's JS/jQuery"). Both frameworks target the same Bootstrap-5 `data-bs-*` attribute contract on any Bootstrap-standard markup (e.g. a `.dropdown-toggle`) — until migration, watch for duplicate-listener behavior if any existing element happens to match Tabler's own JS selectors. Not observed in Phase 1 (no Tabler markup emitted anywhere yet), flagged for the migration phase's own testing.
- **New external network dependency.** `frontend/index.html` now fetches from `cdn.jsdelivr.net` at page load — this repo is built around a self-hosted, air-gapped-capable premise (see business case); an offline/air-gapped dev or prod environment will now show a broken/missing stylesheet until Phase 2 either vendors the files locally or the migration is reconsidered. Explicitly accepted for Phase 1 (dev convenience, matches "install only" scope); to be resolved before or during the real migration, not silently before then.
- **No backend/database/API surface change** — this is a static frontend asset addition only.
- **Migration itself (component-by-component swap off AdminLTE markup onto Tabler's, eventual AdminLTE package removal, eventual supersession of ADR-0042) is explicitly out of scope for this ADR and this pass** — to be planned and executed only on separate, explicit instruction, per this repo's own "don't develop until told" directive for this task. A future migration ADR will mark ADR-0042 superseded once it actually lands, the same way ADR-0042 itself marked ADR-0012 superseded only once CoreUI was actually fully removed.

## Alternatives considered

- **`@tabler/core` npm package instead of CDN.** Rejected for this pass, per explicit CTO instruction (CDN only). Would also sidestep the CDN's third-party-network dependency (see Consequences) and integrate more naturally with Vite's own CSS bundling/ordering — a reasonable default for the eventual migration phase, but not what was asked for here.
- **Full big-bang swap now, mirroring ADR-0042's own CoreUI→AdminLTE cutover.** Rejected — explicitly out of scope for this pass (CTO scoped this to "install only, don't do anything else"). A big-bang swap done without a written migration plan would also repeat exactly the risk ADR-0042 itself was careful about avoiding on the way in: no per-screen verification against a reference demo, no worktree-scoped incremental review.
- **Do nothing until a full migration plan is written and approved.** Rejected — the CTO asked for the install now, as a standalone, low-risk first step; deferring it doesn't reduce any real risk (nothing consumes Tabler yet either way) and delays having the asset available to reference once planning starts.
- **Place Tabler's `<link>` *after* AdminLTE's own CSS (Tabler wins conflicts).** Rejected for this phase — would produce an immediate, unrequested visual regression across every existing AdminLTE screen, the opposite of "install only, don't do anything else." Revisit this ordering choice deliberately once the real migration begins moving screens onto Tabler markup.
