# ADR-0061: `Table`/`EntityTable` pagination row always renders, even on a single page

**Date:** 2026-09-12
**Status:** Accepted — **Partially supersedes [ADR-0041](0041-ds-2-table-container-shared-pagination.md)'s Decision §"Page-size selector"/its own `showPaginationRow = totalPages > 1` behavior.** Every other decision in ADR-0041 (the `container/` location, two pagination modes, 10/25/50/100 page sizes with reset-to-page-1 on change, backend max `page_size` 100, `role-assignments`' envelope) stands unchanged.
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0041](0041-ds-2-table-container-shared-pagination.md) (the ADR this partially supersedes), [ADR-0042](0042-adminlte-design-system.md) (raw Bootstrap 5 markup this pagination row is built from), [DS-2 user story](../user-stories/2026-09-04-design-system-component-stories.md#story-ds-2-reusable-table-container-pagination--page-size-selector)

## Context

ADR-0041 explicitly decided the pagination row (and the page-size selector riding inside it) renders **only** when `totalPages > 1` — "not a disabled single-page control," per that ADR's own Test Design §34/TC-DS-009/TC-DS-014. This held from DS-2 (2026-09-07) through this session.

Direct product ask (2026-09-12): show pagination at all times, including a single-page list, rather than have the row appear/disappear depending on row count — a "Showing X to Y of Z items" summary is useful information regardless of page count, and a row-count total is otherwise invisible on a single-page list.

## Decision

1. **`Table.tsx`'s `showPaginationRow` is now unconditionally `true`** for every list, server or client mode, empty or not. Previous/Next disable correctly on a single page via `currentPage`/`totalPages` comparison — same mechanism ADR-0041 already built, just no longer gated behind a page-count threshold.
2. **The pagination block is extracted into its own reusable molecule**, `components/molecules/pagination/` (`Pagination`), rather than staying inline JSX inside `Table.tsx` — same "check for an existing reusable primitive first" component-reuse discipline `frontend/CLAUDE.md` already requires, applied in the other direction (a block worth extracting once it has a second real reason to exist outside `Table`'s own render body). `Table.tsx` composes it; `PAGE_SIZE_OPTIONS` moves with it and is re-exported from `container/Table.tsx` for backward compatibility.
3. **A new "Showing X to Y of Z items" summary** renders alongside the page-size selector, computed from a new optional `totalItems` prop. `Table.tsx` always passes its own `effectiveTotal` (server mode: the caller's `total`; client mode: `items.length`), so every existing `Table` caller gets the summary for free, not just `EntityTable`.
4. **`EntityTable`'s pagination now sits in a real `.card-footer`**, not bare inside `.card-body` — a new `Table` prop, `footerClassName`, wraps the pagination row in a div with that class when given; `EntityTable` passes `"card-footer"`, every other caller passes nothing (unchanged bare-div output).

## Consequences

**Positive:** consistent chrome regardless of row count — no more "the pagination row is there, then it's gone" as a list crosses the one-page threshold. The row-count summary was previously only inferable by counting visible rows; now it's stated directly, on every list, all the time. The `Pagination` molecule is reusable by a future bespoke screen that owns its own paging state without going through `Table`'s two modes at all — it takes plain `currentPage`/`totalPages`/`pageSize`/`onPageChange`/`onPageSizeChange` props, no `Table`-specific coupling.

**Negative / accepted trade-offs:**

- **TC-DS-009 and TC-DS-014's literal wording is now false** ("no pagination row renders (single page)" / "no pagination row, no page-size selector rendered") — corrected in place in `docs/test-cases/2026-09-03-test-cases.md`, same posture as this repo's own "superseding a row" convention (`docs/CLAUDE.md`).
- **A single-page/zero-row list now always shows a disabled Previous/Next pair and a page-size selector** — a small amount of always-visible chrome for lists that will, in practice, often be short. Accepted per the direct product ask; the alternative (conditional rendering) is exactly what this ADR reverses.
- **No live-browser verification this pass** — no login credential was available to this session (signup closed, a password reset was correctly blocked as a destructive credential write). Verified via `tsc --noEmit` (clean) and the full Vitest suite (76 files/514 tests, including the updated `Table.test.tsx`/`entity-table.test.tsx` assertions) — not a real-browser click-through.

## Alternatives considered

- **Keep the `totalPages > 1` gate, add the summary text only when the gate is already open.** Rejected — the direct ask was specifically to show pagination chrome (including the summary) even on a single page, not just to add the summary text to the existing conditional row.
- **Leave the pagination markup inline in `Table.tsx`, add the summary there directly.** Rejected — the same markup was about to gain a second real caller need (any future bespoke screen wanting page-size/summary chrome without `Table`'s two-mode API), which is exactly the threshold `frontend/CLAUDE.md`'s reuse-check rule uses to justify promoting a block to its own molecule rather than leaving it as one caller's private JSX.
