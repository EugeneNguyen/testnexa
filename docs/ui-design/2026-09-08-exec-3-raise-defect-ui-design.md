# EXEC-3 UI Design Document — Raise Defect (TestCycleDetail) + TestCase Defects section (EntityFormPage)

**Date:** 2026-09-08
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0041](../adr/0041-exec-3-raise-defect-from-execution.md), [ADR-0034](../adr/0034-exec-1-test-execution-recording-dashboard.md)/[EXEC-1 UI Design Document](2026-09-07-exec-1-test-execution-recording-ui-design.md) (`TestCycleDetail`, this story's first host screen), [ADR-0038](../adr/0038-exec-2-append-only-test-log.md)/[EXEC-2 UI Design Document](2026-09-07-exec-2-append-only-test-log-ui-design.md) (same screen's existing "History" modal, the sibling affordance this one sits next to), [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md) (`EntityFormPage`, this story's second host screen — `TestCase`'s only existing detail view), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md).

## 1. Screen identity

**No new route, no new screen — two existing screens each gain one addition.**

- `TestCycleDetail` (`/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId`): a "Raise Defect" button on each `fail`-result execution-history row, next to the existing "History" button (EXEC-2). Opens a modal.
- `EntityFormPage` (`/projects/:projectId/admin/test-cases/:id/edit` — `TestCase`'s only detail view; there is no bespoke `TestCaseDetail` page, `TestCase` has no `GET /test-cases` list route at all per `app/schemas/assets.py`'s own module docstring): a new read-only "Defects" section below the edit form, rendered only when `entityKey === "test-cases"`.

## 2. Layout — `TestCycleDetail`'s "Raise Defect" button + modal

```
Execution history row (fail result only):
  • <TestCase title> — Fail — 2026-09-08 09:14 — Priya   [ History ] [ Raise Defect ]

┌─────────────────────────────────────────────────────────────┐
│ Raise Defect                                              [x]│
│                                                                │
│  External ref (optional): [_______________________________]  │
│    e.g. a Jira/GitHub/GitLab issue URL or id — plain text,    │
│    no live integration in this scaffold.                      │
│  Severity: [ low | medium | high | critical ▾ ]                │
│  Status (optional, defaults to "open"): [__________________]  │
│                                                                │
│                                    [ Cancel ]  [ Raise Defect ]│
└─────────────────────────────────────────────────────────────┘
```

The button renders **only on rows whose `result` is `fail`** — the backend's own `422` on a non-fail execution is the real enforcement boundary (AC1's literal precondition), but offering the button everywhere and relying on the error alone would be confusing UX for a case the row's own `result` badge already rules out deterministically. This mirrors TC-EXEC-010's own "UX convenience layered over a real backend boundary" posture for the "Record Result" picker (EXEC-1).

## 3. Behavior

- **Opening**: no fetch — the modal only needs the target execution's `id` (already in hand from the row) and a blank form. `severity` defaults to no selection (forces an explicit choice, it's a required field on the model); `status` defaults to blank (server fills `"open"` if left empty, matching `Defect.status`'s own column default — no client-side default duplicating the server's).
- **Submit**: `POST /executions/{id}/defects` with `{external_ref, severity, status}` (`external_ref`/`status` sent as `null` if left blank, never an empty string — same convention `actual_result`/`attachment_url` already use elsewhere on this screen family). On success (`201`): modal closes, no local list to refresh (`TestCycleDetail` doesn't render a Defects list itself — that's `EntityFormPage`'s job, §4 below). On failure: modal **stays open**, reason renders as a dismissible `CAlert` inside it (a `422` if the execution's `result` somehow changed to non-`fail` between page load and submit — a real if narrow race — or a `403`), same "never discard typed input" convention `onSubmitRecord`/EXEC-2's comment form already established.
- **Closing**: clears the form (`external_ref`/`status` text, `severity` selection) so reopening — for the same or a different execution row — never carries over stale input.

## 4. Layout — `EntityFormPage`'s new "Defects" section (`test-case` entity only)

```
┌─────────────────────────────────────────────────────────────┐
│ Edit test case                                                │
│  [ ...existing generic field form... ]                        │
│                                                                │
│  ── Defects ──────────────────────────────────────────────   │
│  • [high]  JIRA-4821 — open        — 2026-09-08 09:14          │
│  • [medium] https://github.com/.../issues/12 — investigating   │
│    — 2026-09-07 16:02                                          │
│  • [low]   (no external ref) — closed — 2026-09-05 11:30        │
│                                                                │
│  (No defects raised against this test case yet.)  ← empty state│
└─────────────────────────────────────────────────────────────┘
```

- **Fetch**: `GET /test-cases/{id}/defects` on mount (alongside the existing `GET /test-cases/{id}` the form itself already fetches) — a `useQuery`-backed fetch, not a `useState` populated only by some other action (`frontend/CLAUDE.md`'s standing rule for any bespoke-screen list). Returned **already ordered most-recent-first** by the server (`Defect.created_at DESC`) — rendered as-is, no client-side re-sort needed (unlike `TestCycleDetail`'s own execution-history list, which sorts client-side because its generic-list backing route has no `sort` param).
- **Row content**: a severity badge (reusing `TestCycleDetail`'s existing four-color-family convention, extended to 4 severities instead of 4 results — `low`=secondary, `medium`=info, `high`=warning, `critical`=danger), `external_ref` (or "(no external ref)" if `null` — never a blank cell, same "false-empty" discipline TC-SHELL-011/020 already established elsewhere), `status` (plain text — no fixed vocabulary, per the model), `created_at` (localized).
- **Empty state**: zero defects → "No defects raised against this test case yet." — never a silently blank section indistinguishable from a load-in-progress or a fetch failure.
- **Flat `<ul>`/`<li>`, never a `<CTable>`** — this section is not nested inside another table's cell, but the convention is kept uniform with every other list on this screen family (`frontend/CLAUDE.md`).
- **No create/edit affordance here.** Raising a Defect only happens from `TestCycleDetail`'s "Raise Defect" button (§2/§3) — this section is read-only, matching AC3's own literal "shows" wording (not "manages").

## 5. Permissions

**`TestCycleDetail`'s "Raise Defect" button:** no permission-based hide/disable — same attempt-then-error convention this screen family already uses for "Record Result" (EXEC-1) and "History"/comment (EXEC-2), for the same consistency reason. A `403` renders inline exactly like a `422` does.

**`EntityFormPage`'s Defects section:** visible whenever the caller can reach the `test-case` edit page at all (gated `test_case.read`, unchanged) — the section's own fetch can independently `403` if the caller lacks `defect.read` (a real, reachable case pre-EXEC-3: `test_manager`/`tester` both hold `defect.read` already, but a custom role with `test_case.*` and nothing else would not); renders as a dismissible `CAlert` inside the section, the form above it stays fully usable regardless.

## 6. Non-goals

No edit/delete of a raised Defect from either screen (`test_manager`'s bundle is deliberately not extended with `defect.update`/`.delete` — see ADR-0041's Alternatives). No `TestLog` entry appended when a Defect is raised (EXEC-2's own scope note already excluded this; EXEC-3 stays additive). No live external-tracker integration for `external_ref` (AC2's own literal "plain text/URL... no live integration needed for v1"). No bespoke `TestCaseDetail` page — the Defects section extends the existing generic `EntityFormPage`, not a new screen, matching this story's minimal-surface posture.
