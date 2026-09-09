# ADR-0049: Remove UI Elements nav group + Colors/Typography/Icons reference pages — retire ADR-0020's template-parity scaffolding

**Date:** 2026-09-09
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0020](0020-admin-shell-full-template-parity.md) (added the "UI Elements" nav group + Colors/Typography/Icons reference pages as template-parity scaffolding; this ADR retires that scope piece — ADR-0020's `Status` becomes "Partially superseded by 0042, 0049"), [ADR-0018](0018-admin-shell-sidebar-layout.md) (the persistent sidebar shell this removal simplifies), [ADR-0046](0046-shell-7-sidebar-mini-org-crud-restructure.md) (SHELL-7 explicitly leaves `UI Elements` in place as the unconditional last item — that "leaves it in place" decision is what this ADR reverses), [ADR-0048](0048-brand-1-logo-brand-system.md) (latest precedent for one-commit-retiring-documented-template-scaffolding)

## Context

ADR-0020 added three reference pages (Colors, Typography, Icons) under an org-scoped "UI Elements" nav group, positioned as template-parity scaffolding for the free-template dashboard demo. ADR-0020 itself flagged them as "not backed by any FR/NFR or user story... a future contributor should not read them as product scope," and the Master Test Plan's own risk row carried the same forward-warning — "risk they get silently expanded into real feature surface over time (scope creep, contradicting their own documented 'scaffolding only' status)."

In the time since, the scaffolding has accrued zero product value: no FR/NFR, no user story, no test fixture, no e2e spec depends on it, no edge-case coverage warrants it as a placeholder, and the SHELL-7 sidebar restructure (ADR-0046) deliberately kept it as an unconditional last item only because it had nothing to migrate — SHELL-7 itself flagged it as out of scope ("UI Elements (ADR-0020) untouched, out of scope"). The only reasons it remains today are inertia and ADR-0020's own "future cleanup is a documented, low-risk change" forward-pointer — both of which are reasons to retire now, not barriers.

This ADR is the cleanup ADR-0020 itself invited.

## Decision

1. **Delete the `UI Elements` nav group from `AppSidebar`'s `navGroups` array entirely** — `sidebar-nav-group-ui-elements` testid is gone from the DOM on every route (including the `!orgId` branch, which already returned an empty `navGroups` array — no change there).
2. **Delete the three `/orgs/:orgId/ui-elements/{colors,typography,icons}` routes** from `App.tsx`'s React Router tree. These were the only consumer of the nav group and have no other callers. The three page components (`frontend/src/pages/ui-elements/{Colors,Icons,Typography}.tsx` plus any sibling `index.ts`) are deleted at the same time. Direct deep-link navigation now hits React Router's catch-all — NotFound-equivalent behavior, never a silent error. No legitimate URL source produces these paths.
3. **Strip the corresponding docstring paragraphs from `AppSidebar.tsx`'s top-of-file comment and `App.tsx`'s matching comment block above the routes** — both are historical-record comments describing a now-deleted feature; leaving them would actively mislead a future reader into thinking the nav group still exists.
4. **No replacement component, no new ADR for the page-file deletion.** This is delete, not replace.
5. **No backend, database, or API surface change.** `pages/ui-elements/` is frontend-only; `App.tsx`'s routes are React Router only; nothing here reads or writes any entity. TC-SHELL-014's smoke-level clause asserted render-without-error only, never a real fetch — there was nothing to fetch.
6. **`AppSidebar.test.tsx` fixture references are updated** as part of this commit: the treeview-toggle contract test's example nav-group swaps from `sidebar-nav-group-ui-elements` (now undefined) to `sidebar-nav-group-access-control` (same shape — 4 children, no coverage change); the icon-exclusivity clause's `UI Elements` sub-assertion drops (referent gone); the nav-order literal expected array drops its trailing "UI Elements" entry.

## Consequences

**Positive:** sidebar's product-relevant surface is the only surface (Dashboard / Projects / Members / Access Control / Catalogs / Organization — 6 nav items + logo), no template-parity placeholder that future contributors could mistake for incomplete product work; the "scope creep" risk row in the Master Test Plan is retired; documentation no longer needs to carry the "read these as not-product" disclaimer.

**Negative / accepted trade-offs:**

- **Deep-link breakage** (any pre-removal email-link / doc-screenshot / stale bookmark pointing at `/orgs/:orgId/ui-elements/{colors,typography,icons}`): acceptable because no legitimate source produces these URLs — no email-link, no screenshot-from-doc, no user story, no test fixture has ever created one. The cost is paid once and never again.
- **Vitest icon-exclusivity test (TC-SHELL-026)** currently asserts the `UI Elements` group has no icon — referent disappears, sub-assertion drops (rest of TC-SHELL-026 unaffected).
- **Same file's treeview-toggle contract test** used `sidebar-nav-group-ui-elements` as a concrete example — fixture swap to `sidebar-nav-group-access-control`, no coverage change.

### Doc-propagation scope (this is a docs-only pass; code/test changes to follow in the same `remove-ui-elements` branch in a subsequent implementation commit, per the repo's plan-then-implement flow)

- new ADR-0049 (this file), supersedes ADR-0020's UI Elements clause (ADR-0020's `Status` row edited to read "Partially superseded by 0042, 0049")
- ADR README: new row + Date line extended
- WBS row `11.32`
- Test Design `§40`
- Test Cases: TC-SHELL-014 ~~strikethrough~~ + one-line "superseded by ADR-0049" note; TC-SHELL-027 corrected in place (7-item expected sequence → 6-item, "UI Elements" trailing entry removed); new TC-SHELL-029 (P2: sidebar's `UI Elements` group absent under `/orgs/:orgId`, the deletion itself asserted as an explicit negative, not inferred from TC-SHELL-027's now-6-item order alone); Layout & Navigation coverage-summary recount note (22/9 stays 22/9 — strike `-1` P3 + add `+1` P2)
- Sitemap: route row + tree branch removed
- Requirements: "Not an FR (explicitly, per ADR-0020)" paragraph strikethrough + supersession note
- Master Test Plan: the scope-creep risk row retired (strikethrough + superseded note)
- `ui-design/2026-09-08-shell-7-sidebar-mini-org-crud-restructure-ui-design.md`: ASCII sketch line `[—]  UI Elements  ▸` removed (the only UI Design Document whose layout sketch still references it)
- new `ui-design/2026-09-09-remove-ui-elements-nav-group-ui-design.md`: short delta-spec for this removal

**Doc-propagation applicability** (per `docs/CLAUDE.md`'s "check per doc before writing any" rule): Database Document and API Document reviewed; zero UI Elements references in either — these were never backend-touching scaffolding, nothing to write. User Stories file not opened, per the explicit "no new stories file for this small-scoped removal" decision on this branch's own plan Q3.

**Not done (docs-only pass boundary):** code/test changes (sidebar drop, route drop, page-file deletion, test fixture swap) — to follow in the same `remove-ui-elements` branch in a subsequent implementation commit.

## Alternatives considered

- **Leave `UI Elements` as a deliberate template-parity slot** — rejected: ADR-0020's own "scope creep risk" warning has now had weeks to materialize or stay benign, and the time has yielded no evidence the slot serves any purpose; keeping it as visual filler for the sidebar's bottom is a small cost in confusion, and "always-present template demo content" was already near-zero value when the choice was first made (per ADR-0020's own "low-risk cleanup" forward-pointer).
- **Replace the nav group with a different placeholder (a docs link, a build-info row, a status bar)** — rejected: out of scope for this story, no evidence any non-`UI Elements` placeholder would be wanted, easy to add later as its own ADR if a real need surfaces.
- **Feature-flag the deletion** (`VITE_SHOW_TEMPLATE_PAGES` etc.) — rejected: the entire reason for the scaffolding was template-parity of the *demo*. A local-dev-only toggle is an even thinner version of "scaffolding future contributors must learn to ignore," not the same cleanup.
