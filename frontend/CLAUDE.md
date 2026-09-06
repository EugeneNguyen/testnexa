# CLAUDE.md — frontend

Frontend-specific guidance. Read the root `CLAUDE.md` first — this file only covers gotchas specific to `frontend/`, found the hard way during REQ-2's implementation (2026-09-05).

## Don't nest a `<CTable>` inside another `<CTable>`'s expanded-row cell

An expand-in-place pattern (a table row that, when clicked, renders a child list inside its own cell — `ProjectDetail.tsx`'s Release→TestCycle audit view, and originally REQ-2's Requirement→TestCase section too) breaks browser/Playwright accessible-name computation if the child list is itself a `<CTable>`: a `<table>` nested inside another `<table>`'s `<td>` has no ARIA role boundary between them, so the *outer* row's computed accessible name aggregates the inner rows' text too. This makes `getByRole("row", {name: /some inner text/})`-style lookups ambiguous — they resolve to both the outer wrapper row and the actual target row, a Playwright strict-mode violation.

**Use a flat `<ul>`/`<li>` for the nested level instead**, same convention the pre-existing Release→TestCycle view already used and REQ-2's Requirement→TestCase→TestStep section was refactored to match. Reserve `<CTable>` for the outermost, non-nested list in a given screen.

## Unit tests live in `frontend/tests/`, not co-located next to their source in `src/`

Every Vitest + RTL spec in this repo is under `frontend/tests/` (mirroring `src/`'s own directory shape — e.g. `src/pages/workflows/ProjectDetail.tsx` → `tests/pages/workflows/ProjectDetail.*.test.tsx`), **never** a `*.test.tsx` file sitting next to its component in `src/`. This is the opposite of the more common industry default (co-located tests), so a `find src -iname "*.test.*"` search comes back empty and *looks* like zero coverage exists — the actual answer requires checking `frontend/tests/` specifically before concluding a gap is real (a REQ-4 verification pass wasted a round-trip on exactly this before finding `tests/pages/workflows/ProjectDetail.TestConditions.test.tsx`, 2026-09-06). A per-story test file follows the shipping story's own name (`ProjectDetail.TestConditions.test.tsx`, `ProjectDetail.TestSuites.test.tsx`, ...) rather than one giant `ProjectDetail.test.tsx` — grep for the screen name across `frontend/tests/`, don't just check one filename.

## No frontend unit-test convention existed before ADMIN-2 (2026-09-05)

`frontend/tests/` (Vitest + RTL) only started getting real coverage with ADMIN-2's generic CRUD UI — earlier bespoke screens (`Login`, `OrgHome`, `ProjectDetail`, etc.) shipped with e2e (Playwright) coverage only, no per-component unit tests. Both are legitimate per the root `CLAUDE.md`'s three-layer testing model, but don't assume a bespoke screen has Vitest coverage just because the layer exists in the repo now — check `frontend/tests/` for that specific component before assuming a gap is actually a regression.
