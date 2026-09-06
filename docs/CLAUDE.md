# CLAUDE.md — docs

Guidance for editing `docs/`. Read the root `CLAUDE.md` first (ADR-first policy, doc-propagation-applicability judgment call, the worktree-vs-docs-timing note under "Git / worktrees"). This file covers gotchas specific to editing the docs themselves, found the hard way during the PLAN-1/PLAN-2/PLAN-3 documentation passes (2026-09-06).

## New `TC-<AREA>-NNN` IDs: grep the whole file for the highest existing number, don't eyeball the section you're editing

`docs/test-cases/2026-09-03-test-cases.md`'s per-feature-area tables are **not** appended in ID order over time — a story's own placeholder rows (e.g. PLAN-3's `TC-PLAN-006/007/008`, written speculatively during an earlier planning pass) can sit *above* a later story's rows in the table (PLAN-2's `TC-PLAN-012/013`) even though the later story's IDs are numerically higher. Eyeballing "what's the highest number in the rows near where I'm inserting" undercounts.

This nearly shipped a real collision: a PLAN-3 documentation pass assigned new rows `TC-PLAN-012`/`TC-PLAN-013`, not noticing PLAN-2 had already claimed those exact IDs a few rows down in the same table. Caught only because a later grep (`grep -n "TC-PLAN-0"`) surfaced the whole file's actual ID list before the edit was considered done — the numbers were renumbered to `015`/`016`/`017` before anything shipped.

**Before assigning any new `TC-<AREA>-NNN` ID, run `grep -n "TC-<AREA>-[0-9]" docs/test-cases/*.md` first and take the max, not the highest number visible in the table region you're about to edit.**

## The API design doc's asterisk-count footnote convention is fragile — count exactly, don't eyeball

`docs/api/2026-09-03-api-design.md` §3 marks each entity's factory-serving footnote with a literal run of `\*` characters (`\*`, `\*\*`, `\*\*\*`, ...) matched purely by count, not a name or number — e.g. `TestCase`\*\*\*\*\* and `Defect`\*\*\*\*\* deliberately share 5 asterisks because they cite the same footnote text. Adding a new footnote requires knowing the exact count already in use so you neither collide with an existing marker (silently merging two unrelated footnotes) nor skip one (leaving a marker with no matching footnote, or vice versa).

This bit the PLAN-3 documentation pass directly: a first attempt at a new `TestExecution` footnote used 15 `\*`s by miscount, and a cross-reference in the `TestCycle` footnote pointed at the wrong count entirely. Caught by counting mechanically (`python3 -c "print(r'\*\*\*\*\*\*\*\*\*\*\*\*'.count('\\\\*'))"` — or just `grep -n '^\\\*' docs/api/2026-09-03-api-design.md` to list every existing marker and its line) rather than by eye, before it shipped.

**Before adding a new asterisk-marker footnote in that section: `grep -n '^\\\*' docs/api/2026-09-03-api-design.md` to enumerate every existing marker, count characters programmatically (not by eye) for both the new marker and any cross-reference to it, and verify the count is unique.** If this section needs even one more footnote after the current set, it's worth proposing named/numbered footnotes (`[^testcycle]`) instead of asterisk-counting — the convention was already borderline unreadable at 15 markers.

## Doc-propagation and implementation-worktree timing

See root `CLAUDE.md`'s "Git / worktrees" section — a worktree created before a docs-propagation pass lands on `main` will implement against a stale doc set. This is a doc-authoring-side risk too, not just an implementation-side one: if you know an implementation worktree already exists for the story you're documenting, say so in the completion report so whoever implements knows to rebase first, rather than letting it surface later as a merge-time surprise.
