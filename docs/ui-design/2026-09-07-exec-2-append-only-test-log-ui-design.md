# EXEC-2 UI Design Document — TestCycleDetail's "History" modal (append-only TestLog timeline + comment form)

**Date:** 2026-09-07
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0036](../adr/0036-exec-2-append-only-test-log.md), [ADR-0034](../adr/0034-exec-1-test-execution-recording-dashboard.md)/[EXEC-1 UI Design Document](2026-09-07-exec-1-test-execution-recording-ui-design.md) (`TestCycleDetail`, this story's host screen), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md).

## 1. Screen identity

**No new route, no new screen.** FR-EXEC-2's own surface lands entirely inside `TestCycleDetail` (`/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId`), exactly as the sitemap's own EXEC-1-era note anticipated ("may land on `TestCycleDetail` itself rather than a separate page"). One new affordance: a "History" button on each row of the existing execution-history list (EXEC-1 UI Design Document §2), opening a modal.

## 2. Layout — the new modal, opened from an existing history row

```
Execution history row:
  • <TestCase title> — Pass — 2026-09-07 14:02 — Priya          [ History ]

┌─────────────────────────────────────────────────────────────┐
│ Execution history                                        [x] │
│                                                                │
│ ── Timeline (oldest first) ──────────────────────────────    │
│  [status_change]  2026-09-07 14:02                            │
│  Result changed: (none) → pass                                 │
│                                                                │
│  [status_change]  2026-09-07 14:10                             │
│  Result changed: pass → fail                                   │
│                                                                │
│  [comment]        2026-09-07 14:12                             │
│  Looks like a real regression, retested on staging.            │
│                                                                │
│ ── Add a comment ─────────────────────────────────────────   │
│  Comment: [_____________________________________________]     │
│  Attachment URL (optional): [___________________________]     │
│  File name (optional): [_________________________________]    │
│                                              [ Add comment ]   │
│                                                                │
│                                                     [ Close ]  │
└─────────────────────────────────────────────────────────────┘
```

The prose above and this sketch agree on one point worth stating given `docs/CLAUDE.md`'s standing prose-vs-sketch rule: timeline **oldest first**, comment form **below** the timeline, both inside one modal — no separate screen, no tab split.

## 3. Behavior

- **Opening** (`History` button, one per execution row): fetches `GET /executions/{id}/logs` for that row's `id`. Loading spinner while in flight; a fetch failure renders a dismissible `CAlert` in the modal body, same convention every other section on this screen family uses.
- **Timeline entries**, each showing: an `event_type` badge (`status_change`/`comment`/`attachment`/`agent_action`, one color per type) + `logged_at` (localized) + a one-line human-readable summary derived from `payload` (a result-change line for `status_change`, the comment text for `comment`, text-plus-filename for `attachment`; for `agent_action` the same summary logic runs against `payload.kind` — Q3's "sub-kind carried in payload" decision surfaces here, not as a 5th badge color per sub-kind).
- **Comment form**: `text` (required), `attachment_url`/`file_name` (both optional; supplying either is what the backend uses to log the entry as `attachment` instead of `comment` — no client-side toggle, the presence of a value *is* the signal). Submits `POST /executions/{id}/comments`. On success: form clears, **timeline re-fetches** (never a local splice — same "always re-read the server" posture the dashboard/history already established for EXEC-1, Q-driven consistency rather than a new pattern). On failure: modal **stays open**, reason renders as a dismissible `CAlert` inside it, typed text is not discarded — same convention `onSubmitRecord` (EXEC-1) already established for this screen family.
- **Closing**: clears the modal's own state (selected execution id, loaded log rows) so reopening — for the same or a different execution row — always starts from a fresh fetch, never stale data from a previously-viewed execution.

## 4. Permissions

No permission-based hide/disable on the "History" button itself — same attempt-then-error convention this screen family already uses for "Record Result" (EXEC-1 UI Design Document, deviation 2), for the same consistency reason. The comment form's submit can `403` (caller lacks `test_execution.update`) — rendered inline exactly like a `422`/`403` from "Record Result" already is.

## 5. Non-goals

No real file upload for `attachment_url` — a plain reference field, same v1 posture `Defect.external_ref` (EXEC-3) already established; building actual evidence-file storage for `TestExecution` is a future story's scope. No edit/delete affordance for any timeline entry — `TestLog` has no such route, by design (AC2). No separate "Comments" tab or page — the timeline and the comment form share one modal, per the layout above.
